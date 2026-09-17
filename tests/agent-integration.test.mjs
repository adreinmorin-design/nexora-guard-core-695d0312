import test from "node:test";
import assert from "node:assert/strict";
import { agentTaskInput } from "../src/lib/nexora/agent-input.ts";
import { validateMcpEndpoint, withMcp } from "../src/lib/nexora/mcp-transport.ts";
import { toolDecision } from "../src/lib/nexora/tool-policy.ts";
import { SEED_POLICIES } from "../src/lib/nexora/catalog.ts";

test("agent task input is bounded and rejects extra authority", () => {
  const valid = agentTaskInput.parse({
    kind: "read",
    resource: "requests",
    limit: 50,
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(valid.resource, "requests");
  assert.throws(() => agentTaskInput.parse({ ...valid, orgId: "attacker-org" }));
  assert.throws(() => agentTaskInput.parse({ ...valid, limit: 101 }));
});

test("tool arguments are governed and sensitive values are removed", () => {
  const policies = SEED_POLICIES.map((policy, index) => ({
    ...policy,
    id: String(index),
    version: 1,
    status: "active",
  }));
  const result = toolDecision(
    policies,
    { password: "synthetic-test-password", message: "test@example.com" },
    "mcp/tool",
    "request",
  );
  assert.equal(result.decision.action, "BLOCK");
  assert.deepEqual(result.sanitized, {
    password: "[REDACTED:CREDENTIAL]",
    message: "[REDACTED:EMAIL]",
  });
});

test("MCP transport pins origins, initializes a session, and lists tools", async () => {
  assert.throws(() => validateMcpEndpoint("https://127.0.0.1/mcp", ["https://127.0.0.1"]));
  assert.throws(() => validateMcpEndpoint("https://other.example/mcp", ["https://mcp.example"]));
  const seen = [];
  const fetcher = async (_url, init) => {
    seen.push(init);
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    const message = JSON.parse(init.body);
    if (!message.id) return new Response(null, { status: 202 });
    const result =
      message.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {} } }
        : { tools: [{ name: "search", inputSchema: { type: "object" } }] };
    return Response.json(
      { jsonrpc: "2.0", id: message.id, result },
      {
        headers: message.method === "initialize" ? { "Mcp-Session-Id": "session-1" } : undefined,
      },
    );
  };
  const result = await withMcp(
    {
      endpoint: "https://mcp.example/service",
      allowedOrigins: ["https://mcp.example"],
      token: "synthetic",
      fetcher,
    },
    (call) => call("tools/list"),
  );
  assert.equal(result.tools[0].name, "search");
  assert.equal(new Headers(seen[2].headers).get("Mcp-Session-Id"), "session-1");
  assert.equal(seen.at(-1).method, "DELETE");
});
