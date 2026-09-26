/**
 * Core Nexora governance domain vocabulary.
 *
 * These types deliberately separate policy decisions from workflow outcomes.
 * Legacy request-pipeline actions are mapped explicitly so older policy records
 * can coexist with the governed-execution runtime during migration.
 */

export type EnforcementPoint =
  | "PRE_EXECUTION"
  | "PRE_MODEL_INVOCATION"
  | "PRE_TOOL_INVOCATION"
  | "POST_TOOL_EXECUTION"
  | "PRE_RESPONSE";

export type PolicyOutcome =
  | "ALLOW"
  | "ALLOW_WITH_TRANSFORMATION"
  | "DENY_ACTION"
  | "DENY_EXECUTION"
  | "REQUIRE_APPROVAL"
  | "QUARANTINE";

export type ExecutionOutcome =
  | "COMPLETED"
  | "COMPLETED_WITH_POLICY_BLOCK"
  | "COMPLETED_WITH_REDACTION"
  | "DENIED_BEFORE_EXECUTION"
  | "FAILED_EXECUTION"
  | "CANCELLED"
  | "TERMINATED";

export type LegacyGovAction = "ALLOW" | "LOG" | "REDACT" | "REQUIRE_APPROVAL" | "BLOCK";

export type RiskSeverity = "info" | "low" | "medium" | "high" | "critical";

export type ExecutionRiskState = {
  violationCount: number;
  severity: RiskSeverity;
  dataClassification: string;
  toolSensitivity: string;
  destinationSensitivity: string;
  policyEvasionIndicators: string[];
  accumulatedRiskScore: number;
};

export type GovernanceIdentity = {
  actorId: string | null;
  actorType: "user" | "agent" | "service" | "application";
  agentId: string | null;
  applicationId: string | null;
  organizationId: string;
};

export type TraceIdentity = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  executionId: string;
  intentId: string;
};

export function newRiskState(): ExecutionRiskState {
  return {
    violationCount: 0,
    severity: "info",
    dataClassification: "unclassified",
    toolSensitivity: "none",
    destinationSensitivity: "internal",
    policyEvasionIndicators: [],
    accumulatedRiskScore: 0,
  };
}

export function legacyActionToPolicyOutcome(action: LegacyGovAction): PolicyOutcome {
  switch (action) {
    case "ALLOW":
    case "LOG":
      return "ALLOW";
    case "REDACT":
      return "ALLOW_WITH_TRANSFORMATION";
    case "REQUIRE_APPROVAL":
      return "REQUIRE_APPROVAL";
    case "BLOCK":
      return "DENY_EXECUTION";
  }
}

export function policyOutcomeAllowsDownstream(decision: PolicyOutcome): boolean {
  return decision === "ALLOW" || decision === "ALLOW_WITH_TRANSFORMATION";
}

export function executionOutcomeForLegacyResult(input: {
  action: LegacyGovAction;
  status: string;
  providerExecuted: boolean;
  redacted: boolean;
}): ExecutionOutcome {
  if (input.status === "cancelled") return "CANCELLED";
  if (input.status === "terminated") return "TERMINATED";
  if (input.status === "provider_error") return "FAILED_EXECUTION";
  if (!input.providerExecuted && input.action === "BLOCK") return "DENIED_BEFORE_EXECUTION";
  if (input.status === "response_blocked") return "COMPLETED_WITH_POLICY_BLOCK";
  if (input.redacted || input.action === "REDACT") return "COMPLETED_WITH_REDACTION";
  return "COMPLETED";
}
