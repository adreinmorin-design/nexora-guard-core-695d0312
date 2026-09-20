import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  mailboxInput,
  messageInput,
  uidInput,
  requireEmailAdmin,
} from "../src/lib/nexora/email-input.ts";

test("email inputs reject header injection, invalid UIDs, and unauthorized roles", () => {
  const valid = {
    to: "dre@nexoraguard.shop",
    subject: "Test",
    text: "hello",
    requestId: "11111111-1111-4111-8111-111111111111",
  };
  assert.equal(messageInput.parse(valid).subject, "Test");
  assert.throws(() =>
    messageInput.parse({ ...valid, subject: "Hello\r\nBcc: attacker@example.com" }),
  );
  assert.throws(() => messageInput.parse({ ...valid, to: "a@example.com,b@example.com" }));
  assert.throws(() => messageInput.parse({ ...valid, text: "a".repeat(20001) }));
  assert.throws(() => mailboxInput.parse({ email: valid.to, password: "secret\r\nLOGOUT" }));
  assert.throws(() => uidInput.parse({ uid: 0, validity: "1" }));
  assert.throws(() => requireEmailAdmin(["viewer", "security_admin"]));
  assert.doesNotThrow(() => requireEmailAdmin(["org_admin"]));
});

test("mailbox privileges, ownership, durable send reservation, limits, disconnect", async () => {
  const db = new PGlite();
  const org = "00000000-0000-4000-8000-000000000001",
    other = "00000000-0000-4000-8000-000000000002";
  const actor = "00000000-0000-4000-8000-000000000003",
    otherActor = "00000000-0000-4000-8000-000000000004";
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.organizations(id uuid primary key);
      create table public.org_members(org_id uuid,user_id uuid,role text);
      create table public.audit_events(org_id uuid,actor_id uuid,actor_type text,source text,action text,resource text,resource_id uuid,created_at timestamptz default now());
      create schema vault;
      -- Test substitute for Vault API. Production uses Supabase's encrypted extension.
      create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
      create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
      create function vault.create_secret(v text) returns uuid language plpgsql as $$ declare k uuid; begin insert into vault.secrets(secret) values(v) returning id into k;return k;end $$;
      create function vault.update_secret(k uuid,v text) returns void language sql as $$ update vault.secrets set secret=v where id=k $$;
      grant usage on schema vault to service_role;
      grant all on all tables in schema vault to service_role;
      grant all on public.org_members,public.audit_events to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated;
    `);
    await db.exec(await readFile("supabase/migrations/20260920070137_email_mailboxes.sql", "utf8"));
    await db.query("insert into auth.users values($1),($2)", [actor, otherActor]);
    await db.query("insert into organizations values($1),($2)", [org, other]);
    await db.query("insert into org_members values($1,$2,'org_admin'),($3,$4,'org_admin')", [
      org,
      actor,
      other,
      otherActor,
    ]);
    const call = async (action, o = org, a = actor, email = null, password = null, key = null) =>
      (
        await db.query("select public.nexora_mailbox($1,$2,$3,$4,$5,$6) as value", [
          action,
          o,
          a,
          email,
          password,
          key,
        ])
      ).rows[0].value;
    await db.exec("set role anon");
    await assert.rejects(call("status"), /permission denied/);
    await assert.rejects(db.query("select * from email_mailboxes"), /permission denied/);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(
      call("save", org, actor, "dre@nexoraguard.shop", "test-secret"),
      /permission denied/,
    );
    await db.exec("reset role; set role service_role");
    await assert.rejects(
      call("save", other, actor, "dre@nexoraguard.shop", "test-secret"),
      /access denied/,
    );
    await call("save", org, actor, "dre@nexoraguard.shop", "test-secret");
    const status = await call("status");
    assert.equal(status.connected, true);
    assert.equal(JSON.stringify(status).includes("test-secret"), false);
    assert.equal((await call("status", other, otherActor)).connected, false);
    const key = "11111111-1111-4111-8111-111111111111";
    const credential = await call("reserve", org, actor, null, null, key);
    assert.equal(credential.password, "test-secret");
    await db.exec("update email_mailboxes set last_operation_at=null");
    await assert.rejects(call("reserve", org, actor, null, null, key), /already attempted/);
    await db.exec(
      "insert into email_deliveries select gen_random_uuid(),id,'unknown',now() from email_mailboxes cross join generate_series(1,49)",
    );
    await assert.rejects(
      call("reserve", org, actor, null, null, "22222222-2222-4222-8222-222222222222"),
      /Daily send limit/,
    );
    await call("disconnect");
    assert.equal((await call("status")).connected, false);
    assert.equal((await db.query("select count(*) as n from vault.secrets")).rows[0].n, 0);
    assert.equal((await db.query("select count(*) as n from email_deliveries")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
