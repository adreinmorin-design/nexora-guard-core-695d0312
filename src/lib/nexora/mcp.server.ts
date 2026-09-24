import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checked } from "./gateway.server";
import { activeAgent, requireCapability } from "./agents.server";
import { hashCredential } from "./agent-credentials";
import { canonicalJson, toolDecision } from "./tool-policy";
import { withMcp, validateMcpEndpoint } from "./mcp-transport";
import type { PolicyRecord } from "./policy-engine";
import { requireOrgEntitlement } from "./entitlements.server";
import { requireAiExecutionAllowed } from "./ai-controls.server";
import { writeExecutionEvent } from "./execution-trace.server";
import { inspect } from "./dlp";

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
  await requireOrgEntitlement(orgId, "mcp_controls");
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
  const executionId = input.idempotencyKey;
  await requireOrgEntitlement(orgId, "mcp_controls");
  await requireAiExecutionAllowed(orgId, "agent");
  const agent = await activeAgent(orgId, agentId);
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "identity",
    status: "passed",
    summary: "Agent credential, lifecycle and owner membership verified.",
  });
  const tool = await checked(
    db.from("mcp_tools").select("*").eq("org_id", orgId).eq("id", input.toolId).single(),
  );
  if (tool.status !== "active" || !tool.definition_hash || !tool.remote_name)
    throw new Error("Tool has not been approved for execution.");
  await requireCapability(orgId, agentId, tool.required_capability);
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "permissions",
    status: "passed",
    summary: `Agent capability ${tool.required_capability} is authorized.`,
    detail: { capability: tool.required_capability },
  });
  // Record the attempt before capability/grant checks so denied calls are auditable.
  const invocation = await checked(
    db
      .from("tool_invocations")
      .insert({
        org_id: orgId,
        agent_id: agentId,
        tool_id: tool.id,
        idempotency_key: input.idempotencyKey,
        status: "pending",
        decision: "PENDING",
        reason: "Tool authorization in progress.",
      })
      .select("id")
      .single(),
  );
  const markDenied = async (reason: string) => {
    await checked(
      db
        .from("tool_invocations")
        .update({ status: "blocked", decision: "BLOCK", reason })
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
        decision: "BLOCK",
        result: "blocked",
        source: "mcp",
        metadata: { agentId, invocationId: invocation.id },
      }),
    );
  };
  const grant = await checked(
    db
      .from("mcp_tool_grants")
      .select("*")
      .eq("org_id", orgId)
      .eq("agent_id", agentId)
      .eq("tool_id", tool.id)
      .maybeSingle(),
  );
  if (!grant) {
    await writeExecutionEvent({
      orgId,
      executionId,
      agentId,
      actorType: "agent",
      stage: "tool_authorization",
      status: "blocked",
      summary: "Agent has no explicit grant for this tool.",
      detail: { invocationId: invocation.id },
    });
    await markDenied("Agent has no grant for this tool.");
    throw new Error("Agent has no grant for this tool.");
  }
  if (approved && approved.definitionHash !== tool.definition_hash)
    throw new Error("Tool definition changed after approval.");
  const server = await checked(
    db.from("mcp_servers").select("*").eq("org_id", orgId).eq("id", tool.server_id).single(),
  );
  if (server.status !== "active") throw new Error("MCP server is inactive.");
  const rawToolText = JSON.stringify(input.arguments);
  const rawDetections = inspect(rawToolText);
  const injectionCategories = new Set([
    "prompt_injection",
    "system_prompt_extraction",
    "data_exfiltration",
  ]);
  const injectionDetections = rawDetections.filter((d) => injectionCategories.has(d.category));
  const piiDetections = rawDetections.filter((d) => !injectionCategories.has(d.category));
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "pii",
    status: "passed",
    summary: piiDetections.length
      ? `${piiDetections.length} sensitive-data finding(s) detected in tool arguments.`
      : "No PII or secret pattern detected in tool arguments.",
    detail: {
      detections: piiDetections.map((d) => ({ category: d.category, severity: d.severity })),
    },
  });
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "injection",
    status: "passed",
    summary: injectionDetections.length
      ? `${injectionDetections.length} injection/exfiltration signal(s) detected in tool arguments.`
      : "No prompt-injection signal detected in tool arguments.",
    detail: {
      detections: injectionDetections.map((d) => ({ category: d.category, severity: d.severity })),
    },
  });
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "budget",
    status: "not_applicable",
    summary: "MCP tool call has no model-provider token charge in the NEXORA budget meter.",
  });
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "provider_selection",
    status: "passed",
    summary: `MCP server selected for ${tool.remote_name}.`,
    detail: { serverId: server.id, toolId: tool.id },
  });
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
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "tool_authorization",
    status:
      evaluated.decision.action === "BLOCK"
        ? "blocked"
        : evaluated.decision.action === "REQUIRE_APPROVAL"
          ? "blocked"
          : "passed",
    summary:
      evaluated.decision.action === "BLOCK"
        ? evaluated.decision.reason
        : evaluated.decision.action === "REQUIRE_APPROVAL"
          ? "Tool authorization requires human approval."
          : "Tool grant, capability and policy authorization passed.",
    detail: { decision: evaluated.decision.action, tool: tool.remote_name },
  });
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
  if (evaluated.decision.action === "BLOCK") {
    await writeExecutionEvent({
      orgId,
      executionId,
      agentId,
      actorType: "agent",
      stage: "execution",
      status: "blocked",
      summary: "Tool execution stopped before remote dispatch.",
    });
    return finish("blocked", "BLOCK", evaluated.decision.reason);
  }
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
    await writeExecutionEvent({
      orgId,
      executionId,
      agentId,
      actorType: "agent",
      stage: "execution",
      status: "blocked",
      summary: "Tool execution paused for human approval.",
      detail: { approvalId: approval.id },
    });
    return finish(
      "pending_approval",
      "REQUIRE_APPROVAL",
      "Tool invocation is awaiting approval.",
      null,
      approval.id,
    );
  }
  await writeExecutionEvent({
    orgId,
    executionId,
    agentId,
    actorType: "agent",
    stage: "execution",
    status: "running",
    summary: "Remote MCP tool dispatch authorized.",
  });
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
    if (result?.isError) {
      await writeExecutionEvent({
        orgId,
        executionId,
        agentId,
        actorType: "agent",
        stage: "execution",
        status: "failed",
        summary: "Remote tool returned an error; details withheld.",
      });
      return finish("tool_error", "BLOCK", "Remote tool returned an error; details withheld.");
    }
    const response = toolDecision(policies, result, tool.tool_name, "response");
    if (["BLOCK", "REQUIRE_APPROVAL"].includes(response.decision.action))
      return finish("response_blocked", "BLOCK", response.decision.reason);
    await writeExecutionEvent({
      orgId,
      executionId,
      agentId,
      actorType: "agent",
      stage: "execution",
      status: "completed",
      summary: "Remote tool execution completed and response controls passed.",
    });
    await writeExecutionEvent({
      orgId,
      executionId,
      agentId,
      actorType: "agent",
      stage: "audit",
      status: "completed",
      summary: "Tool invocation and audit evidence persisted.",
      detail: { invocationId: invocation.id },
    });
    return finish(
      "completed",
      evaluated.decision.action,
      evaluated.decision.reason,
      response.sanitized,
    );
  } catch {
    await writeExecutionEvent({
      orgId,
      executionId,
      agentId,
      actorType: "agent",
      stage: "execution",
      status: "failed",
      summary: "Tool call could not be verified or completed.",
    });
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
