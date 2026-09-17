import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checked } from "./gateway.server";
import { activeAgent, requireCapability } from "./agents.server";
import { hashCredential } from "./agent-credentials";
import { canonicalJson, toolDecision } from "./tool-policy";
import { withMcp, validateMcpEndpoint } from "./mcp-transport";
import type { PolicyRecord } from "./policy-engine";

const db: any = supabaseAdmin;
const allowedOrigins = () =>
  (process.env["MCP_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export const mcpSecretName = (id: string) => "MCP_TOKEN_" + id.replaceAll("-", "_").toUpperCase();
export function mcpReadiness(server: any) {
  try {
    validateMcpEndpoint(server.url, allowedOrigins());
  } catch {
    return "ORIGIN_NOT_ALLOWED";
  }
  if (server.auth_mode !== "none" && !process.env[mcpSecretName(server.id)]?.trim())
    return "CREDENTIAL_REQUIRED";
  return "READY";
}
function connect<T>(server: any, work: Parameters<typeof withMcp<T>>[1]) {
  if (mcpReadiness(server) !== "READY")
    throw new Error("Configure this MCP server's trusted origin and server credential first.");
  const token = server.auth_mode === "none" ? undefined : process.env[mcpSecretName(server.id)];
  return withMcp(
    {
      endpoint: server.url,
      allowedOrigins: allowedOrigins(),
      ...(token ? { token } : {}),
    },
    work,
  );
}

async function listRemote(
  call: (method: string, params?: Record<string, unknown>) => Promise<any>,
) {
  const tools: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await call("tools/list", cursor ? { cursor } : {});
    if (!Array.isArray(result?.tools)) throw new Error("Invalid MCP tool list.");
    for (const tool of result.tools) {
      if (
        typeof tool.name !== "string" ||
        !/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name) ||
        tool.inputSchema?.type !== "object"
      )
        throw new Error("Unsupported MCP tool definition.");
      tools.push(tool);
    }
    if (tools.length > 100) throw new Error("MCP catalogue exceeds the 100 tool limit.");
    if (!result.nextCursor) return tools;
    if (typeof result.nextCursor !== "string" || result.nextCursor === cursor)
      throw new Error("Invalid MCP pagination.");
    cursor = result.nextCursor;
  }
  throw new Error("MCP catalogue requires too many pages.");
}

export async function discoverMcp(orgId: string, serverId: string, actor: string) {
  const server = await checked(
    db.from("mcp_servers").select("*").eq("org_id", orgId).eq("id", serverId).single(),
  );
  const definitions = await connect(server, listRemote);
  // Every refreshed definition must be explicitly enabled again by an administrator.
  await checked(
    db.from("mcp_tools").update({ status: "draft" }).eq("org_id", orgId).eq("server_id", serverId),
  );
  for (const tool of definitions) {
    await checked(
      db.from("mcp_tools").upsert(
        {
          org_id: orgId,
          server_id: serverId,
          tool_name: `${serverId}.${tool.name}`,
          remote_name: tool.name,
          description: String(tool.description ?? "").slice(0, 2000),
          input_schema: tool.inputSchema,
          definition_hash: await hashCredential(canonicalJson(tool)),
          required_capability: `mcp:${serverId}:${tool.name}`,
          risk: "high",
          status: "draft",
        },
        { onConflict: "org_id,tool_name" },
      ),
    );
  }
  await checked(
    db.from("mcp_servers").update({ status: "active" }).eq("org_id", orgId).eq("id", serverId),
  );
  await checked(
    db.from("audit_events").insert({
      org_id: orgId,
      actor_id: actor,
      action: "mcp.discovered",
      resource: "mcp_server",
      resource_id: serverId,
      result: "success",
      metadata: { tools: definitions.length },
    }),
  );
  return { discovered: definitions.length };
}

export async function executeTool(
  orgId: string,
  agentId: string,
  input: {
    toolId: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
  },
  approved?: { policies: PolicyRecord[]; definitionHash: string },
) {
  const agent = await activeAgent(orgId, agentId);
  const tool = await checked(
    db.from("mcp_tools").select("*").eq("org_id", orgId).eq("id", input.toolId).single(),
  );
  if (tool.status !== "active" || !tool.definition_hash || !tool.remote_name)
    throw new Error("Tool has not been approved for execution.");
  await requireCapability(orgId, agentId, tool.required_capability);
  const grant = await checked(
    db
      .from("mcp_tool_grants")
      .select("*")
      .eq("org_id", orgId)
      .eq("agent_id", agentId)
      .eq("tool_id", tool.id)
      .maybeSingle(),
  );
  if (!grant) throw new Error("Agent has no grant for this tool.");
  if (approved && approved.definitionHash !== tool.definition_hash)
    throw new Error("Tool definition changed after approval.");
  const server = await checked(
    db.from("mcp_servers").select("*").eq("org_id", orgId).eq("id", tool.server_id).single(),
  );
  if (server.status !== "active") throw new Error("MCP server is inactive.");
  const policies = await checked(
    db
      .from("policies")
      .select("id,name,description,priority,action,version,status,scope,conditions")
      .eq("org_id", orgId),
  );
  const evaluated = toolDecision(
    policies,
    input.arguments,
    tool.tool_name,
    "request",
    approved?.policies,
  );
  const invocation = await checked(
    db
      .from("tool_invocations")
      .insert({
        org_id: orgId,
        agent_id: agentId,
        tool_id: tool.id,
        idempotency_key: input.idempotencyKey,
      })
      .select("id")
      .single(),
  );
  const finish = async (
    status: string,
    decision: string,
    reason: string,
    output: unknown = null,
    approvalId: string | null = null,
  ) => {
    await checked(
      db
        .from("tool_invocations")
        .update({ status, decision, reason })
        .eq("org_id", orgId)
        .eq("id", invocation.id),
    );
    await checked(
      db.from("audit_events").insert({
        org_id: orgId,
        actor_type: "agent",
        action: "mcp.call",
        resource: "mcp_tool",
        resource_id: tool.id,
        decision,
        result: status,
        source: "mcp",
        metadata: { agentId, invocationId: invocation.id },
      }),
    );
    return {
      status,
      decision,
      reason,
      output: output === null ? null : JSON.stringify(output),
      requestId: invocation.id,
      approvalId,
    };
  };
  if (evaluated.decision.action === "BLOCK")
    return finish("blocked", "BLOCK", evaluated.decision.reason);
  if (
    evaluated.decision.action === "REQUIRE_APPROVAL" ||
    (!approved && (grant.requires_approval || ["high", "critical"].includes(tool.risk)))
  ) {
    const approval = await checked(
      db
        .from("approvals")
        .insert({
          org_id: orgId,
          requester_id: agent.owner_id,
          action: "mcp.execute",
          target: tool.tool_name,
          risk: tool.risk,
          reason: "Tool invocation requires human approval.",
          idempotency_key: input.idempotencyKey,
          payload: {
            agentId,
            toolId: tool.id,
            arguments: evaluated.sanitized,
            definitionHash: tool.definition_hash,
            policies,
            prompt: JSON.stringify(evaluated.sanitized),
          },
        })
        .select("id")
        .single(),
    );
    return finish(
      "pending_approval",
      "REQUIRE_APPROVAL",
      "Tool invocation is awaiting approval.",
      null,
      approval.id,
    );
  }
  // Persist dispatch intent before touching the remote service. Failures are not retried.
  await checked(
    db.from("audit_events").insert({
      org_id: orgId,
      actor_type: "agent",
      action: "mcp.dispatch",
      resource: "mcp_tool",
      resource_id: tool.id,
      result: "dispatching",
      source: "mcp",
      metadata: { agentId, invocationId: invocation.id },
    }),
  );
  try {
    const result = await connect(server, async (call) => {
      const remote = (await listRemote(call)).find((t) => t.name === tool.remote_name);
      if (!remote || (await hashCredential(canonicalJson(remote))) !== tool.definition_hash)
        throw new Error("Remote tool changed; rediscovery required.");
      // Recheck lifecycle and grants immediately before an external side effect.
      await activeAgent(orgId, agentId);
      await requireCapability(orgId, agentId, tool.required_capability);
      const current = await checked(
        db
          .from("mcp_tool_grants")
          .select("id,requires_approval")
          .eq("org_id", orgId)
          .eq("agent_id", agentId)
          .eq("tool_id", tool.id)
          .maybeSingle(),
      );
      if (!current || (current.requires_approval && !approved))
        throw new Error("Tool grant changed.");
      return call("tools/call", {
        name: tool.remote_name,
        arguments: evaluated.decision.action === "REDACT" ? evaluated.sanitized : input.arguments,
      });
    });
    if (result?.isError)
      return finish("tool_error", "BLOCK", "Remote tool returned an error; details withheld.");
    const response = toolDecision(policies, result, tool.tool_name, "response");
    if (["BLOCK", "REQUIRE_APPROVAL"].includes(response.decision.action))
      return finish("response_blocked", "BLOCK", response.decision.reason);
    return finish(
      "completed",
      evaluated.decision.action,
      evaluated.decision.reason,
      response.sanitized,
    );
  } catch {
    return finish(
      "tool_error",
      "BLOCK",
      "Tool call could not be verified or completed. Inspect the remote service before retrying.",
    );
  }
}

export async function executeApprovedTool(orgId: string, approvalId: string, payload: any) {
  if (
    !payload?.agentId ||
    !payload.toolId ||
    !payload.arguments ||
    !Array.isArray(payload.policies) ||
    typeof payload.definitionHash !== "string"
  )
    throw new Error("Approval payload is incomplete.");
  return executeTool(
    orgId,
    payload.agentId,
    {
      toolId: payload.toolId,
      arguments: payload.arguments,
      idempotencyKey: approvalId,
    },
    { policies: payload.policies, definitionHash: payload.definitionHash },
  );
}
