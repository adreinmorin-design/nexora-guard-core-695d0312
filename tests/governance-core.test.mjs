import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  canonicalJson,
  computeGovernanceEventHash,
  hashGovernanceContext,
  verifyGovernanceChain,
} from "../src/lib/nexora/audit-integrity.ts";
import {
  executionOutcomeForLegacyResult,
  legacyActionToPolicyOutcome,
  policyOutcomeAllowsDownstream,
} from "../src/lib/nexora/governance-types.ts";
import { evaluateHistoricalContext } from "../src/lib/nexora/retrospective-policy.ts";

test("legacy policy mapping preserves deny and transformation semantics", () => {
  assert.equal(legacyActionToPolicyOutcome("ALLOW"), "ALLOW");
  assert.equal(legacyActionToPolicyOutcome("LOG"), "ALLOW");
  assert.equal(legacyActionToPolicyOutcome("REDACT"), "ALLOW_WITH_TRANSFORMATION");
  assert.equal(legacyActionToPolicyOutcome("REQUIRE_APPROVAL"), "REQUIRE_APPROVAL");
  assert.equal(legacyActionToPolicyOutcome("BLOCK"), "DENY_EXECUTION");
  assert.equal(policyOutcomeAllowsDownstream("DENY_ACTION"), false);
  assert.equal(policyOutcomeAllowsDownstream("DENY_EXECUTION"), false);
  assert.equal(policyOutcomeAllowsDownstream("QUARANTINE"), false);
  assert.equal(policyOutcomeAllowsDownstream("ALLOW_WITH_TRANSFORMATION"), true);
});

test("workflow outcome stays separate from governance decision", () => {
  assert.equal(
    executionOutcomeForLegacyResult({
      action: "BLOCK",
      status: "blocked",
      providerExecuted: false,
      redacted: false,
    }),
    "DENIED_BEFORE_EXECUTION",
  );
  assert.equal(
    executionOutcomeForLegacyResult({
      action: "BLOCK",
      status: "response_blocked",
      providerExecuted: true,
      redacted: false,
    }),
    "COMPLETED_WITH_POLICY_BLOCK",
  );
  assert.equal(
    executionOutcomeForLegacyResult({
      action: "REDACT",
      status: "completed",
      providerExecuted: true,
      redacted: true,
    }),
    "COMPLETED_WITH_REDACTION",
  );
});

test("canonical serialization is deterministic", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(canonicalJson({ a: [3, 2, 1], b: null }), '{"a":[3,2,1],"b":null}');
});

test("governance hash chain detects modification, deletion and reordering", async () => {
  const base = {
    traceId: "1".repeat(32),
    executionId: "00000000-0000-4000-8000-000000000010",
    intentId: "00000000-0000-4000-8000-000000000011",
    parentEventId: null,
    actorId: "00000000-0000-4000-8000-000000000012",
    agentId: null,
    organizationId: "00000000-0000-4000-8000-000000000013",
    applicationId: "console",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    decision: "ALLOW",
    reason: "baseline policy admitted execution",
    evaluatedContextHash: await hashGovernanceContext({ classification: "internal" }),
    timestamp: "2026-09-25T12:00:00.000Z",
    decisionEngineVersion: "nexora-policy/2",
    enforcementPoint: "PRE_EXECUTION",
    attributes: { classification: "internal" },
  };
  const firstInput = {
    ...base,
    previousEventHash: null,
    chainPosition: 1,
    eventId: "00000000-0000-4000-8000-000000000014",
  };
  const first = { ...firstInput, eventHash: await computeGovernanceEventHash(firstInput) };
  const secondInput = {
    ...base,
    previousEventHash: first.eventHash,
    chainPosition: 2,
    eventId: "00000000-0000-4000-8000-000000000015",
    parentEventId: first.eventId,
    decision: "DENY_ACTION",
    reason: "tool not authorized",
    enforcementPoint: "PRE_TOOL_INVOCATION",
  };
  const second = { ...secondInput, eventHash: await computeGovernanceEventHash(secondInput) };

  assert.deepEqual(await verifyGovernanceChain([first, second]), {
    valid: true,
    failingIndex: null,
    reason: null,
  });

  const modified = [{ ...first, reason: "rewritten history" }, second];
  assert.equal((await verifyGovernanceChain(modified)).reason, "event_hash_mismatch");
  assert.equal((await verifyGovernanceChain([second])).reason, "chain_position_gap_or_reorder");
  assert.equal((await verifyGovernanceChain([second, first])).valid, false);
});


test("retrospective evaluation reports WOULD_BLOCK without rewriting original decision", () => {
  const currentPolicies = [
    {
      id: "00000000-0000-4000-8000-000000000201",
      name: "Policy v13",
      description: null,
      priority: 10,
      action: "BLOCK",
      version: 13,
      status: "active",
      scope: "organization",
      conditions: [{ field: "provider", op: "equals", value: "openai" }],
    },
  ];
  const result = evaluateHistoricalContext(
    currentPolicies,
    {
      detectionCategories: [],
      modelKey: "openai/gpt-4.1-mini",
      modelClassification: "standard",
      provider: "openai",
      estimatedCostUsd: 0.01,
      monthlySpendUsd: 1,
      actorType: "user",
      stage: "request",
    },
    {
      policyId: "00000000-0000-4000-8000-000000000200",
      policyVersion: 12,
      decision: "ALLOW",
    },
  );

  assert.equal(result.originalPolicyVersion, 12);
  assert.equal(result.originalDecision, "ALLOW");
  assert.equal(result.currentPolicyVersion, 13);
  assert.equal(result.currentDecision, "BLOCK");
  assert.equal(result.disposition, "WOULD_BLOCK");
});

test("governance evidence and lineage are immutable at the database boundary", async () => {
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

    const org = "00000000-0000-4000-8000-000000000101";
    const user = "00000000-0000-4000-8000-000000000102";
    const intent = "00000000-0000-4000-8000-000000000103";
    const child = "00000000-0000-4000-8000-000000000104";
    const execution = "00000000-0000-4000-8000-000000000105";
    const event = "00000000-0000-4000-8000-000000000106";
    const traceId = "2".repeat(32);
    const spanId = "3".repeat(16);
    const contextHash = "4".repeat(64);

    await db.query(
      "INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'gov','gov',$2)",
      [org, user],
    );
    await db.query(
      "INSERT INTO intents(id,org_id,created_by_actor_id,objective_fingerprint) VALUES($1,$2,$3,$4),($5,$2,$3,$6)",
      [intent, org, user, "intent-fingerprint-0001", child, "intent-fingerprint-0002"],
    );
    await db.query(
      "INSERT INTO governed_executions(id,org_id,intent_id,trace_id,actor_id,actor_type) VALUES($1,$2,$3,$4,$5,'user')",
      [execution, org, intent, traceId, user],
    );

    const hashInput = {
      previousEventHash: null,
      chainPosition: 1,
      eventId: event,
      traceId,
      executionId: execution,
      intentId: intent,
      parentEventId: null,
      actorId: user,
      agentId: null,
      organizationId: org,
      applicationId: "console",
      policyId: null,
      policyVersion: null,
      ruleId: null,
      decision: "ALLOW",
      reason: "authorized",
      evaluatedContextHash: contextHash,
      timestamp: "2026-09-25T12:00:00.000Z",
      decisionEngineVersion: "nexora-policy/2",
      enforcementPoint: "PRE_EXECUTION",
      attributes: {},
    };
    const eventHash = await computeGovernanceEventHash(hashInput);

    const append = await db.query(
      `SELECT nexora_append_governance_event(
        $1,$2,$3,$4,NULL,$5,$6,NULL,$7,NULL,'console',NULL,NULL,NULL,
        'PRE_EXECUTION','ALLOW','authorized',$8,$9,'nexora-policy/2','{}'::jsonb,NULL,$10
      ) AS position`,
      [
        org,
        event,
        traceId,
        spanId,
        execution,
        intent,
        user,
        contextHash,
        hashInput.timestamp,
        eventHash,
      ],
    );
    assert.equal(Number(append.rows[0].position), 1);

    await assert.rejects(
      db.query("UPDATE governance_audit_events SET reason='rewritten' WHERE event_id=$1", [event]),
    );
    await assert.rejects(
      db.query("DELETE FROM governance_audit_events WHERE event_id=$1", [event]),
    );

    const lineage = "00000000-0000-4000-8000-000000000107";
    await db.query(
      "INSERT INTO intent_lineage_events(id,org_id,parent_intent_id,child_intent_id,event_type,confidence,reason) VALUES($1,$2,$3,$4,'LINKED',0.99,'same objective')",
      [lineage, org, intent, child],
    );
    await assert.rejects(
      db.query("UPDATE intent_lineage_events SET confidence=0.1 WHERE id=$1", [lineage]),
    );

    const privileges = await db.query(`SELECT
      has_table_privilege('authenticated','governance_audit_events','INSERT') AS browser_event_write,
      has_table_privilege('authenticated','intents','INSERT') AS browser_intent_write,
      has_table_privilege('authenticated','governed_executions','INSERT') AS browser_execution_write,
      has_function_privilege(
        'authenticated',
        'nexora_append_governance_event(uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid,integer,text,text,text,text,text,timestamptz,text,jsonb,text,text)',
        'EXECUTE'
      ) AS browser_append_rpc`);
    assert.deepEqual(privileges.rows[0], {
      browser_event_write: false,
      browser_intent_write: false,
      browser_execution_write: false,
      browser_append_rpc: false,
    });
  } finally {
    await db.close();
  }
});
