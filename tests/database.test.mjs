import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("migration versions are unique", async () => {
  const names = (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql"));
  const versions = names.map((name) => name.split("_")[0]);
  assert.equal(
    new Set(versions).size,
    versions.length,
    "Duplicate migration versions skip production DDL",
  );
});

test("first-member bootstrap with RETURNING succeeds without exposing other tenants", async () => {
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
    const founder = "00000000-0000-4000-8000-000000000301";
    const stranger = "00000000-0000-4000-8000-000000000302";
    const founderOrg = "00000000-0000-4000-8000-000000000303";
    const strangerOrg = "00000000-0000-4000-8000-000000000304";
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [founder, stranger]);
    // Another tenant with its own member, created outside RLS.
    await db.query("INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'s','s',$2)", [
      strangerOrg,
      stranger,
    ]);
    await db.query("INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin')", [
      strangerOrg,
      stranger,
    ]);
    await db.exec(
      `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT ''${founder}''::uuid';`,
    );
    await db.exec("SET ROLE authenticated");
    await db.query("INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'f','f',$2)", [
      founderOrg,
      founder,
    ]);
    // PostgREST return=representation issues INSERT ... RETURNING.
    const inserted = await db.query(
      "INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin') RETURNING org_id, user_id",
      [founderOrg, founder],
    );
    assert.deepEqual(inserted.rows, [{ org_id: founderOrg, user_id: founder }]);
    // Negative path: the founder still cannot read or join the other tenant.
    const foreign = await db.query("SELECT count(*)::int AS n FROM org_members WHERE org_id=$1", [
      strangerOrg,
    ]);
    assert.equal(foreign.rows[0].n, 0);
    await assert.rejects(
      db.query("INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin')", [
        strangerOrg,
        founder,
      ]),
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

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
    // A newly authenticated organization creator must be able to bootstrap only
    // themselves as the first org_admin. This reproduces the production RLS path.
    const bootstrapUser = "00000000-0000-4000-8000-000000000101";
    const bootstrapOther = "00000000-0000-4000-8000-000000000102";
    const bootstrapOrg = "00000000-0000-4000-8000-000000000103";
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [bootstrapUser, bootstrapOther]);
    await db.exec(
      `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT ''${bootstrapUser}''::uuid';`,
    );
    await db.exec("SET ROLE authenticated");
    await db.query(
      "INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'bootstrap','bootstrap',$2)",
      [bootstrapOrg, bootstrapUser],
    );
    await assert.rejects(
      db.query("INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin')", [
        bootstrapOrg,
        bootstrapOther,
      ]),
    );
    await db.query("INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin')", [
      bootstrapOrg,
      bootstrapUser,
    ]);
    await db.exec("RESET ROLE");
    await db.exec(
      "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT null::uuid';",
    );

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

    const seatLimitHardening = await db.query(`SELECT
      p.prosecdef AS security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'nexora_enforce_seat_limit'`);
    assert.equal(seatLimitHardening.rows.length, 1);
    assert.equal(seatLimitHardening.rows[0].security_definer, true);

    const billingPrivileges = await db.query(`SELECT
      has_table_privilege('anon','billing_plans','SELECT') AS public_plan_read,
      has_table_privilege('anon','billing_plans','TRUNCATE') AS public_plan_truncate,
      has_table_privilege('authenticated','billing_plans','UPDATE') AS plan_write,
      has_table_privilege('authenticated','billing_subscriptions','SELECT') AS subscription_read,
      has_table_privilege('authenticated','billing_subscriptions','UPDATE') AS subscription_write,
      has_table_privilege('anon','profiles','SELECT') AS anonymous_profile_read,
      has_function_privilege('anon','update_updated_at_column()','EXECUTE') AS timestamp_rpc,
      has_function_privilege('authenticated','nexora_billing_usage(uuid)','EXECUTE') AS billing_rpc,
      has_table_privilege('authenticated','device_ai_inventory','INSERT') AS device_inventory_write`);
    assert.deepEqual(billingPrivileges.rows[0], {
      public_plan_read: true,
      public_plan_truncate: false,
      plan_write: false,
      subscription_read: true,
      subscription_write: false,
      anonymous_profile_read: false,
      timestamp_rpc: false,
      billing_rpc: false,
      device_inventory_write: false,
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

    const controlPrivileges = await db.query(`SELECT
      has_table_privilege('authenticated','org_ai_controls','SELECT') AS controls_read,
      has_table_privilege('authenticated','org_ai_controls','UPDATE') AS controls_write,
      has_table_privilege('authenticated','execution_events','SELECT') AS events_read,
      has_table_privilege('authenticated','execution_events','INSERT') AS events_write,
      has_table_privilege('anon','execution_events','SELECT') AS anon_events_read`);
    assert.deepEqual(controlPrivileges.rows[0], {
      controls_read: true,
      controls_write: false,
      events_read: true,
      events_write: false,
      anon_events_read: false,
    });

    const seededControls = (
      await db.query(
        "SELECT execution_enabled,console_enabled,agents_enabled,max_request_cost_usd FROM org_ai_controls WHERE org_id=$1",
        [org],
      )
    ).rows[0];
    assert.deepEqual(seededControls, {
      execution_enabled: true,
      console_enabled: true,
      agents_enabled: true,
      max_request_cost_usd: null,
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
    assert.equal(
      (
        await db.query("SELECT private.has_feature_entitlement($1,'mcp_controls') AS allowed", [
          org,
        ])
      ).rows[0].allowed,
      true,
    );

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
    assert.equal(
      (
        await db.query("SELECT private.has_feature_entitlement($1,'mcp_controls') AS allowed", [
          org,
        ])
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO device_ai_inventory(org_id,agent_id,device_fingerprint,platform,observation_key,observation_type,app_name) VALUES($1,$2,$3,'linux',$4,'desktop_app','ChatGPT')",
        [org, agent, "c".repeat(64), "d".repeat(64)],
      ),
    );

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

// ---------------------------------------------------------------------------
// Shared helpers for the coverage and RLS-hardening tests below. They use the
// same Supabase role/auth shims and migration replay as the tests above.
// ---------------------------------------------------------------------------
async function migratedDb() {
  const db = new PGlite();
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
  return db;
}

// Switch the simulated JWT subject (and email claim). Always called while the
// session runs as the migration owner, never as an API role.
async function actAs(db, uid, email = null) {
  const sub = uid ? `'${uid}'::uuid` : "null::uuid";
  const claims = JSON.stringify(email ? { sub: uid, email } : {}).replace(/'/g, "''");
  await db.exec(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT ${sub} $$;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '${claims}'::jsonb $$;
  `);
}

async function asAuthenticated(db, uid, fn, email = null) {
  await actAs(db, uid, email);
  await db.exec("SET ROLE authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
    await actAs(db, null);
  }
}

const reserveOn = async (db, org, key, cost = 0.01) =>
  (await db.query("SELECT nexora_reserve($1,$2,$3) AS r", [org, key, cost])).rows[0].r;

test("admission fails closed for expired trials and inactive subscriptions", async () => {
  const db = await migratedDb();
  try {
    const owner = "00000000-0000-4000-8000-000000000401";
    const org = "00000000-0000-4000-8000-000000000402";
    await db.query("INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'t','t',$2)", [
      org,
      owner,
    ]);
    // Positive control: the provisioned 14-day Team trial admits.
    const trial = (
      await db.query("SELECT plan_key,status FROM billing_subscriptions WHERE org_id=$1", [org])
    ).rows[0];
    assert.deepEqual(trial, { plan_key: "team", status: "trialing" });
    assert.equal((await reserveOn(db, org, "trial-live")).admitted, true);

    await db.query(
      "UPDATE billing_subscriptions SET trial_ends_at=now()-interval '1 second' WHERE org_id=$1",
      [org],
    );
    const expired = await reserveOn(db, org, "trial-expired");
    assert.deepEqual(expired, {
      admitted: false,
      reason: "An active subscription is required.",
    });
    for (const status of ["past_due", "canceled", "incomplete"]) {
      await db.query(
        "UPDATE billing_subscriptions SET status=$2,trial_ends_at=NULL WHERE org_id=$1",
        [org, status],
      );
      const denied = await reserveOn(db, org, `inactive-${status}`);
      assert.equal(denied.admitted, false, status);
      assert.equal(denied.reason, "An active subscription is required.", status);
    }
    // A trialing row with no end date is not an open-ended trial.
    await db.query(
      "UPDATE billing_subscriptions SET status='trialing',trial_ends_at=NULL WHERE org_id=$1",
      [org],
    );
    assert.equal((await reserveOn(db, org, "trial-null-end")).admitted, false);
    // Missing subscription row fails closed as well.
    await db.query("DELETE FROM billing_subscriptions WHERE org_id=$1", [org]);
    assert.equal((await reserveOn(db, org, "no-subscription")).admitted, false);

    // No reservation (and therefore no billable dispatch) for any denied call.
    const held = await db.query(
      "SELECT array_agg(idempotency_key ORDER BY idempotency_key) AS keys FROM gateway_reservations WHERE org_id=$1",
      [org],
    );
    assert.deepEqual(held.rows[0].keys, ["trial-live"]);
    // Premium entitlements and plan-limited resources fail closed too.
    assert.equal(
      (await db.query("SELECT private.has_feature_entitlement($1,'mcp_controls') AS ok", [org]))
        .rows[0].ok,
      false,
    );
    await assert.rejects(
      db.query("INSERT INTO agents(org_id,name,slug,owner_id) VALUES($1,'a','a',$2)", [org, owner]),
      /An active subscription is required/,
    );
  } finally {
    await db.close();
  }
});

test("agent call rate limit admits the 60th call in a minute and rejects the 61st", async () => {
  const db = await migratedDb();
  try {
    const owner = "00000000-0000-4000-8000-000000000411";
    const org = "00000000-0000-4000-8000-000000000412";
    const agent = "00000000-0000-4000-8000-000000000413";
    const tokenHash = "e".repeat(64);
    await db.query("INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'r','r',$2)", [
      org,
      owner,
    ]);
    await db.query("INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'agent_admin')", [
      org,
      owner,
    ]);
    await db.query(
      "INSERT INTO agents(id,org_id,name,slug,owner_id,status,token_hash,credential_expires_at) VALUES($1,$2,'rl','rl',$3,'active',$4,now()+interval '1 day')",
      [agent, org, owner, tokenHash],
    );
    const claim = () =>
      db.query("SELECT nexora_claim_agent($1,gen_random_uuid(),$2,NULL) AS r", [agent, tokenHash]);
    for (let i = 1; i <= 59; i++) await claim();
    const sixtieth = await claim();
    assert.equal(sixtieth.rows[0].r.id, agent);
    await assert.rejects(claim(), /Agent rate limit exceeded/);
    const calls = await db.query("SELECT count(*)::int AS n FROM agent_calls WHERE agent_id=$1", [
      agent,
    ]);
    assert.equal(calls.rows[0].n, 60);
    // The window is one minute: once older calls age out, admission resumes.
    await db.query(
      "UPDATE agent_calls SET created_at=now()-interval '61 seconds' WHERE agent_id=$1",
      [agent],
    );
    assert.equal((await claim()).rows[0].r.id, agent);
  } finally {
    await db.close();
  }
});

test("connection-code rate limit admits the 100th start in a minute and rejects the 101st", async () => {
  const db = await migratedDb();
  try {
    const start = (i) =>
      db.query("SELECT nexora_start_connection($1,$2,'Rate test',ARRAY['requests:read']::text[])", [
        i.toString(16).padStart(64, "0"),
        i.toString(16).toUpperCase().padStart(10, "0"),
      ]);
    for (let i = 1; i <= 99; i++) await start(i);
    await start(100);
    const count = await db.query("SELECT count(*)::int AS n FROM agent_connections");
    assert.equal(count.rows[0].n, 100);
    await assert.rejects(start(101), /Connection rate limit/);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM agent_connections")).rows[0].n,
      100,
    );
  } finally {
    await db.close();
  }
});

test("monthly plan request limit is enforced at admission", async () => {
  const db = await migratedDb();
  try {
    const owner = "00000000-0000-4000-8000-000000000421";
    const org = "00000000-0000-4000-8000-000000000422";
    await db.query("INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'q','q',$2)", [
      org,
      owner,
    ]);
    await db.query(
      "UPDATE billing_subscriptions SET plan_key='solo',status='active',trial_ends_at=NULL WHERE org_id=$1",
      [org],
    );
    const limit = (
      await db.query("SELECT monthly_request_limit AS n FROM billing_plans WHERE plan_key='solo'")
    ).rows[0].n;
    assert.equal(limit, 25000);
    // Last month's traffic does not count against this month.
    await db.query(
      "INSERT INTO requests(org_id,decision,status,created_at) SELECT $1,'ALLOW','completed',date_trunc('month',now())-interval '1 day' FROM generate_series(1,10)",
      [org],
    );
    await db.query(
      "INSERT INTO requests(org_id,decision,status) SELECT $1,'ALLOW','completed' FROM generate_series(1,$2::int)",
      [org, limit - 1],
    );
    // The limit-th request of the month is admitted ...
    assert.deepEqual(await reserveOn(db, org, "at-limit"), { admitted: true, reason: "Reserved" });
    // ... and the next one is denied, counting the in-flight reservation.
    assert.deepEqual(await reserveOn(db, org, "over-limit"), {
      admitted: false,
      reason: "Monthly plan request limit reached.",
    });
    const reserved = await db.query(
      "SELECT count(*)::int AS n FROM gateway_reservations WHERE org_id=$1 AND idempotency_key='over-limit'",
      [org],
    );
    assert.equal(reserved.rows[0].n, 0);
    // Enterprise (no request ceiling) admits the same organization.
    await db.query("UPDATE billing_subscriptions SET plan_key='enterprise' WHERE org_id=$1", [org]);
    assert.equal((await reserveOn(db, org, "enterprise")).admitted, true);
  } finally {
    await db.close();
  }
});

test("an org A member reads no org B rows from any org-scoped public table", async () => {
  const db = await migratedDb();
  try {
    const userA = "00000000-0000-4000-8000-000000000431";
    const userB = "00000000-0000-4000-8000-000000000432";
    const orgA = "00000000-0000-4000-8000-000000000433";
    const orgB = "00000000-0000-4000-8000-000000000434";
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [userA, userB]);
    await db.query(
      "INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'A','a',$3),($2,'B','b',$4)",
      [orgA, orgB, userA, userB],
    );
    await db.query(
      "INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin'),($3,$4,'org_admin')",
      [orgA, userA, orgB, userB],
    );
    // Seed org B across the schema as the migration owner (outside RLS).
    await db.exec(`
      DO $$
      DECLARE b uuid := '${orgB}'; u uuid := '${userB}';
        prov uuid; pol uuid; req uuid; ag uuid; srv uuid; tool uuid; it uuid; it2 uuid;
      BEGIN
        INSERT INTO public.profiles(id,email) VALUES(u,'b@example.test');
        INSERT INTO public.providers(org_id,name,vendor) VALUES(b,'p','openai') RETURNING id INTO prov;
        INSERT INTO public.models(org_id,provider_id,model_key,display_name) VALUES(b,prov,'m','M');
        INSERT INTO public.policies(org_id,name,action,created_by) VALUES(b,'p','LOG',u) RETURNING id INTO pol;
        INSERT INTO public.policy_versions(org_id,policy_id,version,snapshot,created_by) VALUES(b,pol,1,'{}',u);
        INSERT INTO public.requests(org_id,user_id,decision,idempotency_key) VALUES(b,u,'ALLOW','b-req') RETURNING id INTO req;
        INSERT INTO public.security_findings(org_id,request_id,severity,category,title) VALUES(b,req,'high','c','t');
        INSERT INTO public.audit_events(org_id,actor_id,action,resource) VALUES(b,u,'x','y');
        INSERT INTO public.budgets(org_id,name,limit_usd) VALUES(b,'cap',10);
        INSERT INTO public.approvals(org_id,requester_id,action) VALUES(b,u,'gateway.execute');
        INSERT INTO public.agents(org_id,name,slug,owner_id,status,token_hash,credential_expires_at)
          VALUES(b,'ag','ag',u,'active',repeat('f',64),now()+interval '1 day') RETURNING id INTO ag;
        INSERT INTO public.agent_capabilities(org_id,agent_id,capability,granted_by) VALUES(b,ag,'requests:read',u);
        INSERT INTO public.agent_calls(org_id,agent_id,idempotency_key) VALUES(b,ag,gen_random_uuid());
        INSERT INTO public.agent_connections(device_hash,user_code,client_name,scopes,org_id,agent_id,status)
          VALUES(repeat('1',64),'1111111111','c',ARRAY['requests:read'],b,ag,'approved');
        INSERT INTO public.org_invites(org_id,email,role,invited_by) VALUES(b,'x@example.test','viewer',u);
        INSERT INTO public.mcp_servers(org_id,name,url,created_by) VALUES(b,'s','https://mcp.example.test',u) RETURNING id INTO srv;
        INSERT INTO public.mcp_tools(org_id,server_id,tool_name,required_capability) VALUES(b,srv,'t','requests:read') RETURNING id INTO tool;
        INSERT INTO public.mcp_tool_grants(org_id,agent_id,tool_id,granted_by) VALUES(b,ag,tool,u);
        INSERT INTO public.tool_invocations(org_id,agent_id,tool_id,idempotency_key) VALUES(b,ag,tool,gen_random_uuid());
        INSERT INTO public.device_ai_inventory(org_id,agent_id,device_fingerprint,platform,observation_key,observation_type,app_name)
          VALUES(b,ag,repeat('a',64),'linux',repeat('b',64),'desktop_app','ChatGPT');
        INSERT INTO public.execution_events(org_id,execution_id,actor_type,stage,status,summary)
          VALUES(b,gen_random_uuid(),'user','identity','passed','s');
        INSERT INTO public.gateway_reservations(org_id,idempotency_key,reserved_usd) VALUES(b,'b-res',1);
        INSERT INTO public.intents(org_id,objective_fingerprint) VALUES(b,repeat('c',32)) RETURNING id INTO it;
        INSERT INTO public.intents(org_id,objective_fingerprint) VALUES(b,repeat('d',32)) RETURNING id INTO it2;
        INSERT INTO public.intent_lineage_events(org_id,parent_intent_id,child_intent_id,event_type,confidence,reason)
          VALUES(b,it,it2,'LINKED',0.5,'r');
        INSERT INTO public.governed_executions(org_id,intent_id,trace_id,actor_type) VALUES(b,it,repeat('e',32),'user');
        INSERT INTO public.governance_risk_thresholds(org_id,severity,max_violations) VALUES(b,'high',3);
        INSERT INTO public.paddle_webhook_events(event_id,occurred_at,event_type,org_id,provider_subscription_id,result)
          VALUES('evt_b',now(),'subscription.updated',b,'sub_b','processed');
      END $$;
    `);
    // Positive control so the authenticated session is not trivially empty.
    await db.query("INSERT INTO providers(org_id,name,vendor) VALUES($1,'pa','openai')", [orgA]);

    const tables = (
      await db.query(`SELECT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema='public' AND c.column_name='org_id' AND t.table_type='BASE TABLE'
        ORDER BY 1`)
    ).rows.map((r) => r.t);
    assert.ok(tables.length >= 30, `expected the full org-scoped schema, got ${tables.length}`);

    // Make the denial non-vacuous: org B really owns rows in these tables.
    const seeded = [];
    for (const t of tables) {
      const n = (
        await db.query(`SELECT count(*)::int AS n FROM public.${t} WHERE org_id=$1`, [orgB])
      ).rows[0].n;
      if (n > 0) seeded.push(t);
    }
    assert.ok(seeded.length >= 28, `org B seeded in only ${seeded.join(",")}`);

    const leaks = [];
    const denied = [];
    await asAuthenticated(db, userA, async () => {
      for (const t of tables) {
        try {
          const n = (
            await db.query(`SELECT count(*)::int AS n FROM public.${t} WHERE org_id=$1`, [orgB])
          ).rows[0].n;
          if (n !== 0) leaks.push(`${t}:${n}`);
        } catch (error) {
          // No grant at all is also a denial; anything else is a test failure.
          assert.match(String(error.message), /permission denied/, t);
          denied.push(t);
        }
      }
      const foreignOrg = await db.query(
        "SELECT count(*)::int AS n FROM organizations WHERE id=$1",
        [orgB],
      );
      if (foreignOrg.rows[0].n !== 0) leaks.push("organizations");
      const foreignProfile = await db.query("SELECT count(*)::int AS n FROM profiles WHERE id=$1", [
        userB,
      ]);
      if (foreignProfile.rows[0].n !== 0) leaks.push("profiles");

      const own = await db.query(
        `SELECT (SELECT count(*)::int FROM organizations WHERE id=$1) AS org,
          (SELECT count(*)::int FROM providers WHERE org_id=$1) AS providers,
          (SELECT count(*)::int FROM billing_subscriptions WHERE org_id=$1) AS subscription`,
        [orgA],
      );
      assert.deepEqual(own.rows[0], { org: 1, providers: 1, subscription: 1 });
    });
    assert.deepEqual(leaks, [], `cross-tenant rows visible: ${leaks.join(", ")}`);
    // Server-only tables must stay ungranted to the browser role.
    for (const t of [
      "agent_calls",
      "agent_connections",
      "gateway_reservations",
      "paddle_webhook_events",
    ]) {
      assert.ok(denied.includes(t), `${t} should not be readable by authenticated`);
    }
  } finally {
    await db.close();
  }
});

test("RLS hardening: invites, stray grants, dead write policies, helper search_path", async () => {
  const db = await migratedDb();
  try {
    // The hardening migration is idempotent: replaying it changes nothing.
    await db.exec(await readFile("supabase/migrations/20261126000100_rls_hardening.sql", "utf8"));
    const admin = "00000000-0000-4000-8000-000000000441";
    const platform = "00000000-0000-4000-8000-000000000442";
    const outsider = "00000000-0000-4000-8000-000000000443";
    const developer = "00000000-0000-4000-8000-000000000444";
    const org = "00000000-0000-4000-8000-000000000445";
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2),($3),($4)", [
      admin,
      platform,
      outsider,
      developer,
    ]);
    await db.query("INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'h','h',$2)", [
      org,
      admin,
    ]);
    await db.query(
      "INSERT INTO org_members(org_id,user_id,role) VALUES($1,$2,'org_admin'),($1,$3,'platform_admin'),($1,$4,'developer')",
      [org, admin, platform, developer],
    );

    // L2: an org_admin cannot mint a platform_admin invite, but can invite others.
    await asAuthenticated(db, admin, async () => {
      await assert.rejects(
        db.query(
          "INSERT INTO org_invites(org_id,email,role,invited_by) VALUES($1,'esc@example.test','platform_admin',$2)",
          [org, admin],
        ),
        /row-level security/,
      );
      const ok = await db.query(
        "INSERT INTO org_invites(org_id,email,role,invited_by) VALUES($1,'dev@example.test','developer',$2) RETURNING role",
        [org, admin],
      );
      assert.deepEqual(ok.rows, [{ role: "developer" }]);
      // Nor can an existing invite be escalated in place.
      await assert.rejects(
        db.query("UPDATE org_invites SET role='platform_admin' WHERE org_id=$1", [org]),
        /row-level security/,
      );
    });
    // A platform_admin still can, mirroring the org_members insert policy.
    await asAuthenticated(db, platform, async () => {
      const ok = await db.query(
        "INSERT INTO org_invites(org_id,email,role,invited_by) VALUES($1,'pa@example.test','platform_admin',$2) RETURNING role",
        [org, platform],
      );
      assert.deepEqual(ok.rows, [{ role: "platform_admin" }]);
    });
    // Non-admins still cannot create invites at all.
    await asAuthenticated(db, developer, async () => {
      await assert.rejects(
        db.query(
          "INSERT INTO org_invites(org_id,email,role,invited_by) VALUES($1,'v@example.test','viewer',$2)",
          [org, developer],
        ),
      );
    });
    // Invitees still read their own invite through the (wrapped) jwt policy.
    await asAuthenticated(
      db,
      outsider,
      async () => {
        const mine = await db.query(
          "SELECT role FROM org_invites WHERE lower(email)='dev@example.test'",
        );
        assert.deepEqual(mine.rows, [{ role: "developer" }]);
        assert.equal((await db.query("SELECT count(*)::int AS n FROM org_invites")).rows[0].n, 1);
      },
      "DEV@example.test",
    );

    // L4: grants that no policy uses are gone.
    const grants = await db.query(`SELECT
      has_table_privilege('authenticated','public.org_members','UPDATE') AS member_update,
      has_table_privilege('authenticated','public.organizations','DELETE') AS org_delete,
      has_table_privilege('authenticated','public.profiles','DELETE') AS profile_delete,
      has_table_privilege('authenticated','public.policy_versions','DELETE') AS version_delete,
      has_table_privilege('authenticated','public.org_members','INSERT') AS member_insert,
      has_table_privilege('authenticated','public.org_members','DELETE') AS member_delete,
      has_table_privilege('authenticated','public.organizations','UPDATE') AS org_update,
      has_table_privilege('authenticated','public.profiles','UPDATE') AS profile_update,
      has_table_privilege('authenticated','public.policy_versions','INSERT') AS version_insert`);
    assert.deepEqual(grants.rows[0], {
      member_update: false,
      org_delete: false,
      profile_delete: false,
      version_delete: false,
      member_insert: true,
      member_delete: true,
      org_update: true,
      profile_update: true,
      version_insert: true,
    });

    // L4/L5: write policies without a matching grant are dropped.
    const dead = await db.query(`SELECT tablename || ':' || policyname AS p FROM pg_policies
      WHERE schemaname='public' AND (tablename, policyname) IN (
        ('approvals','members create approvals'), ('approvals','approvers decide'),
        ('audit_events','members insert audit'), ('requests','members insert requests'),
        ('security_findings','members insert findings'),
        ('security_findings','security updates findings'))`);
    assert.deepEqual(dead.rows, []);
    // The read policies and the entitlement guard on approvals remain.
    const kept =
      await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public'
      AND (tablename, policyname) IN (('approvals','members read approvals'),
        ('approvals','approvals require entitlement'), ('audit_events','members read audit'),
        ('requests','members read requests'), ('security_findings','members read findings'))`);
    assert.equal(kept.rows[0].n, 5);

    // auth_rls_initplan: no policy evaluates auth.uid()/auth.jwt() per row.
    const perRow = await db.query(`SELECT tablename || ':' || policyname AS p FROM pg_policies
      WHERE schemaname='public'
        AND regexp_replace(coalesce(qual,'') || ' ' || coalesce(with_check,''),
          '\\(\\s*SELECT auth\\.(uid|jwt)\\(\\) AS (uid|jwt)\\)', '', 'g') ~ 'auth\\.(uid|jwt)\\(\\)'`);
    assert.deepEqual(perRow.rows, []);

    // M1: helpers pin an empty search_path and keep owner/grants.
    const helpers = await db.query(`SELECT p.proname, p.prosecdef, p.proconfig,
        pg_get_userbyid(p.proowner) AS owner,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='private' AND p.proname IN ('is_org_member','has_org_role') ORDER BY 1`);
    assert.deepEqual(
      helpers.rows.map((r) => ({ ...r })),
      ["has_org_role", "is_org_member"].map((proname) => ({
        proname,
        prosecdef: true,
        proconfig: ['search_path=""'],
        owner: "postgres",
        auth_exec: true,
        service_exec: true,
        anon_exec: false,
      })),
    );

    // RLS still works through the hardened helpers.
    await asAuthenticated(db, developer, async () => {
      const own = await db.query("SELECT id FROM organizations");
      assert.deepEqual(own.rows, [{ id: org }]);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM org_members")).rows[0].n, 3);
      // has_org_role: a developer is not an org admin.
      const renamed = await db.query("UPDATE organizations SET name='x' WHERE id=$1 RETURNING id", [
        org,
      ]);
      assert.equal(renamed.rows.length, 0);
    });
    await asAuthenticated(db, admin, async () => {
      const renamed = await db.query("UPDATE organizations SET name='y' WHERE id=$1 RETURNING id", [
        org,
      ]);
      assert.deepEqual(renamed.rows, [{ id: org }]);
      // Own profile policies (wrapped auth.uid()) still work, others are denied.
      await db.query("INSERT INTO profiles(id,email) VALUES($1,'a@example.test')", [admin]);
      await assert.rejects(
        db.query("INSERT INTO profiles(id,email) VALUES($1,'o@example.test')", [outsider]),
      );
      assert.deepEqual((await db.query("SELECT id FROM profiles")).rows, [{ id: admin }]);
    });
    await asAuthenticated(db, outsider, async () => {
      assert.equal((await db.query("SELECT count(*)::int AS n FROM organizations")).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM org_members")).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM org_invites")).rows[0].n, 0);
    });
  } finally {
    await db.close();
  }
});
