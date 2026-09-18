import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateAgent, runAgentOperation } from "./agents.server";
import { checked } from "./gateway.server";
import { agentTaskInput, readLimitedJson } from "./agent-input";

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const uuid = { type: "string", format: "uuid" };
const TOOLS = [
  {
    name: "nexora_status",
    scope: "",
    description: "Check the connection, granted permissions and registered models.",
    inputSchema: objectSchema({}),
  },
  ...["requests", "findings", "policies"].map((resource) => ({
    name: `nexora_list_${resource}`,
    scope: `${resource}:read`,
    description: `Read recent ${resource} in the connected organization.`,
    inputSchema: objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 } }),
  })),
  {
    name: "nexora_run_model",
    scope: "model:invoke",
    description:
      "Run a governed AI request. Policies, human approvals and budget ceilings apply. Provider charges may apply. Reuse the idempotency key only to prevent duplicate execution, never to retry a failed call.",
    inputSchema: objectSchema(
      {
        modelKey: { type: "string" },
        prompt: { type: "string", maxLength: 20000 },
        idempotencyKey: uuid,
      },
      ["modelKey", "prompt", "idempotencyKey"],
    ),
  },
  {
    name: "nexora_update_finding",
    scope: "findings:resolve",
    description:
      "Resolve or reopen a security finding. Requires explicit finding-update permission.",
    inputSchema: objectSchema(
      {
        findingId: uuid,
        status: { type: "string", enum: ["open", "resolved"] },
        idempotencyKey: uuid,
      },
      ["findingId", "status", "idempotencyKey"],
    ),
  },
];

export async function nativeMcp(request: Request) {
  const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
  let message: any;
  try {
    message = await readLimitedJson(request);
  } catch {
    return reply(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON request." } },
      400,
    );
  }
  if (
    !message ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    Array.isArray(message)
  )
    return reply(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } },
      400,
    );
  let task: any;
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    try {
      if (!TOOLS.some((t) => t.name === name)) throw new Error();
      const key = args.idempotencyKey ?? crypto.randomUUID();
      if (name === "nexora_status")
        task = { kind: "read", resource: "status", idempotencyKey: key };
      else if (name.startsWith("nexora_list_"))
        task = {
          kind: "read",
          resource: name.slice("nexora_list_".length),
          limit: args.limit ?? 50,
          idempotencyKey: key,
        };
      else if (name === "nexora_run_model") task = { ...args, kind: "model" };
      else task = { ...args, kind: "finding" };
      task = agentTaskInput.parse(task);
    } catch {
      return reply({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: { code: -32602, message: "Unknown tool or invalid arguments." },
      });
    }
  }
  let agent: any;
  try {
    agent = await authenticateAgent(
      request.headers.get("authorization"),
      task?.idempotencyKey ?? crypto.randomUUID(),
    );
  } catch {
    return reply({ error: "Agent authentication or admission denied." }, 401, {
      "WWW-Authenticate": 'Bearer realm="Nexora"',
    });
  }
  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  const result = (value: unknown) =>
    reply({ jsonrpc: "2.0", id: message.id ?? null, result: value });
  if (message.method === "initialize")
    return result({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "nexora", version: "1.0.0" },
    });
  if (message.method === "ping") return result({});
  try {
    if (message.method === "tools/list") {
      const grants = await checked(
        (supabaseAdmin as any)
          .from("agent_capabilities")
          .select("capability")
          .eq("org_id", agent.org_id)
          .eq("agent_id", agent.id),
      );
      return result({
        tools: TOOLS.filter(
          (t) => !t.scope || grants.some((g: any) => g.capability === t.scope),
        ).map(({ scope, ...tool }) => tool),
      });
    }
    if (message.method === "tools/call") {
      const outcome = await runAgentOperation(agent.org_id, agent.id, task);
      return result({
        content: [{ type: "text", text: JSON.stringify(outcome) }],
        isError: ["blocked", "provider_error", "tool_error"].includes(outcome.status),
      });
    }
  } catch {
    return result({
      isError: true,
      content: [
        {
          type: "text",
          text: "Action denied or unavailable. Check permissions and configuration in Nexora.",
        },
      ],
    });
  }
  return reply({
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: { code: -32601, message: "Method not found." },
  });
}
