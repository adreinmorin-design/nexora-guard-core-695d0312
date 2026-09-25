import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeProviderRequest, providerReadiness } from "../ai-gateway.server";
import { runGovernedRequest, type GatewayStore } from "./pipeline";
import type { PolicyRecord } from "./policy-engine";
import { requireOrgEntitlement } from "./entitlements.server";
import { requireAiExecutionAllowed } from "./ai-controls.server";
import { writeExecutionEvent } from "./execution-trace.server";
import {
  appendGovernanceDecision,
  createGovernedExecution,
  finalizeGovernedExecution,
  resolveIntent,
} from "./governance-runtime.server";
import {
  executionOutcomeForLegacyResult,
  legacyActionToPolicyOutcome,
  type GovernanceIdentity,
} from "./governance-types";

// Every query is checked. Supabase returns errors as values, not exceptions.
export async function checked(query: PromiseLike<any>): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error("Gateway persistence unavailable; request stopped.");
  return data;
}

export function makeStore(context: any, orgId: string): GatewayStore {
  const db = context.supabase;
  const admin: any = supabaseAdmin;
  const scoped = (id: string) => {
    if (id !== orgId) throw new Error("Invalid workspace.");
  };
  return {
    async getModel(id, key) {
      scoped(id);
      const row = await checked(
        db.from("models").select("*").eq("org_id", id).eq("model_key", key).maybeSingle(),
      );
      if (!row) return null;
      const provider = await checked(
        db
          .from("providers")
          .select("vendor, status, org_id")
          .eq("org_id", id)
          .eq("id", row.provider_id)
          .maybeSingle(),
      );
      if (!provider || provider.org_id !== id) throw new Error("Invalid provider workspace.");
      return {
        ...row,
        provider_vendor: provider.vendor,
        provider_status: provider.status,
        provider_credential_state: providerReadiness(provider.vendor),
      };
    },
    async monthlySpend(id) {
      scoped(id);
      return Number(await checked(admin.rpc("nexora_monthly_spend", { p_org: id })));
    },
    async listPolicies(id) {
      scoped(id);
      return checked(
        db
          .from("policies")
          .select("id, name, description, priority, action, version, status, scope, conditions")
          .eq("org_id", id)
          .order("id"),
      );
    },
    async listBudgets(id) {
      scoped(id);
      return checked(db.from("budgets").select("*").eq("org_id", id).eq("status", "active"));
    },
    async findRequestByIdempotencyKey(id, key) {
      scoped(id);
      return checked(
        db.from("requests").select("id").eq("org_id", id).eq("idempotency_key", key).maybeSingle(),
      );
    },
    async insertRequest(row) {
      scoped(String(row["org_id"]));
      return checked(admin.from("requests").insert(row).select("id").single());
    },
    async insertFindings(rows) {
      rows.forEach((r) => scoped(String(r["org_id"])));
      await checked(admin.from("security_findings").insert(rows));
    },
    async insertApproval(row) {
      scoped(String(row["org_id"]));
      await requireOrgEntitlement(orgId, "human_approvals");
      return checked(admin.from("approvals").insert(row).select("id").single());
    },
    async insertAudit(row) {
      scoped(String(row["org_id"]));
      await checked(admin.from("audit_events").insert(row));
    },
    async reserve(id, key, cost) {
      scoped(id);
      return checked(
        admin.rpc("nexora_reserve", {
          p_org: id,
          p_key: key,
          p_cost: cost,
        }),
      );
    },
    async settle(id, key) {
      scoped(id);
      await checked(admin.rpc("nexora_settle", { p_org: id, p_key: key }));
    },
  };
}

export async function runConsoleRequest(
  context: any,
  orgId: string,
  input: { prompt: string; modelKey: string; idempotencyKey?: string },
  approvedPolicies?: PolicyRecord[],
) {
  const identity: GovernanceIdentity = {
    actorId: context.userId,
    actorType: "user",
    agentId: null,
    applicationId: "console",
    organizationId: orgId,
  };

  const intent = await resolveIntent({
    orgId,
    actorId: context.userId,
    applicationId: "console",
    objective: input.prompt,
  });
  const governed = await createGovernedExecution({ orgId, intentId: intent.id, identity });

  const recordDecision = (event: Parameters<typeof appendGovernanceDecision>[0] extends never ? never : any) =>
    appendGovernanceDecision({
      orgId,
      executionId: governed.executionId,
      intentId: intent.id,
      traceId: governed.traceId,
      identity,
      ...event,
    });

  if (intent.status === "quarantined") {
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "QUARANTINE",
      reason: intent.inheritedQuarantine
        ? "Execution denied because this intent inherited quarantine from a high-confidence ancestor."
        : "Execution denied because this intent is quarantined.",
      policyId: null,
      policyVersion: null,
      ruleId: null,
      evaluatedContext: {
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
    controls = await requireAiExecutionAllowed(orgId, "user");
  } catch {
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "DENY_EXECUTION",
      reason: "Organization AI execution controls denied this request.",
      policyId: null,
      policyVersion: null,
      ruleId: "org_ai_controls",
      evaluatedContext: { actorType: "user", applicationId: "console" },
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

  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    actorType: "user",
    stage: "identity",
    status: "passed",
    summary: "Authenticated user identity resolved to organization membership.",
  });
  const memberships = await checked(
    context.supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", context.userId),
  );
  const authorized = memberships.some((m: any) =>
    [
      "platform_admin",
      "org_admin",
      "governance_admin",
      "security_admin",
      "developer",
      "agent_admin",
    ].includes(m.role),
  );
  if (!authorized) {
    await writeExecutionEvent({
      orgId,
      executionId: governed.executionId,
      actorType: "user",
      stage: "permissions",
      status: "blocked",
      summary: "User role cannot execute governed AI requests.",
    });
    await recordDecision({
      enforcementPoint: "PRE_EXECUTION",
      decision: "DENY_EXECUTION",
      reason: "User role is not authorized for governed AI execution.",
      policyId: null,
      policyVersion: null,
      ruleId: "runtime_role_authorization",
      evaluatedContext: { actorType: "user", roles: memberships.map((m: any) => m.role) },
      attributes: {},
    });
    await finalizeGovernedExecution({
      orgId,
      executionId: governed.executionId,
      workflowOutcome: "DENIED_BEFORE_EXECUTION",
      governanceOutcome: "DENY_EXECUTION",
    });
    throw new Error("This role cannot execute gateway requests.");
  }

  await writeExecutionEvent({
    orgId,
    executionId: governed.executionId,
    actorType: "user",
    stage: "permissions",
    status: "passed",
    summary: "User role is authorized for governed AI execution.",
  });
  await recordDecision({
    enforcementPoint: "PRE_EXECUTION",
    decision: "ALLOW",
    reason: "Identity, organization controls, and runtime role authorization passed.",
    policyId: null,
    policyVersion: null,
    ruleId: "runtime_pre_execution",
    evaluatedContext: {
      actorType: "user",
      applicationId: "console",
      intentStatus: intent.status,
      roles: memberships.map((m: any) => m.role),
    },
    attributes: {},
  });

  try {
    const outcome = await runGovernedRequest({
      store: makeStore(context, orgId),
      principal: { kind: "user", id: context.userId, orgId, source: "console" },
      ...input,
      ...(approvedPolicies ? { approvedPolicies } : {}),
      maxRequestCostUsd: controls.max_request_cost_usd,
      governedContext: { intentId: intent.id, executionId: governed.executionId },
      governanceDecision: (event) => recordDecision(event),
      trace: (event) =>
        writeExecutionEvent({
          orgId,
          executionId: governed.executionId,
          actorType: "user",
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

export async function decideAndExecute(
  context: any,
  orgId: string,
  id: string,
  decision: "approved" | "rejected",
) {
  await requireOrgEntitlement(orgId, "human_approvals");
  // RPC atomically checks role, requester, expiry and current status.
  const admin: any = supabaseAdmin;
  const approval = await checked(
    admin.rpc("nexora_decide_approval", {
      p_org: orgId,
      p_id: id,
      p_actor: context.userId,
      p_decision: decision,
    }),
  );
  if (decision === "rejected") return { ok: true };
  const payload = approval.payload;
  if (approval.action === "mcp.execute") {
    const { executeApprovedTool } = await import("./mcp.server");
    try {
      const outcome = await executeApprovedTool(orgId, id, payload);
      await checked(
        admin
          .from("approvals")
          .update({ execution_result: outcome.status })
          .eq("org_id", orgId)
          .eq("id", id),
      );
      return { ok: true, outcome };
    } catch {
      await checked(
        admin
          .from("approvals")
          .update({ execution_result: "failed_no_retry" })
          .eq("org_id", orgId)
          .eq("id", id),
      );
      throw new Error("Approved tool execution failed; inspect its task record before retrying.");
    }
  }
  if (
    typeof payload?.prompt !== "string" ||
    !payload.prompt.length ||
    payload.prompt.length > 20000 ||
    typeof payload?.modelKey !== "string" ||
    !Array.isArray(payload?.policies)
  ) {
    await checked(
      admin
        .from("approvals")
        .update({ execution_result: "resubmit_required" })
        .eq("id", id)
        .eq("org_id", orgId),
    );
    throw new Error("Legacy approval has no executable payload. Submit a new request.");
  }
  try {
    // Policies are reloaded; only unchanged approval policies may be satisfied.
    // Budget admission and response policies are never waived by approval.
    const input = {
      prompt: payload.prompt,
      modelKey: payload.modelKey,
      idempotencyKey: id,
    };
    const outcome = payload.agentId
      ? await (
          await import("./agents.server")
        ).executeAgentModel(orgId, payload.agentId, input, payload.policies)
      : await runConsoleRequest(
          { supabase: admin, userId: approval.requester_id },
          orgId,
          input,
          payload.policies,
        );
    await checked(
      admin
        .from("approvals")
        .update({ execution_result: outcome.status })
        .eq("org_id", orgId)
        .eq("id", id),
    );
    return { ok: true, outcome };
  } catch {
    await checked(
      admin
        .from("approvals")
        .update({ execution_result: "failed_no_retry" })
        .eq("org_id", orgId)
        .eq("id", id),
    );
    throw new Error("Approved execution failed. Inspect request status before submitting again.");
  }
}
