import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checked } from "./gateway.server";
import { activeAgent, requireCapability } from "./agents.server";
import { hashCredential } from "./agent-credentials";
import { canonicalJson, redactToolData, toolDecision } from "./tool-policy";
import { withMcp, validateMcpEndpoint } from "./mcp-transport";
import type { PolicyRecord } from "./policy-engine";
import { requireOrgEntitlement } from "./entitlements.server";
import { requireAiExecutionAllowed } from "./ai-controls.server";
import { writeExecutionEvent } from "./execution-trace.server";
import { inspect } from "./dlp";
import {
  createGovernanceDecisionRecorder,
  createGovernedExecution,
  finalizeGovernedExecution,
  loadIntentForExecution,
  resolveIntent,
} from "./governance-runtime.server";
import type { GovernanceIdentity, PolicyOutcome } from "./governance-types";

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
    objective?: string;
    intentId?: string;
  },
  approved?: {
    policies: PolicyRecord[];
    definitionHash: string;
    approvalId?: string;
    scope?: Record<string, unknown>;
  },
) {
  await requireOrgEntitlement(orgId, "mcp_controls");
  const agent = await activeAgent(orgId, agentId);
  const identity: GovernanceIdentity = {
    actorId: agent.owner_id,
    actorType: "agent",
    agentId,
    applicationId: "agent-api",
    organizationId: orgId,
  };
  const objective =
    input.objective ??
    `Use governed tool ${input.toolId} with ${canonicalJson(redactToolData(input.arguments))}`;
  const intent = input.intentId
    ? await loadIntentForExecution(orgId, input.intentId)
    : await resolveIntent({
        orgId,
        actorId: agent.owner_id,
        applicationId: "agent-api",
        objective,
        context: {
          requestedAction: "tool.invoke",
          resource: input.toolId,
        },
      });
  const governed = await createGovernedExecution({ orgId, intentId: intent.id, identity });
  const recordDecision = createGovernanceDecisionRecorder({
    orgId,
    intent,
    executionId: governed.executionId,
    traceId: governed.traceId,
    identity,
  });

  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "identity",
    status: "passed",
    summary: "Agent identity resolved before governed tool execution.",
  });

  const baseResult = {
    intentId: intent.id,
    executionId: governed.executionId,
    traceId: governed.traceId,
  };

  const finalizeBlocked = async (
    reason: string,
    decision: PolicyOutcome = "DENY_ACTION",
    requestId: string | null = null,
    approvalId: string | null = null,
  ) => {
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome:
        decision === "QUARANTINE" ? "TERMINATED" : "COMPLETED_WITH_POLICY_BLOCK",
      governanceOutcome: decision,
    });
    return {
      status: decision === "REQUIRE_APPROVAL" ? "pending_approval" : "blocked",
      decision:
        decision === "REQUIRE_APPROVAL"
          ? "REQUIRE_APPROVAL"
          : decision === "ALLOW_WITH_TRANSFORMATION"
            ? "REDACT"
            : "BLOCK",
      reason,
      output: null,
      requestId,
      approvalId,
      ...baseResult,
    };
  };

  if (intent.status === "quarantined" && !approved?.approvalId) {
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "QUARANTINE",
      reason: intent.inheritedQuarantine
        ? "Tool execution denied because this intent inherited quarantine from a high-confidence ancestor."
        : "Tool execution denied because this intent is quarantined.",
      policyId: null,
      policyVersion: null,
      ruleId: null,
      evaluatedContext: {
        agentId,
        toolId: input.toolId,
        intentStatus: intent.status,
        lineageConfidence: intent.lineageConfidence,
      },
      attributes: { lineageConfidence: intent.lineageConfidence },
    });
    return finalizeBlocked(
      "Intent is quarantined and cannot invoke tools without explicit review.",
      "QUARANTINE",
    );
  }

  try {
    await requireAiExecutionAllowed(orgId, "agent");
  } catch {
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "permissions",
      status: "blocked",
      summary: "Organization AI controls denied agent tool execution.",
    });
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "DENY_EXECUTION",
      reason: "Organization AI controls denied this agent tool request.",
      policyId: null,
      policyVersion: null,
      ruleId: "org_ai_controls",
      evaluatedContext: { agentId, toolId: input.toolId },
      attributes: {},
    });
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome: "DENIED_BEFORE_EXECUTION",
      governanceOutcome: "DENY_EXECUTION",
    });
    throw new Error("AI execution is disabled by organization controls.");
  }

  await recordDecision({
    enforcementPoint: "PRE_EXECUTION",
    decision: "ALLOW",
    reason: "Agent identity and organization execution controls passed.",
    policyId: null,
    policyVersion: null,
    ruleId: "agent_tool_pre_execution",
    evaluatedContext: {
      agentId,
      ownerId: agent.owner_id,
      toolId: input.toolId,
      applicationId: "agent-api",
    },
    attributes: approved?.approvalId
      ? { approvalId: approved.approvalId, approvalConsumed: true }
      : {},
  });

  if (approved?.approvalId) {
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "ALLOW",
      reason: "Scoped single-use human approval was consumed for a fresh governed execution.",
      policyId: null,
      policyVersion: null,
      ruleId: "approval_consumed",
      evaluatedContext: {
        approvalId: approved.approvalId,
        approvalScope: approved.scope ?? {},
        originalIntentId: intent.id,
      },
      attributes: {
        approvalId: approved.approvalId,
        approvalScope: approved.scope ?? {},
      },
    });
  }

  const tool = await checked(
    db
      .from("mcp_tools")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", input.toolId)
      .maybeSingle(),
  );
  if (!tool || tool.status !== "active" || !tool.definition_hash || !tool.remote_name) {
    await recordDecision({
      enforcementPoint: "PRE_TOOL_INVOCATION",
      decision: "DENY_ACTION",
      reason: "Requested tool is unavailable or has not been explicitly approved.",
      policyId: null,
      policyVersion: null,
      ruleId: "tool_active_definition",
      evaluatedContext: { agentId, toolId: input.toolId },
      attributes: {},
    });
    return finalizeBlocked("Tool is unavailable or not approved.");
  }

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

  const finishInvocation = async (
    status: string,
    decision: string,
    reason: string,
    output: unknown = null,
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
        metadata: {
          agentId,
          invocationId: invocation.id,
          governedExecutionId: governed.executionId,
          intentId: intent.id,
          traceId: governed.traceId,
        },
      }),
    );
  };

  try {
    await requireCapability(orgId, agentId, tool.required_capability);
  } catch {
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "tool_authorization",
      status: "blocked",
      summary: "Agent lacks the capability required for this tool.",
      detail: { capability: tool.required_capability },
    });
    await recordDecision({
      enforcementPoint: "PRE_TOOL_INVOCATION",
      decision: "DENY_ACTION",
      reason: "Agent lacks the capability required for this tool.",
      policyId: null,
      policyVersion: null,
      ruleId: "agent_tool_capability",
      evaluatedContext: {
        agentId,
        toolId: tool.id,
        requiredCapability: tool.required_capability,
      },
      attributes: { toolSensitivity: tool.risk },
    });
    await finishInvocation("blocked", "BLOCK", "Agent lacks tool capability.");
    return finalizeBlocked("Agent lacks tool capability.", "DENY_ACTION", invocation.id);
  }

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
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "tool_authorization",
      status: "blocked",
      summary: "Agent has no explicit grant for this tool.",
    });
    await recordDecision({
      enforcementPoint: "PRE_TOOL_INVOCATION",
      decision: "DENY_ACTION",
      reason: "Agent has no explicit grant for this tool.",
      policyId: null,
      policyVersion: null,
      ruleId: "mcp_tool_grant",
      evaluatedContext: { agentId, toolId: tool.id },
      attributes: { toolSensitivity: tool.risk },
    });
    await finishInvocation("blocked", "BLOCK", "Agent has no grant for this tool.");
    return finalizeBlocked("Agent has no grant for this tool.", "DENY_ACTION", invocation.id);
  }

  if (approved && approved.definitionHash !== tool.definition_hash) {
    await recordDecision({
      enforcementPoint: "PRE_TOOL_INVOCATION",
      decision: "DENY_ACTION",
      reason: "Tool definition changed after approval.",
      policyId: null,
      policyVersion: null,
      ruleId: "approved_tool_definition",
      evaluatedContext: {
        toolId: tool.id,
        expectedDefinitionHash: approved.definitionHash,
        currentDefinitionHash: tool.definition_hash,
      },
      attributes: { approvalId: approved.approvalId ?? null },
    });
    await finishInvocation("blocked", "BLOCK", "Tool definition changed after approval.");
    return finalizeBlocked(
      "Tool definition changed after approval.",
      "DENY_ACTION",
      invocation.id,
    );
  }

  if (
    approved?.scope &&
    (approved.scope["operation"] !== "tool.invoke" ||
      approved.scope["toolId"] !== tool.id ||
      approved.scope["definitionHash"] !== tool.definition_hash)
  ) {
    await recordDecision({
      enforcementPoint: "PRE_TOOL_INVOCATION",
      decision: "DENY_ACTION",
      reason: "Human approval scope does not authorize this tool invocation.",
      policyId: null,
      policyVersion: null,
      ruleId: "approval_scope",
      evaluatedContext: { approvalScope: approved.scope, toolId: tool.id },
      attributes: { approvalId: approved.approvalId ?? null },
    });
    await finishInvocation("blocked", "BLOCK", "Approval scope does not authorize tool.");
    return finalizeBlocked(
      "Approval scope does not authorize this tool.",
      "DENY_ACTION",
      invocation.id,
    );
  }

  const server = await checked(
    db.from("mcp_servers").select("*").eq("org_id", orgId).eq("id", tool.server_id).single(),
  );
  if (server.status !== "active") {
    await recordDecision({
      enforcementPoint: "PRE_TOOL_INVOCATION",
      decision: "DENY_ACTION",
      reason: "The MCP server is inactive.",
      policyId: null,
      policyVersion: null,
      ruleId: "mcp_server_status",
      evaluatedContext: { serverId: server.id, toolId: tool.id },
      attributes: {},
    });
    await finishInvocation("blocked", "BLOCK", "MCP server is inactive.");
    return finalizeBlocked("MCP server is inactive.", "DENY_ACTION", invocation.id);
  }

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
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "permissions",
    status: "passed",
    summary: `Agent capability ${tool.required_capability} and explicit tool grant are authorized.`,
    detail: { capability: tool.required_capability, grantId: grant.id },
  });
  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "pii",
    status: piiDetections.length ? "redacted" : "passed",
    summary: piiDetections.length
      ? `${piiDetections.length} sensitive-data finding(s) detected in tool arguments.`
      : "No PII or secret pattern detected in tool arguments.",
    detail: {
      detections: piiDetections.map((d) => ({ category: d.category, severity: d.severity })),
    },
  });
  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "injection",
    status: injectionDetections.length ? "blocked" : "passed",
    summary: injectionDetections.length
      ? `${injectionDetections.length} injection/exfiltration signal(s) detected in tool arguments.`
      : "No prompt-injection signal detected in tool arguments.",
    detail: {
      detections: injectionDetections.map((d) => ({
        category: d.category,
        severity: d.severity,
      })),
    },
  });
  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "budget",
    status: "not_applicable",
    summary: "MCP tool call has no model-provider token charge in the Nexora budget meter.",
  });
  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
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
  const preToolDecision: PolicyOutcome =
    evaluated.decision.action === "BLOCK"
      ? "DENY_ACTION"
      : evaluated.decision.action === "REQUIRE_APPROVAL"
        ? "REQUIRE_APPROVAL"
        : evaluated.decision.action === "REDACT"
          ? "ALLOW_WITH_TRANSFORMATION"
          : "ALLOW";

  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "tool_authorization",
    status:
      preToolDecision === "DENY_ACTION" || preToolDecision === "REQUIRE_APPROVAL"
        ? "blocked"
        : preToolDecision === "ALLOW_WITH_TRANSFORMATION"
          ? "redacted"
          : "passed",
    summary: evaluated.decision.reason,
    detail: { decision: preToolDecision, tool: tool.remote_name },
  });
  await recordDecision({
    enforcementPoint: "PRE_TOOL_INVOCATION",
    decision: preToolDecision,
    reason: evaluated.decision.reason,
    policyId: evaluated.decision.policyId,
    policyVersion: evaluated.decision.policyVersion,
    ruleId: evaluated.decision.matchedRules[0]?.policyId ?? null,
    evaluatedContext: {
      agentId,
      toolId: tool.id,
      toolName: tool.tool_name,
      serverId: server.id,
      destination: server.url,
      detectionCategories: rawDetections.map((d) => d.category),
    },
    attributes: {
      toolSensitivity: tool.risk,
      destination: server.url,
      transformed: preToolDecision === "ALLOW_WITH_TRANSFORMATION",
      policyContext: {
        detectionCategories: rawDetections.map((d) => ({
          category: d.category,
          severity: d.severity,
        })),
        actorType: "agent",
        stage: "request",
      },
    },
  });

  if (preToolDecision === "DENY_ACTION") {
    await finishInvocation("blocked", "BLOCK", evaluated.decision.reason);
    return finalizeBlocked(evaluated.decision.reason, "DENY_ACTION", invocation.id);
  }

  if (
    preToolDecision === "REQUIRE_APPROVAL" ||
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
          intent_id: intent.id,
          original_execution_id: governed.executionId,
          approval_scope: {
            operation: "tool.invoke",
            toolId: tool.id,
            toolName: tool.tool_name,
            serverId: server.id,
            destination: server.url,
            definitionHash: tool.definition_hash,
          },
          single_use: true,
          payload: {
            agentId,
            toolId: tool.id,
            arguments: evaluated.sanitized,
            definitionHash: tool.definition_hash,
            policies,
            objective: input.objective ? redactToolData(input.objective) : null,
          },
        })
        .select("id")
        .single(),
    );
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "execution",
      status: "blocked",
      summary: "Tool execution stopped; scoped human approval is required.",
      detail: { approvalId: approval.id },
    });
    await finishInvocation(
      "pending_approval",
      "REQUIRE_APPROVAL",
      "Tool invocation is awaiting scoped human approval.",
    );
    return finalizeBlocked(
      "Tool invocation is awaiting scoped human approval.",
      "REQUIRE_APPROVAL",
      invocation.id,
      approval.id,
    );
  }

  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "execution",
    status: "running",
    summary: "Remote MCP tool dispatch authorized.",
  });
  await checked(
    db.from("audit_events").insert({
      org_id: orgId,
      actor_type: "agent",
      action: "mcp.dispatch",
      resource: "mcp_tool",
      resource_id: tool.id,
      result: "dispatching",
      source: "mcp",
      metadata: {
        agentId,
        invocationId: invocation.id,
        governedExecutionId: governed.executionId,
        intentId: intent.id,
        traceId: governed.traceId,
      },
    }),
  );

  try {
    const result = await connect(server, async (call) => {
      const remote = (await listRemote(call)).find((t) => t.name === tool.remote_name);
      if (!remote || (await hashCredential(canonicalJson(remote))) !== tool.definition_hash)
        throw new Error("Remote tool changed; rediscovery required.");

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
        arguments:
          preToolDecision === "ALLOW_WITH_TRANSFORMATION"
            ? evaluated.sanitized
            : input.arguments,
      });
    });

    if (result?.isError) {
      await recordDecision({
        enforcementPoint: "POST_TOOL_EXECUTION",
        decision: "DENY_ACTION",
        reason: "Remote tool returned an error; its result cannot be used downstream.",
        policyId: null,
        policyVersion: null,
        ruleId: "remote_tool_error",
        evaluatedContext: { toolId: tool.id, invocationId: invocation.id },
        attributes: { toolSensitivity: tool.risk },
      });
      await recordDecision({
        enforcementPoint: "PRE_RESPONSE",
        decision: "DENY_ACTION",
        reason: "Tool error output is withheld from the governed response.",
        policyId: null,
        policyVersion: null,
        ruleId: "tool_error_response",
        evaluatedContext: { toolId: tool.id, invocationId: invocation.id },
        attributes: {},
      });
      await finishInvocation(
        "tool_error",
        "BLOCK",
        "Remote tool returned an error; details withheld.",
      );
      await finalizeGovernedExecution({
        orgId,
        executionId: governed.executionId,
        workflowOutcome: "FAILED_EXECUTION",
        governanceOutcome: "DENY_ACTION",
      });
      return {
        status: "tool_error",
        decision: "BLOCK",
        reason: "Remote tool returned an error; details withheld.",
        output: null,
        requestId: invocation.id,
        approvalId: null,
        ...baseResult,
      };
    }

    const response = toolDecision(policies, result, tool.tool_name, "response");
    const postToolDecision: PolicyOutcome =
      response.decision.action === "BLOCK" || response.decision.action === "REQUIRE_APPROVAL"
        ? "DENY_ACTION"
        : response.decision.action === "REDACT"
          ? "ALLOW_WITH_TRANSFORMATION"
          : "ALLOW";

    await recordDecision({
      enforcementPoint: "POST_TOOL_EXECUTION",
      decision: postToolDecision,
      reason: response.decision.reason,
      policyId: response.decision.policyId,
      policyVersion: response.decision.policyVersion,
      ruleId: response.decision.matchedRules[0]?.policyId ?? null,
      evaluatedContext: {
        toolId: tool.id,
        invocationId: invocation.id,
        responseDecision: response.decision.action,
      },
      attributes: {
        toolSensitivity: tool.risk,
        transformed: postToolDecision === "ALLOW_WITH_TRANSFORMATION",
      },
    });
    await recordDecision({
      enforcementPoint: "PRE_RESPONSE",
      decision: postToolDecision,
      reason:
        postToolDecision === "DENY_ACTION"
          ? "Tool result was withheld by response governance."
          : response.decision.reason,
      policyId: response.decision.policyId,
      policyVersion: response.decision.policyVersion,
      ruleId: response.decision.matchedRules[0]?.policyId ?? null,
      evaluatedContext: {
        toolId: tool.id,
        invocationId: invocation.id,
        outputWithheld: postToolDecision === "DENY_ACTION",
      },
      attributes: {
        transformed: postToolDecision === "ALLOW_WITH_TRANSFORMATION",
      },
    });

    if (postToolDecision === "DENY_ACTION") {
      await finishInvocation("response_blocked", "BLOCK", response.decision.reason);
      await finalizeGovernedExecution({
        orgId,
        executionId: governed.executionId,
        workflowOutcome: "COMPLETED_WITH_POLICY_BLOCK",
        governanceOutcome: "DENY_ACTION",
      });
      return {
        status: "response_blocked",
        decision: "BLOCK",
        reason: response.decision.reason,
        output: null,
        requestId: invocation.id,
        approvalId: null,
        ...baseResult,
      };
    }

    const transformed =
      preToolDecision === "ALLOW_WITH_TRANSFORMATION" ||
      postToolDecision === "ALLOW_WITH_TRANSFORMATION";
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "execution",
      status: "completed",
      summary: transformed
        ? "Remote tool execution completed with governed transformation."
        : "Remote tool execution completed and response controls passed.",
    });
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "audit",
      status: "completed",
      summary: "Tool invocation and governance evidence persisted.",
      detail: { invocationId: invocation.id, traceId: governed.traceId },
    });
    await finishInvocation(
      "completed",
      transformed ? "REDACT" : "ALLOW",
      response.decision.reason,
      response.sanitized,
    );
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome: transformed ? "COMPLETED_WITH_REDACTION" : "COMPLETED",
      governanceOutcome: transformed ? "ALLOW_WITH_TRANSFORMATION" : "ALLOW",
    });
    return {
      status: "completed",
      decision: transformed ? "REDACT" : "ALLOW",
      reason: response.decision.reason,
      output: JSON.stringify(response.sanitized),
      requestId: invocation.id,
      approvalId: null,
      ...baseResult,
    };
  } catch {
    await recordDecision({
      enforcementPoint: "POST_TOOL_EXECUTION",
      decision: "DENY_ACTION",
      reason: "Tool call could not be verified or completed.",
      policyId: null,
      policyVersion: null,
      ruleId: "tool_execution_failure",
      evaluatedContext: { toolId: tool.id, invocationId: invocation.id },
      attributes: { toolSensitivity: tool.risk },
    });
    await recordDecision({
      enforcementPoint: "PRE_RESPONSE",
      decision: "DENY_ACTION",
      reason: "Ambiguous or failed tool result is withheld.",
      policyId: null,
      policyVersion: null,
      ruleId: "tool_failure_response",
      evaluatedContext: { toolId: tool.id, invocationId: invocation.id },
      attributes: {},
    });
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "execution",
      status: "failed",
      summary: "Tool call could not be verified or completed.",
    });
    await finishInvocation(
      "tool_error",
      "BLOCK",
      "Tool call could not be verified or completed. Inspect the remote service before retrying.",
    );
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome: "FAILED_EXECUTION",
      governanceOutcome: "DENY_ACTION",
    });
    return {
      status: "tool_error",
      decision: "BLOCK",
      reason: "Tool call could not be verified or completed. Inspect the remote service before retrying.",
      output: null,
      requestId: invocation.id,
      approvalId: null,
      ...baseResult,
    };
  }
}

export async function executeApprovedTool(
  orgId: string,
  approvalId: string,
  payload: any,
  approval: { intentId: string; scope: Record<string, unknown> },
) {
  if (
    !payload?.agentId ||
    !payload.toolId ||
    !payload.arguments ||
    !Array.isArray(payload.policies) ||
    typeof payload.definitionHash !== "string" ||
    !approval.intentId ||
    approval.scope?.["operation"] !== "tool.invoke"
  )
    throw new Error("Approval payload or scope is incomplete.");

  return executeTool(
    orgId,
    payload.agentId,
    {
      toolId: payload.toolId,
      arguments: payload.arguments,
      idempotencyKey: approvalId,
      intentId: approval.intentId,
      ...(typeof payload.objective === "string" && payload.objective
        ? { objective: payload.objective }
        : {}),
    },
    {
      policies: payload.policies,
      definitionHash: payload.definitionHash,
      approvalId,
      scope: approval.scope,
    },
  );
}
