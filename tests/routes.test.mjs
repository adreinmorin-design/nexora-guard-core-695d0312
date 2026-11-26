// Route and authentication boundary tests.
//
// - requireSupabaseAuth runs inside the real TanStack Start request context
//   (requestHandler / getRequest); only @supabase/supabase-js createClient is
//   replaced so getClaims can be controlled. The middleware signals denial by
//   throwing "Unauthorized: ..."; these tests assert that verdict and that the
//   protected handler (next) never runs. They do not assert an HTTP status:
//   TanStack Start serializes thrown server-function errors itself.
// - The /api/agent route handler runs as-is; only the Supabase admin client is
//   replaced with an in-memory fake and global fetch with a counting spy, so any
//   pipeline persistence or provider egress would be observed.
import test from "node:test";
import assert from "node:assert/strict";
import { installModuleStubs } from "./module-stubs.mjs";

await installModuleStubs({ authCreateClient: true });
// Bun shares one process across test files; do not leak the fakes.
test.after(() => {
  delete globalThis.__nexoraTestCreateClient;
  delete globalThis.__nexoraTestSupabaseAdmin;
});

const { requestHandler } = await import("@tanstack/react-start/server");
const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware.ts");
const { Route: AgentRoute } = await import("../src/routes/api.agent.ts");
const { hashCredential } = await import("../src/lib/nexora/agent-credentials.ts");

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";

async function runAuth(headers, getClaims) {
  const saved = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
  };
  process.env.SUPABASE_URL = "https://project.example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  const seen = { createClient: 0, getClaims: [], next: [] };
  globalThis.__nexoraTestCreateClient = () => {
    seen.createClient++;
    return {
      auth: {
        getClaims: async (token) => {
          seen.getClaims.push(token);
          return getClaims(token);
        },
      },
    };
  };
  // Run inside the real Start request context so getRequest() resolves the
  // request exactly as it does for a server-function call.
  let outcome;
  const handler = requestHandler(async () => {
    try {
      outcome = {
        result: await requireSupabaseAuth.options.server({
          context: {},
          next: async (options) => {
            seen.next.push(options);
            return { ok: true };
          },
        }),
      };
    } catch (error) {
      outcome = { error };
    }
    return new Response(null, { status: 204 });
  });
  try {
    await handler(new Request("https://app.example/_serverFn/x", { headers }));
    return { ...outcome, seen };
  } finally {
    for (const [env, value] of [
      ["SUPABASE_URL", saved.url],
      ["SUPABASE_PUBLISHABLE_KEY", saved.key],
    ])
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
  }
}

const validClaims = async () => ({ data: { claims: { sub: "user-1" } }, error: null });

test("auth middleware: missing bearer is rejected before any token verification", async () => {
  const { error, seen } = await runAuth({}, validClaims);
  assert.match(error?.message, /^Unauthorized: No authorization header provided/);
  assert.equal(seen.createClient, 0);
  assert.equal(seen.next.length, 0, "handler must not run");
});

for (const [label, header, message] of [
  ["non-Bearer scheme", "Basic dXNlcjpwYXNz", /Only Bearer tokens are supported/],
  // Fetch Headers trim the trailing space, leaving a bare "Bearer".
  ["empty bearer token", "Bearer ", /Only Bearer tokens are supported|No token provided/],
  ["non-JWT bearer token", "Bearer not-a-jwt", /Invalid token/],
  ["four-part bearer token", "Bearer a.b.c.d", /Invalid token/],
]) {
  test(`auth middleware: malformed bearer (${label}) is rejected`, async () => {
    const { error, seen } = await runAuth({ authorization: header }, validClaims);
    assert.match(error?.message, /^Unauthorized: /);
    assert.match(error.message, message);
    assert.equal(seen.getClaims.length, 0, "malformed tokens never reach getClaims");
    assert.equal(seen.next.length, 0);
  });
}

for (const [label, getClaims] of [
  ["returns an error", async () => ({ data: null, error: new Error("invalid JWT") })],
  ["returns no claims", async () => ({ data: { claims: null }, error: null })],
  ["returns claims without sub", async () => ({ data: { claims: { role: "x" } }, error: null })],
]) {
  test(`auth middleware: getClaims failure (${label}) is rejected`, async () => {
    const { error, seen } = await runAuth({ authorization: `Bearer ${JWT}` }, getClaims);
    assert.match(error?.message, /^Unauthorized: /);
    assert.deepEqual(seen.getClaims, [JWT]);
    assert.equal(seen.next.length, 0, "handler must not run");
  });
}

test("auth middleware: verified claims pass the user identity to the handler", async () => {
  const { error, result, seen } = await runAuth({ authorization: `Bearer ${JWT}` }, validClaims);
  assert.equal(error, undefined);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(seen.getClaims, [JWT]);
  assert.equal(seen.next.length, 1);
  assert.equal(seen.next[0].context.userId, "user-1");
});

// ---------------------------------------------------------------------------
// /api/agent route
// ---------------------------------------------------------------------------

const ORG = "00000000-0000-4000-8000-0000000000f1";
const OWNER = "00000000-0000-4000-8000-0000000000f2";
const AGENT = "00000000-0000-4000-8000-0000000000f3";
const REAL_TOKEN = "nxr_" + "a".repeat(64);
const FORGED_TOKEN = "nxr_" + "b".repeat(64);

function fakeDb(tables) {
  const rpcCalls = [];
  const writes = [];
  return {
    tables,
    rpcCalls,
    writes,
    from(name) {
      const state = { op: "select", filters: [], mode: "many", payload: null };
      const rows = () => (tables[name] ?? []).filter((r) => state.filters.every((f) => f(r)));
      const finish = (data) => {
        if (state.mode === "single")
          return data.length === 1
            ? { data: data[0], error: null }
            : { data: null, error: { message: "single row expected" } };
        if (state.mode === "maybe")
          return data.length > 1
            ? { data: null, error: { message: "multiple rows" } }
            : { data: data[0] ?? null, error: null };
        return { data, error: null };
      };
      const run = () => {
        if (state.op !== "select") {
          writes.push({ table: name, op: state.op, payload: state.payload });
          if (state.op === "insert") {
            const inserted = [state.payload].flat().map((r) => ({ id: crypto.randomUUID(), ...r }));
            (tables[name] ??= []).push(...inserted);
            return finish(inserted);
          }
          const matched = rows();
          for (const r of matched) Object.assign(r, state.payload);
          return finish(matched);
        }
        return finish(rows());
      };
      const builder = {
        select: () => builder,
        insert: (p) => ((state.op = "insert"), (state.payload = p), builder),
        update: (p) => ((state.op = "update"), (state.payload = p), builder),
        upsert: (p) => ((state.op = "upsert"), (state.payload = p), builder),
        eq: (c, v) => (state.filters.push((r) => r[c] === v), builder),
        in: (c, vs) => (state.filters.push((r) => vs.includes(r[c])), builder),
        order: () => builder,
        limit: () => builder,
        single: () => ((state.mode = "single"), builder),
        maybeSingle: () => ((state.mode = "maybe"), builder),
        then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      };
      return builder;
    },
    async rpc(fn, args) {
      rpcCalls.push({ fn, args });
      if (fn === "nexora_claim_agent") {
        const agent = (tables.agents ?? []).find(
          (a) => a.id === args.p_agent && a.token_hash === args.p_hash && a.status === "active",
        );
        return agent
          ? { data: { id: agent.id, org_id: agent.org_id, owner_id: agent.owner_id }, error: null }
          : { data: null, error: { message: "agent unavailable" } };
      }
      if (fn === "nexora_agent_usage") return { data: [], error: null };
      return { data: null, error: { message: "unexpected rpc " + fn } };
    },
  };
}

async function withAgentEnv(fn) {
  const db = fakeDb({
    agents: [
      {
        id: AGENT,
        org_id: ORG,
        owner_id: OWNER,
        name: "agent",
        status: "active",
        credential_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        token_hash: await hashCredential(REAL_TOKEN),
      },
    ],
    org_members: [{ id: "m1", org_id: ORG, user_id: OWNER, role: "org_admin" }],
    org_ai_controls: [],
    billing_subscriptions: [{ org_id: ORG, plan_key: "enterprise", status: "active" }],
    agent_capabilities: [{ id: "c1", org_id: ORG, agent_id: AGENT, capability: "model:invoke" }],
    models: [],
    providers: [],
    policies: [],
  });
  globalThis.__nexoraTestSupabaseAdmin = db;
  const fetchCalls = [];
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return new Response(JSON.stringify({ output_text: "should not happen" }));
  };
  try {
    await fn({ db, fetchCalls });
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  }
}

const POST = AgentRoute.options.server.handlers.POST;
const modelTask = () => ({
  kind: "model",
  modelKey: "openai/test",
  prompt: "Hello",
  idempotencyKey: crypto.randomUUID(),
});
async function postAgent(authorization, body = modelTask()) {
  const headers = { "content-type": "application/json" };
  if (authorization !== undefined) headers.authorization = authorization;
  const request = new Request("https://app.example/api/agent", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const res = await POST({ request });
  return { res, body: await res.json() };
}

function assertPipelineNotReached(db, fetchCalls) {
  assert.equal(fetchCalls.length, 0, "provider fetch must not be invoked");
  assert.equal(db.writes.length, 0, "no request, intent, execution or audit rows written");
  for (const table of ["requests", "intents", "governed_executions", "audit_events"])
    assert.equal(db.tables[table], undefined, table);
  assert.equal(
    db.rpcCalls.some((c) => ["nexora_reserve", "nexora_append_governance_event"].includes(c.fn)),
    false,
  );
}

for (const [label, authorization] of [
  ["missing", undefined],
  ["non-agent bearer", `Bearer ${JWT}`],
  ["malformed nxr_ token", "Bearer nxr_short"],
  ["lowercase scheme", `bearer ${REAL_TOKEN}`],
]) {
  test(`api.agent: ${label} credential returns 401 before pipeline and provider`, async () => {
    await withAgentEnv(async ({ db, fetchCalls }) => {
      const { res, body } = await postAgent(authorization);
      assert.equal(res.status, 401);
      assert.equal(body.error, "Valid agent bearer credential required.");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assertPipelineNotReached(db, fetchCalls);
      assert.equal(db.rpcCalls.length, 0);
    });
  });
}

test("api.agent: forged well-formed nxr_ credential returns 403 before pipeline and provider", async () => {
  await withAgentEnv(async ({ db, fetchCalls }) => {
    const { res, body } = await postAgent(`Bearer ${FORGED_TOKEN}`);
    assert.equal(res.status, 403);
    assert.match(body.error, /^Agent admission denied/);
    assertPipelineNotReached(db, fetchCalls);
    assert.equal(
      db.rpcCalls.some((c) => c.fn === "nexora_claim_agent"),
      false,
      "unknown credential hash is never claimed",
    );
  });
});

test("api.agent: genuine credential is admitted (harness control for the 403 above)", async () => {
  await withAgentEnv(async ({ db, fetchCalls }) => {
    const { res, body } = await postAgent(`Bearer ${REAL_TOKEN}`, {
      kind: "read",
      resource: "status",
      idempotencyKey: crypto.randomUUID(),
    });
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(JSON.parse(body.output).agentId, AGENT);
    assert.equal(db.rpcCalls[0].fn, "nexora_claim_agent");
    assert.equal(fetchCalls.length, 0);
  });
});
