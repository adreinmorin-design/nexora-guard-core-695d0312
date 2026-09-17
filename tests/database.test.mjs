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
  } finally {
    await db.close();
  }
});
