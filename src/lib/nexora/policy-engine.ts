/**
 * NEXORA Policy — deterministic governance engine.
 *
 * No model output is ever consulted here. Given a context and the tenant's
 * active policies, evaluation is pure, ordered and fully explainable.
 */

import type { Detection } from "./dlp";

export type GovAction = "ALLOW" | "LOG" | "REDACT" | "REQUIRE_APPROVAL" | "BLOCK";

export type PolicyCondition = {
  field:
    | "detection_category"
    | "detection_severity"
    | "model_key"
    | "model_classification"
    | "provider"
    | "estimated_cost_usd"
    | "monthly_spend_usd"
    | "actor_type";
  op: "in" | "equals" | "not_equals" | "gt" | "lt";
  value: string | number | string[];
};

export type PolicyRecord = {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  action: GovAction;
  version: number;
  status: string;
  scope: string;
  conditions: PolicyCondition[];
};

export type EvaluationContext = {
  detections: Detection[];
  modelKey: string;
  modelClassification: string;
  provider: string;
  estimatedCostUsd: number;
  monthlySpendUsd: number;
  actorType: string;
  stage: "request" | "response";
};

export type MatchedRule = {
  policyId: string;
  policyName: string;
  policyVersion: number;
  priority: number;
  action: GovAction;
  matched: string[];
};

export type Decision = {
  action: GovAction;
  reason: string;
  policyId: string | null;
  policyName: string | null;
  policyVersion: number | null;
  matchedRules: MatchedRule[];
};

/** Deterministic precedence. Never negotiable, never model-decided. */
const PRECEDENCE: Record<GovAction, number> = {
  BLOCK: 5,
  REQUIRE_APPROVAL: 4,
  REDACT: 3,
  LOG: 2,
  ALLOW: 1,
};

function asArray(value: PolicyCondition["value"]): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function contextValues(field: PolicyCondition["field"], ctx: EvaluationContext): string[] {
  switch (field) {
    case "detection_category":
      return ctx.detections.map((d) => d.category);
    case "detection_severity":
      return ctx.detections.map((d) => d.severity);
    case "model_key":
      return [ctx.modelKey];
    case "model_classification":
      return [ctx.modelClassification];
    case "provider":
      return [ctx.provider];
    case "actor_type":
      return [ctx.actorType];
    case "estimated_cost_usd":
      return [String(ctx.estimatedCostUsd)];
    case "monthly_spend_usd":
      return [String(ctx.monthlySpendUsd)];
    default:
      return [];
  }
}

function evaluateCondition(
  condition: PolicyCondition,
  ctx: EvaluationContext,
): { matched: boolean; evidence: string } {
  const values = contextValues(condition.field, ctx);
  const expected = asArray(condition.value);

  switch (condition.op) {
    case "in": {
      const hit = values.find((v) => expected.includes(v));
      return { matched: Boolean(hit), evidence: hit ? `${condition.field}=${hit}` : "" };
    }
    case "equals": {
      const hit = values.find((v) => v === expected[0]);
      return { matched: Boolean(hit), evidence: hit ? `${condition.field}=${hit}` : "" };
    }
    case "not_equals": {
      const matched = values.length > 0 && values.every((v) => v !== expected[0]);
      return { matched, evidence: matched ? `${condition.field}!=${expected[0]}` : "" };
    }
    case "gt": {
      const numeric = Number(values[0] ?? 0);
      const matched = numeric > Number(expected[0]);
      return { matched, evidence: matched ? `${condition.field}=${numeric} > ${expected[0]}` : "" };
    }
    case "lt": {
      const numeric = Number(values[0] ?? 0);
      const matched = numeric < Number(expected[0]);
      return { matched, evidence: matched ? `${condition.field}=${numeric} < ${expected[0]}` : "" };
    }
    default:
      return { matched: false, evidence: "" };
  }
}

export function evaluate(policies: PolicyRecord[], ctx: EvaluationContext): Decision {
  const matchedRules: MatchedRule[] = [];
  const fields = [
    "detection_category",
    "detection_severity",
    "model_key",
    "model_classification",
    "provider",
    "estimated_cost_usd",
    "monthly_spend_usd",
    "actor_type",
  ];
  for (const p of policies.filter((p) => p.status === "active")) {
    if (
      !(p.action in PRECEDENCE) ||
      !Array.isArray(p.conditions) ||
      p.conditions.some(
        (c) =>
          !fields.includes(c.field) || !["in", "equals", "not_equals", "gt", "lt"].includes(c.op),
      )
    ) {
      throw new Error("Invalid active policy; refusing execution.");
    }
  }

  const ordered = [...policies]
    .filter((p) => p.status === "active")
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  for (const policy of ordered) {
    const conditions = Array.isArray(policy.conditions) ? policy.conditions : [];
    // An empty condition set is an unconditional policy (baseline logging).
    const results = conditions.map((c) => evaluateCondition(c, ctx));
    const allMatched = results.length === 0 || results.every((r) => r.matched);
    if (!allMatched) continue;

    matchedRules.push({
      policyId: policy.id,
      policyName: policy.name,
      policyVersion: policy.version,
      priority: policy.priority,
      action: policy.action,
      matched: results.map((r) => r.evidence).filter(Boolean),
    });
  }

  if (matchedRules.length === 0) {
    return {
      action: "ALLOW",
      reason: "No policy matched this request.",
      policyId: null,
      policyName: null,
      policyVersion: null,
      matchedRules: [],
    };
  }

  const governing = [...matchedRules].sort(
    (a, b) => PRECEDENCE[b.action] - PRECEDENCE[a.action] || a.priority - b.priority,
  )[0]!;

  const evidence = governing.matched.length ? ` (${governing.matched.join(", ")})` : "";

  return {
    action: governing.action,
    reason: `${governing.policyName} v${governing.policyVersion} → ${governing.action}${evidence}`,
    policyId: governing.policyId,
    policyName: governing.policyName,
    policyVersion: governing.policyVersion,
    matchedRules,
  };
}

export const PRECEDENCE_ORDER: GovAction[] = [
  "BLOCK",
  "REQUIRE_APPROVAL",
  "REDACT",
  "LOG",
  "ALLOW",
];
