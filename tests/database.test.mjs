import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("migration, atomic admission, tenant separation, grants and single-use approvals", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    `);
    for (const name of (await readdir("supabase/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
    }
    const org = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    const user = "00000000-0000-4000-8000-000000000003";
    const approver = "00000000-0000-4000-8000-000000000004";
    const approval = "00000000-0000-4000-8000-000000000005";
    await db.query(
      "INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'a','a',$3),($2,'b','b',$3)",
      [org, other, user],
    );
    await db.query("INSERT INTO budgets(org_id,name,limit_usd) VALUES($1,'cap',1),($2,'cap',1)", [
      org,
      other,
    ]);
    const reserve = async (id, key, cost) =>
      (await db.query("SELECT nexora_reserve($1,$2,$3) AS r", [id, key, cost])).rows[0].r;
    assert.equal((await reserve(org, "one", 0.7)).admitted, true);
    assert.equal((await reserve(org, "two", 0.7)).admitted, false);
    assert.equal((await reserve(other, "one", 0.7)).admitted, true);
    assert.equal((await reserve(org, "one", 0.1)).admitted, false);
    await assert.rejects(db.query("SELECT nexora_settle($1,'one')", [org]));
    await db.query(
      "INSERT INTO requests(org_id,idempotency_key,decision,status,cost_usd) VALUES($1,'one','ALLOW','completed',.2)",
      [org],
    );
    await db.query("SELECT nexora_settle($1,'one')", [org]);
    assert.equal((await reserve(org, "three", 0.7)).admitted, true);
    assert.equal((await reserve(org, "four", 0.2)).admitted, false);
    await db.query("INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin')", [
      org,
      approver,
    ]);
    await db.query(
      "INSERT INTO approvals(id,org_id,requester_id,action) VALUES($1,$2,$3,'gateway.execute')",
      [approval, org, user],
    );
    await assert.rejects(
      db.query("SELECT nexora_decide_approval($1,$2,$3,'approved')", [org, approval, user]),
    );
    await assert.rejects(
      db.query("SELECT nexora_decide_approval($1,$2,$3,'approved')", [other, approval, approver]),
    );
    await db.query("SELECT nexora_decide_approval($1,$2,$3,'approved')", [org, approval, approver]);
    await assert.rejects(
      db.query("SELECT nexora_decide_approval($1,$2,$3,'approved')", [org, approval, approver]),
    );
    const privileges = await db.query(`SELECT
      has_function_privilege('authenticated','nexora_reserve(uuid,text,numeric)','EXECUTE') AS reserve,
      has_table_privilege('authenticated','approvals','UPDATE') AS approval,
      has_table_privilege('authenticated','requests','INSERT') AS requests`);
    assert.deepEqual(privileges.rows[0], { reserve: false, approval: false, requests: false });
    const agentPrivileges = await db.query(`SELECT
      has_column_privilege('authenticated','agents','name','SELECT') AS metadata,
      has_column_privilege('authenticated','agents','token_hash','SELECT') AS secret,
      has_table_privilege('authenticated','agent_capabilities','INSERT') AS grant_capability,
      has_table_privilege('authenticated','agents','UPDATE') AS alter_agent,
      has_table_privilege('anon','requests','TRUNCATE') AS truncate_requests`);
    assert.deepEqual(agentPrivileges.rows[0], {
      metadata: true,
      secret: false,
      grant_capability: false,
      alter_agent: false,
      truncate_requests: false,
    });

    const deviceHash = "a".repeat(64);
    const tokenHash = "b".repeat(64);
    const key = "00000000-0000-4000-8000-000000000006";
    await db.query(
      "SELECT nexora_start_connection($1,'ABCDEF1234','Test agent',ARRAY['requests:read']::text[])",
      [deviceHash],
    );
    await assert.rejects(
      db.query(
        "SELECT nexora_consent_connection('ABCDEF1234',$1,$2,true,ARRAY['requests:read','model:invoke']::text[])",
        [org, approver],
      ),
    );
    const consent = await db.query(
      "SELECT nexora_consent_connection('ABCDEF1234',$1,$2,true,ARRAY['requests:read']::text[]) AS id",
      [org, approver],
    );
    const agent = consent.rows[0].id;
    const exchange = await db.query(
      "SELECT nexora_exchange_connection($1,$2,'nxr_1234567') AS result",
      [deviceHash, tokenHash],
    );
    assert.equal(exchange.rows[0].result.agent_id, agent);
    assert.equal(exchange.rows[0].result.scope, "requests:read");
    assert.equal(
      (
        await db.query("SELECT nexora_exchange_connection($1,$2,'nxr_1234567') AS result", [
          deviceHash,
          tokenHash,
        ])
      ).rows[0].result.error,
      "invalid_grant",
    );
    assert.equal(
      (
        await db.query("SELECT nexora_claim_agent($1,$2,$3,NULL) AS result", [
          agent,
          key,
          tokenHash,
        ])
      ).rows[0].result.id,
      agent,
    );
    await db.query(
      "INSERT INTO requests(org_id,agent_id,idempotency_key,decision,status,cost_usd,input_tokens,output_tokens) VALUES($1,$2,'agent-usage','LOG','completed',0.125,10,20)",
      [org, agent],
    );
    const usage = (await db.query("SELECT * FROM nexora_agent_usage($1)", [org])).rows[0];
    assert.equal(usage.agent_id, agent);
    assert.equal(Number(usage.request_count), 1);
    assert.equal(Number(usage.cost_usd), 0.125);
    await assert.rejects(
      db.query("SELECT nexora_claim_agent($1,$2,$3,NULL)", [agent, key, tokenHash]),
    );
    await db.query("SELECT nexora_revoke_connection($1,$2,$3)", [org, agent, approver]);

    const applied = await db.query(
      "SELECT nexora_apply_paddle_event($1,$2,$3,$4,true,'team','active','ctm_1','sub_1',NULL,NULL,false) AS result",
      ["evt_new", "2026-09-17T10:00:00Z", "subscription.updated", org],
    );
    assert.equal(applied.rows[0].result.result, "processed");
    const duplicate = await db.query(
      "SELECT nexora_apply_paddle_event($1,$2,$3,$4,true,'team','active','ctm_1','sub_1',NULL,NULL,false) AS result",
      ["evt_new", "2026-09-17T10:00:00Z", "subscription.updated", org],
    );
    assert.equal(duplicate.rows[0].result.result, "duplicate");
    const stale = await db.query(
      "SELECT nexora_apply_paddle_event($1,$2,$3,$4,true,'solo','canceled','ctm_1','sub_1',NULL,NULL,false) AS result",
      ["evt_old", "2026-09-16T10:00:00Z", "subscription.canceled", org],
    );
    assert.equal(stale.rows[0].result.result, "stale");
    const subscription = (
      await db.query("SELECT plan_key,status,last_event_id FROM billing_subscriptions WHERE org_id=$1", [org])
    ).rows[0];
    assert.deepEqual(subscription, { plan_key: "team", status: "active", last_event_id: "evt_new" });

    await assert.rejects(
      db.query("SELECT nexora_claim_agent($1,$2,$3,NULL)", [
        agent,
        "00000000-0000-4000-8000-000000000007",
        tokenHash,
      ]),
    );
  } finally {
    await db.close();
  }
});
