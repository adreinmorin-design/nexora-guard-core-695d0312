import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inspect, redact } from "./dlp";
import {
  computeGovernanceEventHash,
  hashGovernanceContext,
  type GovernanceHashInput,
} from "./audit-integrity";
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

  let recentQuery = admin
    .from("intents")
    .select("id,status,objective_summary")
    .eq("org_id", input.orgId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (input.actorId) recentQuery = recentQuery.eq("created_by_actor_id", input.actorId);
  if (input.applicationId) recentQuery = recentQuery.eq("application_id", input.applicationId);
  const recent = await checked<any[]>(recentQuery);

  let best: any = null;
  let confidence = 0;
  for (const candidate of recent ?? []) {
    if (typeof candidate.objective_summary !== "string") continue;
    const score = lexicalSimilarity(normalized, candidate.objective_summary);
    if (score > confidence) {
      confidence = score;
      best = candidate;
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
        evidence: {
          method: "deterministic_lexical_jaccard",
          same_actor: Boolean(input.actorId),
          same_application: Boolean(input.applicationId),
        },
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
      .eq("id", input.executionId),
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
