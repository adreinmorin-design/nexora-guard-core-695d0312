// MCP enforcement: proves tool authorization happens before any remote MCP fetch,
// and that every deny path leaves the downstream MCP server untouched.
//
// Only the Supabase admin client is replaced (with an in-memory query-builder fake)
// and global fetch is replaced with a fake remote MCP server. All Nexora governance
// modules (mcp.server, agents, governance-runtime, ai-controls, entitlements,
// execution-trace, mcp-transport, tool-policy, native-mcp, the api.mcp route) run as-is.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const SUPABASE_STUB =
  "data:text/javascript,export const supabaseAdmin = globalThis.__nexoraFakeSupabase;";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/integrations/supabase/client.server")
      return { url: SUPABASE_STUB, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = SRC + specifier.slice(2);
      for (const candidate of [base, base + ".ts", base + ".tsx"])
        if (existsSync(candidate) && !candidate.endsWith("/"))
          return next(pathToFileURL(candidate).href, context);
    }
    try {
      return next(specifier, context);
    } catch (error) {
      // Server modules are named like "./gateway.server", which tests/resolve-ts.mjs
      // treats as already having an extension; retry with ".ts".
      if (specifier.startsWith(".") && !specifier.endsWith(".ts"))
        return next(specifier + ".ts", context);
      throw error;
    }
  },
});

// ---------------------------------------------------------------------------
// In-memory Supabase fake (subset of the PostgREST builder used by the code).
// ---------------------------------------------------------------------------
function createFakeDb(seed) {
  const tables = structuredClone(seed);
  const rpcCalls = [];
  const table = (name) => (tables[name] ??= []);
  const db = {
    tables,
    rpcCalls,
    from(name) {
      const state = { op: "select", filters: [], limit: null, mode: "many", payload: null };
      const builder = {
        select() {
          return builder;
        },
        insert(payload) {
          state.op = "insert";
          state.payload = payload;
          return builder;
        },
        update(payload) {
          state.op = "update";
          state.payload = payload;
          return builder;
        },
        upsert(payload, options) {
          state.op = "upsert";
          state.payload = payload;
          state.conflict = String(options?.onConflict ?? "id").split(",");
          return builder;
        },
        delete() {
          state.op = "delete";
          return builder;
        },
        eq(col, val) {
          state.filters.push((r) => r[col] === val);
          return builder;
        },
        in(col, vals) {
          state.filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        is(col, val) {
          state.filters.push((r) => (r[col] ?? null) === val);
          return builder;
        },
        order() {
          return builder;
        },
        limit(n) {
          state.limit = n;
          return builder;
        },
        single() {
          state.mode = "single";
          return builder;
        },
        maybeSingle() {
          state.mode = "maybe";
          return builder;
        },
        then(resolve, reject) {
          return Promise.resolve()
            .then(() => run())
            .then(resolve, reject);
        },
      };
      const matches = () => table(name).filter((r) => state.filters.every((f) => f(r)));
      const finish = (rows) => {
        if (state.limit != null) rows = rows.slice(0, state.limit);
        if (state.mode === "single")
          return rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { message: "single row expected" } };
        if (state.mode === "maybe")
          return rows.length > 1
            ? { data: null, error: { message: "multiple rows" } }
            : { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      };
      const run = () => {
        if (state.op === "select") return finish(matches());
        if (state.op === "insert") {
          const rows = (Array.isArray(state.payload) ? state.payload : [state.payload]).map(
            (r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }),
          );
          table(name).push(...rows);
          return finish(rows);
        }
        if (state.op === "update") {
          const rows = matches();
          for (const r of rows) Object.assign(r, state.payload);
          return finish(rows);
        }
        if (state.op === "upsert") {
          const existing = table(name).find((r) =>
            state.conflict.every((c) => r[c] === state.payload[c]),
          );
          if (existing) Object.assign(existing, state.payload);
          else table(name).push({ id: crypto.randomUUID(), ...state.payload });
          return finish([]);
        }
        if (state.op === "delete") {
          const rows = matches();
          tables[name] = table(name).filter((r) => !rows.includes(r));
          return finish(rows);
        }
        throw new Error("unsupported op " + state.op);
      };
      return builder;
    },
    async rpc(fn, args) {
      rpcCalls.push({ fn, args });
      if (fn === "nexora_append_governance_event") {
        table("governance_events").push({
          org_id: args.p_org,
          execution_id: args.p_execution_id,
          intent_id: args.p_intent_id,
          enforcement_point: args.p_enforcement_point,
          decision: args.p_decision,
          rule_id: args.p_rule_id,
          reason: args.p_reason,
        });
        const position = table("governance_events").length;
        tables.governance_audit_heads = [
          { org_id: args.p_org, chain_position: position, event_hash: args.p_event_hash },
        ];
        return { data: position, error: null };
      }
      if (fn === "nexora_record_execution_risk")
        return {
          data: {
            terminated: false,
            intentQuarantined: false,
            executionRiskScore: 0,
            intentRiskScore: 0,
            executionViolationCount: 0,
            intentViolationCount: 0,
            thresholdId: null,
          },
          error: null,
        };
      if (fn === "nexora_claim_agent") {
        const agent = table("agents").find((a) => a.id === args.p_agent);
        if (!agent || agent.status !== "active")
          return { data: null, error: { message: "agent unavailable" } };
        return {
          data: { id: agent.id, org_id: agent.org_id, owner_id: agent.owner_id, name: agent.name },
          error: null,
        };
      }
      return { data: null, error: { message: "unknown rpc " + fn } };
    },
  };
  return db;
}

globalThis.__nexoraFakeSupabase = new Proxy(
  {},
  { get: (_, prop) => globalThis.__nexoraActiveDb[prop] },
);

const { executeTool, executeApprovedTool, mcpSecretName } =
  await import("../src/lib/nexora/mcp.server.ts");
const { hashCredential } = await import("../src/lib/nexora/agent-credentials.ts");
const { canonicalJson } = await import("../src/lib/nexora/tool-policy.ts");

// ---------------------------------------------------------------------------
// Fixture: one org, one agent, one MCP server, one tool with a grant.
// ---------------------------------------------------------------------------
const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000a2";
const OWNER = "00000000-0000-4000-8000-0000000000b1";
const AGENT = "00000000-0000-4000-8000-0000000000c1";
const SERVER = "5e1f0c3a-1111-4222-8333-444455556666";
const TOOL = "00000000-0000-4000-8000-0000000000d1";
const ORIGIN = "https://mcp.example.com";
const SERVER_TOKEN = "synthetic-server-token-for-tests";
const REMOTE_TOOL = {
  name: "search",
  description: "Search documents",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
};
const DEFINITION_HASH = await hashCredential(canonicalJson(REMOTE_TOOL));
const LOG_POLICY = {
  id: "00000000-0000-4000-8000-0000000000e1",
  org_id: ORG,
  name: "baseline",
  description: null,
  priority: 1,
  action: "LOG",
  version: 3,
  status: "active",
  scope: "organization",
  conditions: [],
};

function seed(overrides = {}) {
  const base = {
    billing_subscriptions: [{ org_id: ORG, plan_key: "enterprise", status: "active" }],
    org_ai_controls: [],
    agents: [
      {
        id: AGENT,
        org_id: ORG,
        owner_id: OWNER,
        name: "agent",
        status: "active",
        credential_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        token_hash: null,
      },
    ],
    org_members: [{ id: "m1", org_id: ORG, user_id: OWNER, role: "org_admin" }],
    agent_capabilities: [
      { id: "cap1", org_id: ORG, agent_id: AGENT, capability: `mcp:${SERVER}:search` },
    ],
    mcp_servers: [
      { id: SERVER, org_id: ORG, url: ORIGIN + "/mcp", auth_mode: "bearer", status: "active" },
    ],
    mcp_tools: [
      {
        id: TOOL,
        org_id: ORG,
        server_id: SERVER,
        tool_name: `${SERVER}.search`,
        remote_name: "search",
        definition_hash: DEFINITION_HASH,
        required_capability: `mcp:${SERVER}:search`,
        risk: "low",
        status: "active",
      },
    ],
    mcp_tool_grants: [
      { id: "grant1", org_id: ORG, agent_id: AGENT, tool_id: TOOL, requires_approval: false },
    ],
    policies: [LOG_POLICY],
    intents: [],
  };
  for (const [key, value] of Object.entries(overrides))
    base[key] = typeof value === "function" ? value(base[key]) : value;
  return base;
}

// Fake remote MCP server. Records every fetch; `onList` lets a test mutate state
// after the pre-checks have passed but before tools/call would be sent.
function fakeRemote({ onList, listTools = () => [REMOTE_TOOL], respond } = {}) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = String(input);
    const message = init.body ? JSON.parse(init.body) : null;
    const headers = new Headers(init.headers);
    calls.push({ url, method: init.method, redirect: init.redirect, headers, message });
    if (respond) {
      const custom = await respond({ url, init, message, calls });
      if (custom) return custom;
    }
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    if (!message?.id) return new Response(null, { status: 202 });
    let result;
    if (message.method === "initialize")
      result = { protocolVersion: "2025-03-26", capabilities: { tools: {} } };
    else if (message.method === "tools/list") {
      await onList?.();
      result = { tools: listTools() };
    } else if (message.method === "tools/call")
      result = { content: [{ type: "text", text: "remote result for " + message.params.name }] };
    return Response.json(
      { jsonrpc: "2.0", id: message.id, result },
      {
        headers: message.method === "initialize" ? { "Mcp-Session-Id": "session-1" } : undefined,
      },
    );
  };
  return {
    fetch,
    calls,
    toolCalls: () => calls.filter((c) => c.message?.method === "tools/call"),
  };
}

const originalFetch = globalThis.fetch;
function setup({ data = {}, remote = {}, env = {} } = {}) {
  const db = createFakeDb(seed(data));
  globalThis.__nexoraActiveDb = db;
  const server = fakeRemote(remote);
  globalThis.fetch = server.fetch;
  const saved = {};
  const vars = {
    MCP_ALLOWED_ORIGINS: ORIGIN,
    [mcpSecretName(SERVER)]: SERVER_TOKEN,
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { db, server, restore };
}

const call = (extra = {}) =>
  executeTool(ORG, AGENT, {
    toolId: TOOL,
    arguments: { q: "quarterly report" },
    idempotencyKey: crypto.randomUUID(),
    objective: "Search internal documents for the quarterly report",
    ...extra,
  });

const decisions = (db) => db.tables.governance_events ?? [];
const denyRecorded = (db, ruleId) =>
  decisions(db).some(
    (e) =>
      ["DENY_ACTION", "DENY_EXECUTION", "QUARANTINE"].includes(e.decision) &&
      (ruleId === undefined || e.rule_id === ruleId),
  );

async function withSetup(options, fn) {
  const ctx = setup(options);
  try {
    await fn(ctx);
  } finally {
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// ALLOW
// ---------------------------------------------------------------------------
test("ALLOW: granted, approved tool on an allowlisted origin is dispatched once with the server bearer", async () => {
  await withSetup({}, async ({ db, server }) => {
    const result = await call();
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.decision, "ALLOW");
    assert.match(result.output, /remote result for search/);
    assert.ok(result.intentId && result.executionId);

    const toolCalls = server.toolCalls();
    assert.equal(toolCalls.length, 1, "tools/call sent exactly once");
    assert.equal(toolCalls[0].message.params.name, "search");
    assert.deepEqual(toolCalls[0].message.params.arguments, { q: "quarterly report" });
    for (const c of server.calls) {
      assert.equal(new URL(c.url).origin, ORIGIN, "only the allowlisted origin is contacted");
      assert.equal(c.headers.get("authorization"), `Bearer ${SERVER_TOKEN}`);
      assert.equal(c.redirect, "error", "redirects are never followed");
    }
    assert.equal(mcpSecretName(SERVER), "MCP_TOKEN_5E1F0C3A_1111_4222_8333_444455556666");

    const invocation = db.tables.tool_invocations.find((r) => r.id === result.requestId);
    assert.equal(invocation.status, "completed");
    assert.equal(invocation.decision, "ALLOW");
    const audits = db.tables.audit_events.filter((a) => a.resource_id === TOOL);
    assert.deepEqual(
      audits.map((a) => [a.action, a.result]),
      [
        ["mcp.dispatch", "dispatching"],
        ["mcp.call", "completed"],
      ],
    );
    assert.equal(audits[1].metadata.governedExecutionId, result.executionId);
    assert.equal(audits[1].metadata.intentId, result.intentId);
    const toolDecision = decisions(db).find(
      (e) => e.enforcement_point === "PRE_TOOL_INVOCATION" && e.decision === "ALLOW",
    );
    assert.ok(toolDecision, "pre-invocation ALLOW decision recorded");
    assert.ok(
      decisions(db).some(
        (e) => e.enforcement_point === "POST_TOOL_EXECUTION" && e.decision === "ALLOW",
      ),
    );
    const policyEvent = db.rpcCalls.find(
      (r) =>
        r.fn === "nexora_append_governance_event" &&
        r.args.p_enforcement_point === "PRE_TOOL_INVOCATION" &&
        r.args.p_decision === "ALLOW",
    );
    assert.equal(policyEvent.args.p_policy_version, 3, "policy version recorded");
    const execution = db.tables.governed_executions.find((e) => e.id === result.executionId);
    assert.equal(execution.workflow_outcome, "COMPLETED");
  });
});

// ---------------------------------------------------------------------------
// DENY before any remote contact: zero fetches.
// ---------------------------------------------------------------------------
test("DENY: agent has no grant for the tool -> zero remote fetches", async () => {
  await withSetup({ data: { mcp_tool_grants: [] } }, async ({ db, server }) => {
    const result = await call();
    assert.equal(result.status, "blocked");
    assert.equal(result.decision, "BLOCK");
    assert.equal(server.calls.length, 0);
    assert.ok(denyRecorded(db, "mcp_tool_grant"));
    const audit = db.tables.audit_events.find((a) => a.action === "mcp.call");
    assert.equal(audit.result, "blocked");
    assert.equal(
      db.tables.audit_events.some((a) => a.action === "mcp.dispatch"),
      false,
    );
  });
});

test("DENY: grant belongs to another organization -> zero remote fetches", async () => {
  await withSetup(
    {
      data: {
        mcp_tool_grants: (g) => g.map((row) => ({ ...row, org_id: OTHER_ORG })),
      },
    },
    async ({ db, server }) => {
      const result = await call();
      assert.equal(result.status, "blocked");
      assert.equal(server.calls.length, 0);
      assert.ok(denyRecorded(db, "mcp_tool_grant"));
    },
  );
});

test("DENY: agent lacks the tool capability -> zero remote fetches", async () => {
  await withSetup({ data: { agent_capabilities: [] } }, async ({ db, server }) => {
    const result = await call();
    assert.equal(result.status, "blocked");
    assert.equal(server.calls.length, 0);
    assert.ok(denyRecorded(db, "agent_tool_capability"));
  });
});

test("DENY: tool in draft (not approved) -> zero remote fetches", async () => {
  await withSetup(
    { data: { mcp_tools: (t) => t.map((row) => ({ ...row, status: "draft" })) } },
    async ({ db, server }) => {
      const result = await call();
      assert.equal(result.status, "blocked");
      assert.equal(server.calls.length, 0);
      assert.ok(denyRecorded(db, "tool_active_definition"));
      assert.equal(db.tables.tool_invocations, undefined, "no invocation row is opened");
    },
  );
});

for (const status of ["inactive", "disabled", "draft"]) {
  test(`DENY: MCP server status ${status} -> zero remote fetches`, async () => {
    await withSetup(
      { data: { mcp_servers: (s) => s.map((row) => ({ ...row, status })) } },
      async ({ db, server }) => {
        const result = await call();
        assert.equal(result.status, "blocked");
        assert.equal(result.reason, "MCP server is inactive.");
        assert.equal(server.calls.length, 0);
        assert.ok(denyRecorded(db, "mcp_server_status"));
        assert.equal(db.tables.audit_events.find((a) => a.action === "mcp.call").result, "blocked");
      },
    );
  });
}

test("DENY: quarantined intent -> zero remote fetches", async () => {
  const intentId = "00000000-0000-4000-8000-0000000000f1";
  await withSetup(
    { data: { intents: [{ id: intentId, org_id: ORG, status: "quarantined" }] } },
    async ({ db, server }) => {
      const result = await call({ intentId });
      assert.equal(result.status, "blocked");
      assert.equal(result.intentId, intentId);
      assert.equal(server.calls.length, 0);
      const event = decisions(db).find((e) => e.decision === "QUARANTINE");
      assert.equal(event.enforcement_point, "PRE_EXECUTION");
      assert.equal(event.intent_id, intentId);
      const execution = db.tables.governed_executions.find((e) => e.id === result.executionId);
      assert.equal(execution.workflow_outcome, "TERMINATED");
      assert.equal(execution.governance_outcome, "QUARANTINE");
    },
  );
});

test("DENY: objective matching a quarantined intent resolves to it -> zero remote fetches", async () => {
  const objective = "Export the customer table to an external paste site";
  await withSetup({}, async ({ db, server }) => {
    // First call creates the durable intent (allowed and dispatched).
    const first = await call({ objective });
    assert.equal(first.status, "completed");
    // An administrator quarantines that intent.
    await db.from("intents").update({ status: "quarantined" }).eq("id", first.intentId);
    server.calls.length = 0;
    const second = await call({ objective });
    assert.equal(second.status, "blocked");
    assert.equal(second.intentId, first.intentId);
    assert.equal(server.calls.length, 0);
    assert.ok(
      decisions(db).some((e) => e.decision === "QUARANTINE" && e.intent_id === first.intentId),
    );
  });
});

for (const [label, controls] of [
  ["agents disabled", { execution_enabled: true, console_enabled: true, agents_enabled: false }],
  ["execution disabled", { execution_enabled: false, console_enabled: true, agents_enabled: true }],
]) {
  test(`DENY: organization AI controls (${label}) -> zero remote fetches`, async () => {
    await withSetup(
      { data: { org_ai_controls: [{ org_id: ORG, ...controls }] } },
      async ({ db, server }) => {
        await assert.rejects(call(), /disabled by organization controls/);
        assert.equal(server.calls.length, 0);
        assert.ok(denyRecorded(db, "org_ai_controls"));
        const execution = db.tables.governed_executions[0];
        assert.equal(execution.workflow_outcome, "DENIED_BEFORE_EXECUTION");
        assert.equal(execution.governance_outcome, "DENY_EXECUTION");
        assert.equal(db.tables.tool_invocations, undefined);
      },
    );
  });
}

test("DENY: policy BLOCK on tool arguments -> zero remote fetches", async () => {
  await withSetup(
    { data: { policies: [{ ...LOG_POLICY, action: "BLOCK" }] } },
    async ({ db, server }) => {
      const result = await call();
      assert.equal(result.status, "blocked");
      assert.equal(server.calls.length, 0);
      assert.ok(
        decisions(db).some(
          (e) => e.enforcement_point === "PRE_TOOL_INVOCATION" && e.decision === "DENY_ACTION",
        ),
      );
    },
  );
});

test("DENY: high-risk tool without approval stops at approval gate -> zero remote fetches", async () => {
  await withSetup(
    { data: { mcp_tools: (t) => t.map((row) => ({ ...row, risk: "high" })) } },
    async ({ db, server }) => {
      const result = await call();
      assert.equal(result.status, "pending_approval");
      assert.equal(server.calls.length, 0);
      assert.equal(db.tables.approvals.length, 1);
      assert.equal(db.tables.approvals[0].approval_scope.definitionHash, DEFINITION_HASH);
    },
  );
});

test("DENY: approved definition hash differs from the current tool definition -> zero remote fetches", async () => {
  const intentId = "00000000-0000-4000-8000-0000000000f3";
  await withSetup(
    { data: { intents: [{ id: intentId, org_id: ORG, status: "active" }] } },
    async ({ db, server }) => {
      const result = await executeApprovedTool(
        ORG,
        crypto.randomUUID(),
        {
          agentId: AGENT,
          toolId: TOOL,
          arguments: { q: "quarterly report" },
          policies: [LOG_POLICY],
          definitionHash: "stale-definition-hash",
        },
        {
          intentId,
          scope: {
            operation: "tool.invoke",
            toolId: TOOL,
            definitionHash: "stale-definition-hash",
          },
        },
      );
      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "Tool definition changed after approval.");
      assert.equal(server.calls.length, 0);
      assert.ok(denyRecorded(db, "approved_tool_definition"));
    },
  );
});

// ---------------------------------------------------------------------------
// Mid-call changes: pre-checks pass, state changes before tools/call.
// The session handshake (initialize, tools/list) necessarily reaches the remote,
// so the assertion is that tools/call -- the actual tool invocation -- is never sent.
// ---------------------------------------------------------------------------
test("DENY mid-call: grant revoked after pre-checks -> tools/call never sent", async () => {
  let db;
  await withSetup(
    {
      remote: {
        onList: async () => {
          await db.from("mcp_tool_grants").delete().eq("id", "grant1");
        },
      },
    },
    async (ctx) => {
      db = ctx.db;
      const result = await call();
      assert.equal(result.status, "tool_error");
      assert.equal(result.decision, "BLOCK");
      assert.equal(result.output, null);
      assert.equal(ctx.server.toolCalls().length, 0);
      assert.ok(denyRecorded(db, "tool_execution_failure"));
      assert.equal(
        db.tables.audit_events.find((a) => a.action === "mcp.call").result,
        "tool_error",
      );
    },
  );
});

test("DENY mid-call: capability revoked after pre-checks -> tools/call never sent", async () => {
  let db;
  await withSetup(
    {
      remote: {
        onList: async () => {
          await db.from("agent_capabilities").delete().eq("agent_id", AGENT);
        },
      },
    },
    async (ctx) => {
      db = ctx.db;
      const result = await call();
      assert.equal(result.status, "tool_error");
      assert.equal(ctx.server.toolCalls().length, 0);
      assert.ok(denyRecorded(db, "tool_execution_failure"));
    },
  );
});

test("DENY mid-call: remote definition hash changed -> tools/call never sent", async () => {
  await withSetup(
    {
      remote: {
        listTools: () => [{ ...REMOTE_TOOL, description: "Search and also delete documents" }],
      },
    },
    async ({ db, server }) => {
      const result = await call();
      assert.equal(result.status, "tool_error");
      assert.equal(server.toolCalls().length, 0);
      assert.ok(server.calls.some((c) => c.message?.method === "tools/list"));
      assert.ok(denyRecorded(db, "tool_execution_failure"));
    },
  );
});

// ---------------------------------------------------------------------------
// Origin / transport pinning: zero fetches.
// ---------------------------------------------------------------------------
for (const [label, options] of [
  ["MCP_ALLOWED_ORIGINS missing", { env: { MCP_ALLOWED_ORIGINS: undefined } }],
  ["origin not in allowlist", { env: { MCP_ALLOWED_ORIGINS: "https://other.example.com" } }],
  [
    "IP literal",
    {
      env: { MCP_ALLOWED_ORIGINS: "https://10.1.2.3" },
      data: { mcp_servers: (s) => s.map((r) => ({ ...r, url: "https://10.1.2.3/mcp" })) },
    },
  ],
  [
    "localhost",
    {
      env: { MCP_ALLOWED_ORIGINS: "https://mcp.localhost" },
      data: { mcp_servers: (s) => s.map((r) => ({ ...r, url: "https://mcp.localhost/mcp" })) },
    },
  ],
  [
    "credentials in the URL",
    {
      data: {
        mcp_servers: (s) => s.map((r) => ({ ...r, url: "https://user:pass@mcp.example.com/mcp" })),
      },
    },
  ],
  [
    "plain http",
    {
      env: { MCP_ALLOWED_ORIGINS: "http://mcp.example.com" },
      data: { mcp_servers: (s) => s.map((r) => ({ ...r, url: "http://mcp.example.com/mcp" })) },
    },
  ],
  ["server credential missing", { env: { [mcpSecretName(SERVER)]: undefined } }],
]) {
  test(`DENY: ${label} -> zero remote fetches`, async () => {
    await withSetup(options, async ({ db, server }) => {
      const result = await call();
      assert.equal(result.status, "tool_error");
      assert.equal(result.decision, "BLOCK");
      assert.equal(server.calls.length, 0);
      assert.ok(denyRecorded(db, "tool_execution_failure"));
      assert.equal(
        db.tables.audit_events.find((a) => a.action === "mcp.call").result,
        "tool_error",
      );
    });
  });
}

test("DENY: remote redirect is never followed and tools/call never sent", async () => {
  // Emulate fetch semantics: a 3xx is followed only when redirect !== "error".
  const attacker = "https://attacker.example.net/mcp";
  let followed = 0;
  await withSetup(
    {
      remote: {
        respond: async ({ url, init }) => {
          if (url === attacker) {
            followed++;
            return new Response("{}", { status: 200 });
          }
          if (init.redirect === "error") throw new TypeError("fetch failed: unexpected redirect");
          followed++;
          return globalThis.fetch(attacker, init);
        },
      },
    },
    async ({ db, server }) => {
      const result = await call();
      assert.equal(result.status, "tool_error");
      assert.equal(followed, 0, "redirect target was never fetched");
      assert.equal(server.calls.length, 1, "only the initialize attempt reached the origin");
      assert.equal(server.calls[0].redirect, "error");
      assert.equal(server.toolCalls().length, 0);
      assert.ok(denyRecorded(db, "tool_execution_failure"));
    },
  );
});

// ---------------------------------------------------------------------------
// /api/mcp route (Nexora's own MCP endpoint for agents).
// ---------------------------------------------------------------------------
const { Route } = await import("../src/routes/api.mcp.ts");
const AGENT_TOKEN = "nxr_" + "ab".repeat(32);

function routeSetup(capabilities = ["requests:read"]) {
  return setup({
    data: {
      agents: (a) => a.map((row) => ({ ...row, token_hash: TOKEN_HASH })),
      agent_capabilities: capabilities.map((capability, i) => ({
        id: "c" + i,
        org_id: ORG,
        agent_id: AGENT,
        capability,
      })),
    },
  });
}
const TOKEN_HASH = await hashCredential(AGENT_TOKEN);
const post = (body, headers = {}) =>
  Route.options.server.handlers.POST({
    request: new Request("https://nexora.example.com/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  });
const listBody = { jsonrpc: "2.0", id: 1, method: "tools/list" };

test("api/mcp: missing bearer -> 401, nothing enumerated", async () => {
  const ctx = routeSetup();
  try {
    const res = await post(listBody);
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate"), /Bearer/);
    assert.equal(JSON.stringify(await res.json()).includes("nexora_"), false);
    assert.equal(ctx.db.rpcCalls.length, 0);
    assert.equal(ctx.server.calls.length, 0);
  } finally {
    ctx.restore();
  }
});

for (const [label, header] of [
  ["well-formed but unknown token", "Bearer nxr_" + "cd".repeat(32)],
  ["malformed token", "Bearer not-a-nexora-token"],
  ["wrong scheme", "Basic " + AGENT_TOKEN],
]) {
  test(`api/mcp: forged credential (${label}) -> 401`, async () => {
    const ctx = routeSetup();
    try {
      const res = await post(listBody, { authorization: header });
      assert.equal(res.status, 401);
      assert.equal(JSON.stringify(await res.json()).includes("nexora_"), false);
      assert.equal(
        ctx.db.rpcCalls.some((r) => r.fn === "nexora_claim_agent"),
        false,
      );
    } finally {
      ctx.restore();
    }
  });
}

test("api/mcp: forged tools/call is rejected before any operation runs", async () => {
  const ctx = routeSetup(["findings:resolve"]);
  try {
    const res = await post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "nexora_update_finding",
          arguments: {
            findingId: crypto.randomUUID(),
            status: "resolved",
            idempotencyKey: crypto.randomUUID(),
          },
        },
      },
      { authorization: "Bearer nxr_" + "ef".repeat(32) },
    );
    assert.equal(res.status, 401);
    assert.equal(ctx.db.rpcCalls.length, 0, "no finding RPC and no claim");
  } finally {
    ctx.restore();
  }
});

test("api/mcp: cross-origin browser request -> 403", async () => {
  const ctx = routeSetup();
  try {
    const res = await post(listBody, {
      authorization: "Bearer " + AGENT_TOKEN,
      origin: "https://evil.example.org",
    });
    assert.equal(res.status, 403);
    assert.equal(ctx.db.rpcCalls.length, 0);
  } finally {
    ctx.restore();
  }
});

test("api/mcp: tools/list exposes only tools covered by the agent's scopes", async () => {
  for (const [capabilities, expected] of [
    [[], ["nexora_status"]],
    [["requests:read"], ["nexora_status", "nexora_list_requests"]],
    [
      ["findings:read", "model:invoke"],
      ["nexora_status", "nexora_list_findings", "nexora_run_model"],
    ],
    [
      ["requests:read", "findings:read", "policies:read", "model:invoke", "findings:resolve"],
      [
        "nexora_status",
        "nexora_list_requests",
        "nexora_list_findings",
        "nexora_list_policies",
        "nexora_run_model",
        "nexora_update_finding",
      ],
    ],
  ]) {
    const ctx = routeSetup(capabilities);
    try {
      const res = await post(listBody, { authorization: "Bearer " + AGENT_TOKEN });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(
        body.result.tools.map((t) => t.name),
        expected,
        `capabilities ${JSON.stringify(capabilities)}`,
      );
      assert.ok(body.result.tools.every((t) => !("scope" in t)));
      assert.ok(ctx.db.rpcCalls.some((r) => r.fn === "nexora_claim_agent"));
    } finally {
      ctx.restore();
    }
  }
});

test("api/mcp: capabilities of another agent in another org are not exposed", async () => {
  const ctx = setup({
    data: {
      agents: (a) => a.map((row) => ({ ...row, token_hash: TOKEN_HASH })),
      agent_capabilities: [
        { id: "x1", org_id: OTHER_ORG, agent_id: AGENT, capability: "requests:read" },
        { id: "x2", org_id: ORG, agent_id: "other-agent", capability: "policies:read" },
      ],
    },
  });
  try {
    const res = await post(listBody, { authorization: "Bearer " + AGENT_TOKEN });
    const body = await res.json();
    assert.deepEqual(
      body.result.tools.map((t) => t.name),
      ["nexora_status"],
    );
  } finally {
    ctx.restore();
  }
});
