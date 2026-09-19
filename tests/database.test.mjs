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
    assert.deepEqual(privileges.rows[0], {
      reserve: false,
      approval: false,
      requests: false,
    });
    const agentPrivileges = await db.query(`SELECT
      has_column_privilege('authenticated','agents','name','SELECT') AS metadata,
      has_column_privilege('authenticated','agents','token_hash','SELECT') AS secret,
      has_table_privilege('authenticated','agent_capabilities','INSERT') AS grant_capability,
      has_table_privilege('authenticated','agents','UPDATE') AS alter_agent,
      has_table_privilege('anon','requests','TRUNCATE') AS truncate_requests,
      has_function_privilege('authenticated','nexora_provision_trial()','EXECUTE') AS provision_trial,
      has_function_privilege('authenticated','nexora_enforce_plan_resource_limit()','EXECUTE') AS plan_trigger,
      has_function_privilege('authenticated','nexora_enforce_seat_limit()','EXECUTE') AS seat_trigger`);
    assert.deepEqual(agentPrivileges.rows[0], {
      metadata: true,
      secret: false,
      grant_capability: false,
      alter_agent: false,
      truncate_requests: false,
      provision_trial: false,
      plan_trigger: false,
      seat_trigger: false,
    });

    const billingPrivileges = await db.query(`SELECT
      has_table_privilege('anon','billing_plans','SELECT') AS public_plan_read,
      has_table_privilege('anon','billing_plans','TRUNCATE') AS public_plan_truncate,
      has_table_privilege('authenticated','billing_plans','UPDATE') AS plan_write,
      has_table_privilege('authenticated','billing_subscriptions','SELECT') AS subscription_read,
      has_table_privilege('authenticated','billing_subscriptions','UPDATE') AS subscription_write,
      has_table_privilege('anon','profiles','SELECT') AS anonymous_profile_read,
      has_function_privilege('anon','update_updated_at_column()','EXECUTE') AS timestamp_rpc,
      has_function_privilege('authenticated','nexora_billing_usage(uuid)','EXECUTE') AS billing_rpc`);
    assert.deepEqual(billingPrivileges.rows[0], {
      public_plan_read: true,
      public_plan_truncate: false,
      plan_write: false,
      subscription_read: true,
      subscription_write: false,
      anonymous_profile_read: false,
      timestamp_rpc: false,
      billing_rpc: false,
    });

    await db.exec(`
      CREATE TABLE public.default_privilege_probe(id integer);
      CREATE FUNCTION public.default_function_probe()
      RETURNS integer LANGUAGE sql AS 'SELECT 1';
    `);
    const defaultPrivileges = await db.query(`SELECT
      has_table_privilege('anon','default_privilege_probe','SELECT') AS anon_table,
      has_table_privilege('authenticated','default_privilege_probe','SELECT') AS authenticated_table,
      has_function_privilege('anon','default_function_probe()','EXECUTE') AS anon_function,
      has_function_privilege('authenticated','default_function_probe()','EXECUTE') AS authenticated_function`);
    assert.deepEqual(defaultPrivileges.rows[0], {
      anon_table: false,
      authenticated_table: false,
      anon_function: false,
      authenticated_function: false,
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
      await db.query(
        "SELECT plan_key,status,last_event_id FROM billing_subscriptions WHERE org_id=$1",
        [org],
      )
    ).rows[0];
    assert.deepEqual(subscription, {
      plan_key: "team",
      status: "active",
      last_event_id: "evt_new",
    });

    await assert.rejects(
      db.query(
        "SELECT nexora_apply_paddle_event($1,$2,$3,$4,true,'solo','active','ctm_1','sub_2',NULL,NULL,false)",
        ["evt_replace_active", "2026-09-17T10:30:00Z", "subscription.created", org],
      ),
    );
    await db.query(
      "SELECT nexora_apply_paddle_event($1,$2,$3,$4,true,'team','canceled','ctm_1','sub_1',NULL,NULL,false)",
      ["evt_canceled", "2026-09-17T11:00:00Z", "subscription.canceled", org],
    );
    await assert.rejects(
      db.query(
        "SELECT nexora_apply_paddle_event($1,$2,$3,$4,false,'solo','active','ctm_1','sub_2',NULL,NULL,false)",
        ["evt_replace_unsigned", "2026-09-17T12:00:00Z", "subscription.created", org],
      ),
    );
    const replacement = await db.query(
      "SELECT nexora_apply_paddle_event($1,$2,$3,$4,true,'solo','active','ctm_1','sub_2',NULL,NULL,false) AS result",
      ["evt_replace", "2026-09-17T12:00:00Z", "subscription.created", org],
    );
    assert.deepEqual(replacement.rows[0].result, {
      result: "processed",
      subscription_replaced: true,
    });
    const replaced = (
      await db.query(
        "SELECT plan_key,status,provider_subscription_id,last_event_id FROM billing_subscriptions WHERE org_id=$1",
        [org],
      )
    ).rows[0];
    assert.deepEqual(replaced, {
      plan_key: "solo",
      status: "active",
      provider_subscription_id: "sub_2",
      last_event_id: "evt_replace",
    });

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
