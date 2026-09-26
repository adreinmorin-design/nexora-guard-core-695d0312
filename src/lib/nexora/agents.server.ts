import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checked, makeStore } from "./gateway.server";
import { runGovernedRequest } from "./pipeline";
import { executeProviderRequest } from "../ai-gateway.server";
import { agentBearer, hashCredential } from "./agent-credentials";
import type { PolicyRecord } from "./policy-engine";
import { requireOrgEntitlement } from "./entitlements.server";
import { requireAiExecutionAllowed } from "./ai-controls.server";
import { writeExecutionEvent } from "./execution-trace.server";
import {
  createGovernanceDecisionRecorder,
  createGovernedExecution,
  finalizeGovernedExecution,
  loadIntentForExecution,
  resolveIntent,
} from "./governance-runtime.server";
import {
  executionOutcomeForLegacyResult,
  legacyActionToPolicyOutcome,
  type GovernanceIdentity,
} from "./governance-types";

const db: any = supabaseAdmin;

export async function activeAgent(orgId: string, agentId: string) {
  const agent = await checked(
    db
      .from("agents")
      .select("id,org_id,owner_id,status,credential_expires_at")
      .eq("org_id", orgId)
      .eq("id", agentId)
      .single(),
  );
  if (
    !agent ||
    agent.status !== "active" ||
    !agent.credential_expires_at ||
    Date.parse(agent.credential_expires_at) <= Date.now()
  )
    throw new Error("Agent is inactive or its credential has expired.");
  const owner = await checked(
    db.from("org_members").select("id").eq("org_id", orgId).eq("user_id", agent.owner_id).limit(1),
  );
  if (!owner.length) throw new Error("Agent owner is no longer a member.");
  return agent;
}

export async function requireCapability(orgId: string, agentId: string, capability: string) {
  const rows = await checked(
    db
      .from("agent_capabilities")
      .select("id")
      .eq("org_id", orgId)
      .eq("agent_id", agentId)
      .eq("capability", capability)
      .limit(1),
  );
  if (!rows.length) throw new Error("Agent lacks the required capability.");
  if (["model:invoke", "findings:resolve"].includes(capability)) {
    const agent = await activeAgent(orgId, agentId);
    const roles = await checked(
      db.from("org_members").select("role").eq("org_id", orgId).eq("user_id", agent.owner_id),
    );
    const allowed =
      capability === "findings:resolve"
        ? ["platform_admin", "org_admin", "security_admin"]
        : [
            "platform_admin",
            "org_admin",
            "security_admin",
            "governance_admin",
            "agent_admin",
            "developer",
          ];
    if (!roles.some((r: any) => allowed.includes(r.role)))
      throw new Error("Agent owner no longer has permission for this action.");
  }
}

export async function claimAgent(input: {
  id: string;
  key: string;
  actor?: string;
  hash?: string;
}) {
  return checked(
    db.rpc("nexora_claim_agent", {
      p_agent: input.id,
      p_key: input.key,
      p_actor: input.actor ?? null,
      p_hash: input.hash ?? null,
    }),
  );
}

export async function authenticateAgent(header: string | null, key: string) {
  const hash = await hashCredential(agentBearer(header));
  const agent = await checked(db.from("agents").select("id").eq("token_hash", hash).maybeSingle());
  if (!agent) throw new Error("Invalid agent credential.");
  return claimAgent({ id: agent.id, key, hash });
}

export async function executeAgentModel(
  orgId: string,
  agentId: string,
  input: { prompt: string; modelKey: string; idempotencyKey: string },
  approvedPolicies?: PolicyRecord[],
  options?: {
    intentId?: string;
    objective?: string;
    approvalId?: string;
    approvalScope?: Record<string, unknown>;
    allowQuarantinedIntent?: boolean;
  },
) {
  const agent = await activeAgent(orgId, agentId);
  const identity: GovernanceIdentity = {
    actorId: agent.owner_id,
    actorType: "agent",
    agentId,
    applicationId: "agent-api",
    organizationId: orgId,
  };
  const intent = options?.intentId
    ? await loadIntentForExecution(orgId, options.intentId)
    : await resolveIntent({
        orgId,
        actorId: agent.owner_id,
        applicationId: "agent-api",
        objective: options?.objective ?? input.prompt,
        context: {
          requestedAction: "model.invoke",
          resource: input.modelKey,
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
    summary: "Agent credential, lifecycle and owner membership verified.",
  });

  if (intent.status === "quarantined" && !options?.allowQuarantinedIntent) {
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "QUARANTINE",
      reason: intent.inheritedQuarantine
        ? "Agent execution denied because this intent inherited quarantine from a high-confidence ancestor."
        : "Agent execution denied because this intent is quarantined.",
      policyId: null,
      policyVersion: null,
      ruleId: null,
      evaluatedContext: {
        agentId,
        intentStatus: intent.status,
        inheritedQuarantine: intent.inheritedQuarantine,
        lineageConfidence: intent.lineageConfidence,
      },
      attributes: { lineageConfidence: intent.lineageConfidence },
    });
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome: "TERMINATED",
      governanceOutcome: "QUARANTINE",
    });
    return {
      decision: "BLOCK" as const,
      reason: "Intent is quarantined and cannot execute without explicit review.",
      policy: null,
      matchedRules: [],
      findings: [],
      output: null,
      status: "terminated",
      approvalId: null,
      requestId: null,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latency: 0 },
      intentId: intent.id,
      executionId: governed.executionId,
      traceId: governed.traceId,
    };
  }

  let controls: Awaited<ReturnType<typeof requireAiExecutionAllowed>>;
  try {
    controls = await requireAiExecutionAllowed(orgId, "agent");
  } catch {
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "permissions",
      status: "blocked",
      summary: "Organization AI controls denied agent execution.",
    });
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "DENY_EXECUTION",
      reason: "Organization AI controls denied this agent request.",
      policyId: null,
      policyVersion: null,
      ruleId: "org_ai_controls",
      evaluatedContext: { actorType: "agent", agentId, applicationId: "agent-api" },
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

  try {
    await requireCapability(orgId, agentId, "model:invoke");
  } catch {
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      agentId,
      actorType: "agent",
      stage: "permissions",
      status: "blocked",
      summary: "Agent lacks model invocation authority.",
    });
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "DENY_EXECUTION",
      reason: "Agent lacks model:invoke capability or its owner no longer has runtime authority.",
      policyId: null,
      policyVersion: null,
      ruleId: "agent_model_capability",
      evaluatedContext: { actorType: "agent", agentId, capability: "model:invoke" },
      attributes: {},
    });
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome: "DENIED_BEFORE_EXECUTION",
      governanceOutcome: "DENY_EXECUTION",
    });
    throw new Error("Agent lacks model invocation authority.");
  }

  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    agentId,
    actorType: "agent",
    stage: "permissions",
    status: "passed",
    summary: "Agent has model:invoke capability and owner authority.",
  });
  await recordDecision({
    enforcementPoint: "PRE_EXECUTION",
    decision: "ALLOW",
    reason: "Agent identity, organization controls and model capability checks passed.",
    policyId: null,
    policyVersion: null,
    ruleId: "agent_runtime_pre_execution",
    evaluatedContext: {
      actorType: "agent",
      agentId,
      ownerId: agent.owner_id,
      applicationId: "agent-api",
      intentStatus: intent.status,
    },
    attributes: {},
  });

  if (options?.approvalId) {
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "ALLOW",
      reason:
        "Scoped single-use human approval was consumed for a fresh agent execution without clearing prior intent risk.",
      policyId: null,
      policyVersion: null,
      ruleId: "approval_consumed",
      evaluatedContext: {
        approvalId: options.approvalId,
        approvalScope: options.approvalScope ?? {},
        intentStatus: intent.status,
        agentId,
      },
      attributes: {
        approvalId: options.approvalId,
        approvalScope: options.approvalScope ?? {},
        intentRemainsFlagged: intent.status === "flagged" || intent.status === "quarantined",
      },
    });
  }

  try {
    const outcome = await runGovernedRequest({
      store: makeStore({ supabase: db }, orgId),
      principal: { kind: "agent", id: agentId, orgId, ownerId: agent.owner_id, source: "api" },
      ...input,
      ...(approvedPolicies ? { approvedPolicies } : {}),
      maxRequestCostUsd: controls.max_request_cost_usd,
      governedContext: { intentId: intent.id, executionId: governed.executionId },
      governanceDecision: async (event) => {
        await recordDecision(event);
      },
      trace: (event) =>
        writeExecutionEvent({
          orgId,
          executionId: governed.executionId,
          agentId,
          actorType: "agent",
          stage: event.stage,
          status: event.status,
          summary: event.summary,
          ...(event.detail ? { detail: event.detail } : {}),
          requestId: event.requestId ?? null,
        }),
      execute: executeProviderRequest,
    });

    const governanceOutcome = legacyActionToPolicyOutcome(outcome.decision);
    const workflowOutcome = executionOutcomeForLegacyResult({
      action: outcome.decision,
      status: outcome.status,
      providerExecuted: !["blocked", "pending_approval", "duplicate"].includes(outcome.status),
      redacted: outcome.decision === "REDACT",
    });
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome,
      governanceOutcome,
    });
    return {
      ...outcome,
      intentId: intent.id,
      executionId: governed.executionId,
      traceId: governed.traceId,
    };
  } catch (error) {
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome: "FAILED_EXECUTION",
      governanceOutcome: null,
    });
    throw error;
  }
}

export async function runAgentOperation(
  orgId: string,
  agentId: string,
  input: import("./agent-input").AgentTaskInput,
) {
  await activeAgent(orgId, agentId);
  await requireAiExecutionAllowed(orgId, "agent");
  if (input.kind === "model")
    return executeAgentModel(orgId, agentId, input, undefined, {
      intentId: input.intentId,
      objective: input.objective,
    });
  if (input.kind === "tool") {
    await requireOrgEntitlement(orgId, "mcp_controls");
    return (await import("./mcp.server")).executeTool(orgId, agentId, input);
  }
  if (input.kind === "finding") {
    await requireCapability(orgId, agentId, "findings:resolve");
    await checked(
      db.rpc("nexora_agent_finding", {
        p_org: orgId,
        p_agent: agentId,
        p_finding: input.findingId,
        p_status: input.status,
      }),
    );
    return {
      status: "completed",
      reason: "Finding updated.",
      output: JSON.stringify({ id: input.findingId, status: input.status }),
    };
  }
  if (input.resource === "status") {
    const [permissions, models, usageRows] = await Promise.all([
      checked(
        db
          .from("agent_capabilities")
          .select("capability")
          .eq("org_id", orgId)
          .eq("agent_id", agentId),
      ),
      checked(
        db
          .from("models")
          .select("model_key,display_name,status")
          .eq("org_id", orgId)
          .eq("status", "active"),
      ),
      checked(db.rpc("nexora_agent_usage", { p_org: orgId })),
    ]);
    const usage = usageRows.find((row: any) => row.agent_id === agentId) ?? {
      request_count: 0,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      last_used_at: null,
    };
    return {
      status: "completed",
      reason: "Connection is active.",
      output: JSON.stringify({
        agentId,
        orgId,
        permissions: permissions.map((p: any) => p.capability),
        models,
        usage,
      }),
    };
  }
  await requireCapability(orgId, agentId, `${input.resource}:read`);
  const table = input.resource === "findings" ? "security_findings" : input.resource;
  const columns =
    input.resource === "requests"
      ? "id,model,decision,status,reason,prompt_preview,response_preview,created_at"
      : input.resource === "findings"
        ? "id,title,category,severity,status,remediation,created_at"
        : "id,name,description,action,conditions,version,status,created_at";
  const rows = await checked(
    db
      .from(table)
      .select(columns)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(input.limit),
  );
  await checked(
    db.from("audit_events").insert({
      org_id: orgId,
      actor_type: "agent",
      action: `agent.read_${input.resource}`,
      resource: table,
      result: "success",
      metadata: { agentId, count: rows.length },
    }),
  );
  return { status: "completed", reason: "Read completed.", output: JSON.stringify(rows) };
}
