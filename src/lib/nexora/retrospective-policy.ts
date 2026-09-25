import { evaluate, type PolicyRecord } from "./policy-engine";

export type HistoricalPolicyContext = {
  detectionCategories: Array<{ category: string; severity: string }>;
  modelKey: string;
  modelClassification: string;
  provider: string;
  estimatedCostUsd: number;
  monthlySpendUsd: number;
  actorType: string;
  stage: "request" | "response";
};

export type RetrospectiveEvaluation = {
  originalPolicyId: string | null;
  originalPolicyVersion: number | null;
  originalDecision: string;
  currentPolicyId: string | null;
  currentPolicyVersion: number | null;
  currentDecision: string;
  disposition: "UNCHANGED" | "WOULD_BLOCK" | "WOULD_REQUIRE_APPROVAL" | "WOULD_TRANSFORM";
  reason: string;
};

export function evaluateHistoricalContext(
  currentPolicies: PolicyRecord[],
  historical: HistoricalPolicyContext,
  original: {
    policyId: string | null;
    policyVersion: number | null;
    decision: string;
  },
): RetrospectiveEvaluation {
  const detections = historical.detectionCategories.map((entry) => ({
    category: entry.category,
    severity: entry.severity,
    label: entry.category,
    confidence: 1,
    source: "retrospective_context",
    start: 0,
    end: 0,
  }));

  const current = evaluate(currentPolicies, {
    detections,
    modelKey: historical.modelKey,
    modelClassification: historical.modelClassification,
    provider: historical.provider,
    estimatedCostUsd: historical.estimatedCostUsd,
    monthlySpendUsd: historical.monthlySpendUsd,
    actorType: historical.actorType,
    stage: historical.stage,
  });

  let disposition: RetrospectiveEvaluation["disposition"] = "UNCHANGED";
  if (["BLOCK"].includes(current.action) && original.decision !== "BLOCK") {
    disposition = "WOULD_BLOCK";
  } else if (current.action === "REQUIRE_APPROVAL" && original.decision !== "REQUIRE_APPROVAL") {
    disposition = "WOULD_REQUIRE_APPROVAL";
  } else if (current.action === "REDACT" && original.decision !== "REDACT") {
    disposition = "WOULD_TRANSFORM";
  }

  return {
    originalPolicyId: original.policyId,
    originalPolicyVersion: original.policyVersion,
    originalDecision: original.decision,
    currentPolicyId: current.policyId,
    currentPolicyVersion: current.policyVersion,
    currentDecision: current.action,
    disposition,
    reason: current.reason,
  };
}
