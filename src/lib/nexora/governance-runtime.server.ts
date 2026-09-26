import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inspect, redact } from "./dlp";
import {
  computeGovernanceEventHash,
  hashGovernanceContext,
  type GovernanceHashInput,
} from "./audit-integrity";
import type { GovernanceDecisionEvent } from "./pipeline";
import type {
  EnforcementPoint,
  ExecutionOutcome,
  GovernanceIdentity,
  PolicyOutcome,
} from "./governance-types";

const admin: any = supabaseAdmin;
export const DECISION_ENGINE_VERSION = "nexora-policy/2";

async function checked<T = any>(query: PromiseLike<any>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error("Governance persistence unavailable; execution stopped.");
  return data as T;
}

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newTraceId(): string {
  return randomHex(16);
}

export function newSpanId(): string {
  return randomHex(8);
}

function normalizeObjective(value: string): string {
  return redact(value, inspect(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s_.:/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeObjective(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3)
      .slice(0, 256),
  );
}

function lexicalSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

export type ResolvedIntent = {
  id: string;
  status: "active" | "flagged" | "quarantined" | "cleared";
  inheritedQuarantine: boolean;
  lineageConfidence: number | null;
};

export async function resolveIntent(input: {
  orgId: string;
  actorId: string | null;
  applicationId: string | null;
  objective: string;
  context?: {
    sessionLineage?: string | null;
    requestedAction?: string | null;
    resource?: string | null;
    destination?: string | null;
    dataClassification?: string | null;
  };
}): Promise<ResolvedIntent> {
  const normalized = normalizeObjective(input.objective);
  const fingerprint = await hashGovernanceContext({ objective: normalized });
  const exact = await checked<any>(
    admin
      .from("intents")
      .select("id,status")
      .eq("org_id", input.orgId)
      .eq("objective_fingerprint", fingerprint)
      .in("status", ["active", "flagged", "quarantined"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (exact) {
    return {
      id: exact.id,
      status: exact.status,
      inheritedQuarantine: false,
      lineageConfidence: 1,
    };
  }

  const recent = await checked<any[]>(
    admin
      .from("intents")
      .select(
        "id,status,objective_summary,created_by_actor_id,application_id,lineage_context",
      )
      .eq("org_id", input.orgId)
      .order("created_at", { ascending: false })
      .limit(100),
  );

  let best: any = null;
  let confidence = 0;
  let bestEvidence: Record<string, unknown> = {};
  for (const candidate of recent ?? []) {
    if (typeof candidate.objective_summary !== "string") continue;
    const lexical = lexicalSimilarity(normalized, candidate.objective_summary);
    const candidateContext = (candidate.lineage_context ?? {}) as Record<string, unknown>;
    const sameActor = Boolean(
      input.actorId && candidate.created_by_actor_id === input.actorId,
    );
    const sameApplication = Boolean(
      input.applicationId && candidate.application_id === input.applicationId,
    );
    const sameSession = Boolean(
      input.context?.sessionLineage &&
        candidateContext["sessionLineage"] === input.context.sessionLineage,
    );
    const actionMatch = Boolean(
      input.context?.requestedAction &&
        candidateContext["requestedAction"] === input.context.requestedAction,
    );
    const resourceMatch = Boolean(
      input.context?.resource && candidateContext["resource"] === input.context.resource,
    );
    const destinationMatch = Boolean(
      input.context?.destination &&
        candidateContext["destination"] === input.context.destination,
    );
    const classificationMatch = Boolean(
      input.context?.dataClassification &&
        candidateContext["dataClassification"] === input.context.dataClassification,
    );
    const score = Math.min(
      1,
      lexical +
        (sameActor ? 0.04 : 0) +
        (sameApplication ? 0.03 : 0) +
        (sameSession ? 0.08 : 0) +
        (actionMatch ? 0.03 : 0) +
        (resourceMatch ? 0.03 : 0) +
        (destinationMatch ? 0.03 : 0) +
        (classificationMatch ? 0.03 : 0),
    );
    if (score > confidence) {
      confidence = score;
      best = candidate;
      bestEvidence = {
        method: "deterministic_lexical_context_v1",
        lexicalSimilarity: lexical,
        sameActor,
        sameApplication,
        sameSession,
        actionMatch,
        resourceMatch,
        destinationMatch,
        classificationMatch,
      };
    }
  }

  // Very high-confidence lexical equivalence reuses the durable intent.
  if (best && confidence >= 0.9) {
    return {
      id: best.id,
      status: best.status,
      inheritedQuarantine: false,
      lineageConfidence: confidence,
    };
  }

  const inheritsQuarantine = Boolean(best && confidence >= 0.82 && best.status === "quarantined");
  const created = await checked<any>(
    admin
      .from("intents")
      .insert({
        org_id: input.orgId,
        created_by_actor_id: input.actorId,
        application_id: input.applicationId,
        objective_fingerprint: fingerprint,
        objective_summary: normalized.slice(0, 500),
        lineage_context: {
          sessionLineage: input.context?.sessionLineage ?? null,
          requestedAction: input.context?.requestedAction ?? null,
          resource: input.context?.resource ?? null,
          destination: input.context?.destination ?? null,
          dataClassification: input.context?.dataClassification ?? null,
        },
        status: inheritsQuarantine ? "quarantined" : "active",
        ...(inheritsQuarantine
          ? {
              quarantine_reason: "High-confidence descendant of a quarantined intent.",
              quarantined_at: new Date().toISOString(),
            }
          : {}),
      })
      .select("id,status")
      .single(),
  );

  if (best && confidence >= 0.72) {
    await checked(
      admin.from("intent_lineage_events").insert({
        org_id: input.orgId,
        parent_intent_id: best.id,
        child_intent_id: created.id,
        event_type: inheritsQuarantine ? "INHERITED_QUARANTINE" : "LINKED",
        confidence,
        reason: inheritsQuarantine
          ? "Objective similarity inherited quarantine from parent intent."
          : "Objective similarity created durable intent lineage.",
        evidence: bestEvidence,
        actor_id: input.actorId,
      }),
    );
  }

  return {
    id: created.id,
    status: created.status,
    inheritedQuarantine: inheritsQuarantine,
    lineageConfidence: best ? confidence : null,
  };
}

export async function loadIntentForExecution(
  orgId: string,
  intentId: string,
): Promise<ResolvedIntent> {
  const row = await checked<any>(
    admin.from("intents").select("id,status").eq("org_id", orgId).eq("id", intentId).maybeSingle(),
  );
  if (!row) throw new Error("Approved intent is unavailable in this organization.");
  return {
    id: row.id,
    status: row.status,
    inheritedQuarantine: false,
    lineageConfidence: null,
  };
}

export async function createGovernedExecution(input: {
  orgId: string;
  intentId: string;
  identity: GovernanceIdentity;
}): Promise<{ executionId: string; traceId: string }> {
  const traceId = newTraceId();
  const row = await checked<any>(
    admin
      .from("governed_executions")
      .insert({
        org_id: input.orgId,
        intent_id: input.intentId,
        trace_id: traceId,
        actor_id: input.identity.actorId,
        actor_type: input.identity.actorType,
        agent_id: input.identity.agentId,
        application_id: input.identity.applicationId,
      })
      .select("id")
      .single(),
  );
  return { executionId: row.id, traceId };
}

export async function finalizeGovernedExecution(input: {
  orgId: string;
  executionId: string;
  workflowOutcome: ExecutionOutcome;
  governanceOutcome: PolicyOutcome | null;
}): Promise<void> {
  await checked(
    admin
      .from("governed_executions")
      .update({
        workflow_outcome: input.workflowOutcome,
        governance_outcome: input.governanceOutcome,
        finalized_at: new Date().toISOString(),
      })
      .eq("org_id", input.orgId)
      .eq("id", input.executionId)
      .is("finalized_at", null),
  );
}

export async function appendGovernanceDecision(input: {
  orgId: string;
  executionId: string;
  intentId: string;
  traceId: string;
  parentEventId?: string | null;
  parentSpanId?: string | null;
  identity: GovernanceIdentity;
  policyId?: string | null;
  policyVersion?: number | null;
  ruleId?: string | null;
  enforcementPoint: EnforcementPoint;
  decision: PolicyOutcome;
  reason: string;
  evaluatedContext: unknown;
  attributes?: Record<string, unknown>;
}): Promise<{ eventId: string; spanId: string; eventHash: string; chainPosition: number }> {
  const eventId = crypto.randomUUID();
  const spanId = newSpanId();
  const timestamp = new Date().toISOString();
  const evaluatedContextHash = await hashGovernanceContext(input.evaluatedContext);

  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await checked<any>(
      admin
        .from("governance_audit_heads")
        .select("chain_position,event_hash")
        .eq("org_id", input.orgId)
        .maybeSingle(),
    );
    const chainPosition = Number(head?.chain_position ?? 0) + 1;
    const previousEventHash = head?.event_hash ?? null;
    const hashInput: GovernanceHashInput = {
      previousEventHash,
      chainPosition,
      eventId,
      traceId: input.traceId,
      executionId: input.executionId,
      intentId: input.intentId,
      parentEventId: input.parentEventId ?? null,
      actorId: input.identity.actorId,
      agentId: input.identity.agentId,
      organizationId: input.orgId,
      applicationId: input.identity.applicationId,
      policyId: input.policyId ?? null,
      policyVersion: input.policyVersion ?? null,
      ruleId: input.ruleId ?? null,
      decision: input.decision,
      reason: input.reason,
      evaluatedContextHash,
      timestamp,
      decisionEngineVersion: DECISION_ENGINE_VERSION,
      enforcementPoint: input.enforcementPoint,
      attributes: input.attributes ?? {},
    };
    const eventHash = await computeGovernanceEventHash(hashInput);
    const { data, error } = await admin.rpc("nexora_append_governance_event", {
      p_org: input.orgId,
      p_event_id: eventId,
      p_trace_id: input.traceId,
      p_span_id: spanId,
      p_parent_span_id: input.parentSpanId ?? null,
      p_execution_id: input.executionId,
      p_intent_id: input.intentId,
      p_parent_event_id: input.parentEventId ?? null,
      p_actor_id: input.identity.actorId,
      p_agent_id: input.identity.agentId,
      p_application_id: input.identity.applicationId,
      p_policy_id: input.policyId ?? null,
      p_policy_version: input.policyVersion ?? null,
      p_rule_id: input.ruleId ?? null,
      p_enforcement_point: input.enforcementPoint,
      p_decision: input.decision,
      p_reason: input.reason,
      p_evaluated_context_hash: evaluatedContextHash,
      p_event_timestamp: timestamp,
      p_decision_engine_version: DECISION_ENGINE_VERSION,
      p_attributes: input.attributes ?? {},
      p_expected_previous_hash: previousEventHash,
      p_event_hash: eventHash,
    });
    if (!error) {
      return { eventId, spanId, eventHash, chainPosition: Number(data) };
    }
    if (!String(error.message ?? "").includes("chain head changed") || attempt === 2) {
      throw new Error("Governance evidence persistence unavailable; execution stopped.");
    }
  }
  throw new Error("Governance evidence persistence unavailable; execution stopped.");
}

export async function recordExecutionRisk(input: {
  orgId: string;
  executionId: string;
  intentId: string;
  policyId: string | null;
  policyVersion: number | null;
  severity: "info" | "low" | "medium" | "high" | "critical";
  score: number;
  evasionIndicator?: string | null;
}): Promise<{
  terminated: boolean;
  intentQuarantined: boolean;
  executionRiskScore: number;
  intentRiskScore: number;
  executionViolationCount: number;
  intentViolationCount: number;
  thresholdId: string | null;
}> {
  const result = await checked<any>(
    admin.rpc("nexora_record_execution_risk", {
      p_org: input.orgId,
      p_execution: input.executionId,
      p_intent: input.intentId,
      p_policy: input.policyId,
      p_policy_version: input.policyVersion,
      p_severity: input.severity,
      p_score: input.score,
      p_evasion_indicator: input.evasionIndicator ?? null,
    }),
  );
  return {
    terminated: Boolean(result.terminated),
    intentQuarantined: Boolean(result.intentQuarantined),
    executionRiskScore: Number(result.executionRiskScore),
    intentRiskScore: Number(result.intentRiskScore),
    executionViolationCount: Number(result.executionViolationCount),
    intentViolationCount: Number(result.intentViolationCount),
    thresholdId: result.thresholdId ?? null,
  };
}

export function createGovernanceDecisionRecorder(input: {
  orgId: string;
  intent: ResolvedIntent;
  executionId: string;
  traceId: string;
  identity: GovernanceIdentity;
}) {
  return async (
    event: GovernanceDecisionEvent,
  ): Promise<{
    eventId: string;
    spanId: string;
    eventHash: string;
    chainPosition: number;
    terminated: boolean;
  }> => {
    const evidence = await appendGovernanceDecision({
      orgId: input.orgId,
      executionId: input.executionId,
      intentId: input.intent.id,
      traceId: input.traceId,
      identity: input.identity,
      ...event,
    });

    if (!["DENY_ACTION", "DENY_EXECUTION", "QUARANTINE"].includes(event.decision)) {
      return { ...evidence, terminated: false };
    }

    const severities = (
      (event.attributes?.["policyContext"] as any)?.detectionCategories ?? []
    ).map((entry: any) => String(entry.severity));
    const severityOrder = ["info", "low", "medium", "high", "critical"];
    const severity =
      severities.sort(
        (a: string, b: string) => severityOrder.indexOf(b) - severityOrder.indexOf(a),
      )[0] ?? (event.decision === "QUARANTINE" ? "critical" : "high");
    const scoreBySeverity: Record<string, number> = {
      info: 1,
      low: 5,
      medium: 15,
      high: 35,
      critical: 75,
    };

    const risk = await recordExecutionRisk({
      orgId: input.orgId,
      executionId: input.executionId,
      intentId: input.intent.id,
      policyId: event.policyId,
      policyVersion: event.policyVersion,
      severity: severity as "info" | "low" | "medium" | "high" | "critical",
      score: scoreBySeverity[severity] ?? 35,
      evasionIndicator:
        input.intent.lineageConfidence != null && input.intent.lineageConfidence >= 0.72
          ? "repeated_or_lineage_related_denied_intent"
          : "policy_denial",
    });

    if (risk.terminated && event.decision !== "QUARANTINE") {
      await appendGovernanceDecision({
        orgId: input.orgId,
        executionId: input.executionId,
        intentId: input.intent.id,
        traceId: input.traceId,
        parentEventId: evidence.eventId,
        parentSpanId: evidence.spanId,
        identity: input.identity,
        enforcementPoint: event.enforcementPoint,
        decision: "QUARANTINE",
        reason: "Policy-defined accumulated risk threshold reached; execution terminated.",
        policyId: event.policyId,
        policyVersion: event.policyVersion,
        ruleId: event.ruleId,
        evaluatedContext: {
          thresholdId: risk.thresholdId,
          executionRiskScore: risk.executionRiskScore,
          intentRiskScore: risk.intentRiskScore,
          intentViolationCount: risk.intentViolationCount,
        },
        attributes: { thresholdId: risk.thresholdId },
      });
    }

    return { ...evidence, terminated: risk.terminated };
  };
}
