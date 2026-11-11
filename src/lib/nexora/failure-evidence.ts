/** Explicit projection: never forward arbitrary reasons, previews, names or trace details to AI. */
const ACTIONS = new Set(["ALLOW", "LOG", "REDACT", "REQUIRE_APPROVAL", "BLOCK"]);
const FAILURES = new Set(["blocked", "provider_error", "response_blocked", "failed"]);
const SAFE_REASONS = [
  "An active subscription is required.",
  "Provider rejected the server credential.",
  "Requested model is unavailable upstream.",
  "Provider rate limit reached. Retry shortly.",
  "Provider is temporarily unavailable.",
  "Provider rejected the request.",
  "Provider request timed out after 30s.",
  "Provider request could not be completed.",
  "Prompt exceeds the gateway input limit.",
  "No active policy authorized this request; explicit policy coverage is required.",
  "Estimated request cost exceeds the administrator per-request ceiling.",
  "Model pricing is missing or invalid.",
  "Model is not registered in this organization's model registry.",
  "Model or provider is not in an active state.",
  "Response redaction could not be performed; output withheld.",
  "Organization AI execution controls denied this request.",
];

export function isFailedRequest(status: unknown) {
  return typeof status === "string" && FAILURES.has(status);
}

function safeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Only exact fixed classifications, or the pipeline's fixed provider suffix.
  return SAFE_REASONS.find((reason) => value === reason || value.endsWith(` · provider request failed: ${reason}`)) ?? null;
}

export type EvidenceRow = Record<string, unknown>;
export function buildFailureEvidence(row: EvidenceRow, events: EvidenceRow[] = []) {
  const evidence: string[] = [];
  if (isFailedRequest(row.status)) evidence.push(`Recorded request status: ${row.status}`);
  if (typeof row.decision === "string" && ACTIONS.has(row.decision)) evidence.push(`Recorded decision: ${row.decision}`);
  if (Number.isInteger(row.policy_version)) evidence.push(`Recorded policy version: ${row.policy_version}`);
  const reason = safeReason(row.reason);
  evidence.push(reason ? `Recorded sanitized reason: ${reason}` : "No allowlisted failure reason recorded; details withheld.");
  if (Array.isArray(row.matched_rules)) {
    for (const rule of row.matched_rules.slice(0, 20)) {
      if (rule && typeof rule === "object" && ACTIONS.has(rule.action) && Number.isInteger(rule.policyVersion)) {
        evidence.push(`Matched policy version ${rule.policyVersion}: ${rule.action}`);
      }
    }
  }
  const stages = new Set(["identity", "permissions", "pii", "injection", "budget", "provider_selection", "tool_authorization", "execution", "audit"]);
  const statuses = new Set(["passed", "blocked", "redacted", "failed", "completed", "not_applicable"]);
  for (const event of events.slice(0, 30)) {
    if (typeof event.stage !== "string" || !stages.has(event.stage) || typeof event.status !== "string" || !statuses.has(event.status)) continue;
    evidence.push(`Linked trace: ${event.stage} / ${event.status}`);
    const detail = event.detail && typeof event.detail === "object" ? event.detail as EvidenceRow : {};
    const classified = safeReason(detail.providerFailureReason);
    if (classified) evidence.push(`Trace classified provider reason: ${classified}`);
    if (typeof detail.providerStatus === "number" && Number.isInteger(detail.providerStatus) && detail.providerStatus >= 100 && detail.providerStatus <= 599) {
      evidence.push(`Trace classified provider status: ${detail.providerStatus} (adapter status, not necessarily upstream HTTP status)`);
    }
  }
  if (!events.length) evidence.push("No request-linked execution trace recorded; downstream invocation cannot be established.");
  return evidence;
}

/** Authorization and request eligibility precede any billable summarization. */
export async function authorizeFailureSummary(
  row: EvidenceRow | null,
  memberships: { org_id: string; role: string }[],
  summarize: (row: EvidenceRow) => Promise<unknown>,
) {
  if (!row || !memberships.some((m) => m.org_id === row.org_id && ["platform_admin", "org_admin", "governance_admin", "security_admin"].includes(m.role))) {
    throw new Error("An administrator in this request's organization is required.");
  }
  if (!isFailedRequest(row.status)) throw new Error("Only failed or blocked requests can be summarized.");
  return summarize(row);
}