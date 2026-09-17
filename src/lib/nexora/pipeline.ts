/**
 * NEXORA governed request pipeline.
 *
 * Pure with respect to infrastructure: it depends on a `GatewayStore` and an
 * injected provider executor, so every invariant below is directly testable.
 *
 * Order (fixed, server-side only):
 *   tenant-scoped model authorization
 *   -> DLP / secrets / injection inspection
 *   -> tenant policy evaluation (deterministic precedence)
 *   -> budget & quota evaluation
 *   -> ALLOW | LOG | REDACT | REQUIRE_APPROVAL | BLOCK
 *   -> provider execution (only when authorized)
 *   -> response inspection
 *   -> request + findings + audit persistence
 */

import { inspect, redact, maskPreview, type Detection } from "./dlp";
import { evaluate, type Decision, type GovAction, type PolicyRecord } from "./policy-engine";
import { executeUnderDecision } from "./enforcement";
import { MAX_OUTPUT_TOKENS, INPUT_OVERHEAD_TOKENS } from "./limits";

export type ProviderResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type ProviderExecutor = (modelKey: string, prompt: string) => Promise<ProviderResult>;

export type ModelRow = {
  model_key: string;
  display_name: string;
  classification: string;
  status: string;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  provider_vendor: string;
  provider_status: string;
  provider_credential_state: string;
};

export type BudgetRow = {
  name: string;
  limit_usd: number;
  action_on_exceed: GovAction;
  period: string;
};

export type Principal = {
  /** Agents authenticate with their own credential; they never assert their tenant. */
  kind: "user" | "agent";
  /** auth.users id for users, agents.id for agents. */
  id: string;
  orgId: string;
  source: "console" | "api" | "mcp";
  label?: string;
};

export type GatewayStore = {
  getModel(orgId: string, modelKey: string): Promise<ModelRow | null>;
  monthlySpend(orgId: string): Promise<number>;
  listPolicies(orgId: string): Promise<PolicyRecord[]>;
  listBudgets(orgId: string): Promise<BudgetRow[]>;
  findRequestByIdempotencyKey(orgId: string, key: string): Promise<{ id: string } | null>;
  insertRequest(row: Record<string, unknown>): Promise<{ id: string } | null>;
  insertFindings(rows: Array<Record<string, unknown>>): Promise<void>;
  insertApproval(row: Record<string, unknown>): Promise<{ id: string } | null>;
  insertAudit(row: Record<string, unknown>): Promise<void>;
  reserve(orgId: string, key: string, cost: number): Promise<{ admitted: boolean; reason: string }>;
  settle(orgId: string, key: string): Promise<void>;
};

export type GatewayOutcome = {
  decision: GovAction;
  reason: string;
  policy: { name: string; version: number | null } | null;
  matchedRules: Decision["matchedRules"];
  findings: Array<{
    category: string;
    label: string;
    severity: string;
    confidence: number;
    source: string;
  }>;
  output: string | null;
  status: string;
  approvalId: string | null;
  requestId: string | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; latency: number };
  replayed?: boolean;
};

const ORDER: GovAction[] = ["ALLOW", "LOG", "REDACT", "REQUIRE_APPROVAL", "BLOCK"];

// jsonb reorders object keys; compare canonical snapshots, not serialization order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0, latency: 0 };
}

export async function runGovernedRequest(params: {
  store: GatewayStore;
  principal: Principal;
  prompt: string;
  modelKey: string;
  execute: ProviderExecutor;
  idempotencyKey?: string | null;
  approvedPolicies?: PolicyRecord[];
}): Promise<GatewayOutcome> {
  const { store, principal, prompt, modelKey, execute } = params;
  const idempotencyKey = params.idempotencyKey ?? crypto.randomUUID();
  const startedAt = Date.now();
  const actorColumns =
    principal.kind === "agent"
      ? { user_id: null, agent_id: principal.id }
      : { user_id: principal.id, agent_id: null };

  const persist = async (values: Record<string, unknown>) =>
    store.insertRequest({
      org_id: principal.orgId,
      actor_type: principal.kind,
      source: principal.source,
      idempotency_key: idempotencyKey,
      ...actorColumns,
      ...values,
    });

  const audit = async (values: Record<string, unknown>) =>
    store.insertAudit({
      org_id: principal.orgId,
      actor_id: principal.kind === "user" ? principal.id : null,
      actor_type: principal.kind,
      source: principal.source,
      ...values,
    });

  // Replay protection: the same idempotency key never produces a second call.
  if (idempotencyKey) {
    const existing = await store.findRequestByIdempotencyKey(principal.orgId, idempotencyKey);
    if (existing) {
      return {
        decision: "BLOCK",
        reason: "Duplicate request: this idempotency key was already processed.",
        policy: null,
        matchedRules: [],
        findings: [],
        output: null,
        status: "duplicate",
        approvalId: null,
        requestId: existing.id,
        usage: emptyUsage(),
        replayed: true,
      };
    }
  }

  const failClosed = async (reason: string, risk: "high" | "medium" = "medium") => {
    const req = await persist({
      model: modelKey,
      provider: null,
      decision: "BLOCK",
      reason,
      prompt_preview: maskPreview(prompt, inspect(prompt), 200),
      latency_ms: Date.now() - startedAt,
      status: "blocked",
    });
    await audit({
      action: "gateway.request",
      resource: "model",
      resource_id: modelKey,
      decision: "BLOCK",
      request_id: req?.id ?? null,
      risk,
      result: "blocked",
    });
    return {
      decision: "BLOCK" as GovAction,
      reason,
      policy: null,
      matchedRules: [],
      findings: [],
      output: null,
      status: "blocked",
      approvalId: null,
      requestId: req?.id ?? null,
      usage: emptyUsage(),
    };
  };

  // 1. Model must be registered, active and configured inside this tenant.
  const model = await store.getModel(principal.orgId, modelKey);
  if (!model) {
    return failClosed("Model is not registered in this organization's model registry.", "high");
  }
  if (model.status !== "active" || model.provider_status !== "active") {
    return failClosed("Model or provider is not in an active state.");
  }
  if (model.provider_credential_state !== "CONFIGURED") {
    return failClosed(`Provider execution for ${model.provider_vendor} is NOT_CONFIGURED.`);
  }

  // 2. Deterministic inspection.
  const detections = inspect(prompt);

  // 3. Server-side cost context.
  const monthlySpend = await store.monthlySpend(principal.orgId);
  // UTF-8 bytes conservatively bound token count; include instructions/framing.
  const estTokens = new TextEncoder().encode(prompt).length + INPUT_OVERHEAD_TOKENS;
  const prices: [number, number] = [
    Number(model.input_cost_per_1k),
    Number(model.output_cost_per_1k),
  ];
  if (prices.some((p) => !Number.isFinite(p) || p <= 0)) {
    return failClosed("Model pricing is missing or invalid.");
  }
  const estimatedCost = (estTokens * prices[0] + MAX_OUTPUT_TOKENS * prices[1]) / 1000;

  // 4. Versioned, tenant-scoped policy evaluation.
  const policies = await store.listPolicies(principal.orgId);
  const requestPolicies = policies.map((p) =>
    p.action === "REQUIRE_APPROVAL" &&
    params.approvedPolicies?.some(
      (a) => a.id === p.id && a.version === p.version && canonical(a) === canonical(p),
    )
      ? { ...p, action: "LOG" as GovAction }
      : p,
  );
  const decision = evaluate(requestPolicies, {
    detections,
    modelKey,
    modelClassification: model.classification,
    provider: model.provider_vendor,
    estimatedCostUsd: estimatedCost,
    monthlySpendUsd: monthlySpend,
    actorType: principal.kind,
    stage: "request",
  });

  // 5. Budgets and quotas.
  let finalAction = decision.action;
  let finalReason = decision.reason;
  for (const b of await store.listBudgets(principal.orgId)) {
    // Authoritative, period-aware admission happens atomically in reserve().
    if (b.period !== "monthly") continue;
    if (monthlySpend + estimatedCost > Number(b.limit_usd)) {
      const action = b.action_on_exceed;
      if (ORDER.indexOf(action) > ORDER.indexOf(finalAction)) {
        finalAction = action;
        finalReason = `Budget "${b.name}" exceeded ($${monthlySpend.toFixed(4)} of $${Number(b.limit_usd).toFixed(2)}).`;
      }
    }
  }

  const findingsToWrite: Array<Record<string, unknown>> = detections.map((d) => ({
    severity: d.severity,
    category: d.category,
    title: `${d.label} detected in prompt`,
    detection_source: d.source,
    confidence: d.confidence,
    evidence: { offset: d.start, stage: "request" },
    affected_resource: modelKey,
    remediation: "Remove or tokenize the sensitive value before sending it to a model.",
  }));

  let output: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let latency = 0;
  let redactedFlag = false;
  let status = "completed";
  let approvalId: string | null = null;
  let responseDetections: Detection[] = [];
  let reserved = false;
  if (["ALLOW", "LOG", "REDACT"].includes(finalAction)) {
    const admission = await store.reserve(principal.orgId, idempotencyKey, estimatedCost);
    if (!admission.admitted) return failClosed(admission.reason);
    reserved = true;
    // An audit outage must prevent dispatch, not just hide it after the fact.
    await audit({
      action: "gateway.dispatch",
      resource: "model",
      resource_id: modelKey,
      decision: finalAction,
      result: "reserved",
      metadata: { idempotencyKey },
    });
  }

  if (finalAction === "BLOCK") status = "blocked";
  else if (finalAction === "REQUIRE_APPROVAL") status = "pending_approval";

  // 6. Execution gate. BLOCK / REQUIRE_APPROVAL structurally cannot reach the
  //    executor; REDACT can only forward the redacted string.
  try {
    const gate = await executeUnderDecision<ProviderResult>({
      action: finalAction,
      originalPrompt: prompt,
      redactedPrompt: redact(prompt, detections),
      execute: (outbound) => execute(modelKey, outbound),
    });

    if (gate.executed && gate.result) {
      redactedFlag = gate.redacted;
      const result = gate.result;
      inputTokens = result.inputTokens || estTokens;
      outputTokens = result.outputTokens || Math.ceil(result.text.length / 4);
      latency = result.latencyMs;
      costUsd =
        (inputTokens / 1000) * Number(model.input_cost_per_1k ?? 0) +
        (outputTokens / 1000) * Number(model.output_cost_per_1k ?? 0);

      // 7. Responses are governed too.
      responseDetections = inspect(result.text);
      const responseDecision = evaluate(policies, {
        detections: responseDetections,
        modelKey,
        modelClassification: model.classification,
        provider: model.provider_vendor,
        estimatedCostUsd: costUsd,
        monthlySpendUsd: monthlySpend + costUsd,
        actorType: principal.kind,
        stage: "response",
      });

      if (responseDecision.action === "BLOCK" || responseDecision.action === "REQUIRE_APPROVAL") {
        output = null;
        status = "response_blocked";
        finalAction = "BLOCK";
        finalReason = `Response withheld — ${responseDecision.reason}`;
      } else if (responseDecision.action === "REDACT" && responseDetections.length === 0) {
        output = null;
        status = "response_blocked";
        finalAction = "BLOCK";
        finalReason = "Response redaction could not be performed; output withheld.";
      } else if (responseDetections.length > 0) {
        output = redact(result.text, responseDetections);
        redactedFlag = true;
        if (finalAction === "ALLOW" || finalAction === "LOG") finalAction = "REDACT";
        finalReason = `${finalReason} · response redacted (${responseDetections.length} finding(s))`;
      } else {
        output = result.text;
      }

      for (const d of responseDetections) {
        findingsToWrite.push({
          severity: d.severity,
          category: d.category,
          title: `${d.label} detected in model response`,
          detection_source: d.source,
          confidence: d.confidence,
          evidence: { offset: d.start, stage: "response" },
          affected_resource: modelKey,
          remediation: "Investigate the source of the leaked value and tighten data access.",
        });
      }
    }
  } catch (error) {
    status = "provider_error";
    finalReason = `${finalReason} · provider request failed; details withheld`;
  }

  // 8. Persist request, findings, approval and the append-only audit event.
  const requestRow = await persist({
    model: modelKey,
    provider: model.provider_vendor,
    decision: finalAction,
    reason: finalReason,
    policy_id: decision.policyId,
    policy_version: decision.policyVersion,
    matched_rules: decision.matchedRules,
    redacted: redactedFlag,
    prompt_preview: maskPreview(prompt, detections, 300),
    response_preview: output ? output.slice(0, 300) : null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Number(costUsd.toFixed(6)),
    latency_ms: latency || Date.now() - startedAt,
    status,
  });

  if (findingsToWrite.length > 0) {
    await store.insertFindings(
      findingsToWrite.map((f) => ({
        ...f,
        org_id: principal.orgId,
        request_id: requestRow?.id ?? null,
      })),
    );
  }

  if (finalAction === "REQUIRE_APPROVAL" && principal.kind === "user") {
    const approval = await store.insertApproval({
      org_id: principal.orgId,
      request_id: requestRow?.id ?? null,
      requester_id: principal.id,
      action: "gateway.execute",
      target: modelKey,
      risk: detections.some((d) => d.severity === "critical") ? "critical" : "high",
      reason: finalReason,
      policy_id: decision.policyId,
      policy_version: decision.policyVersion,
      policy_revalidated_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      // Sanitized payload only — never the raw prompt.
      payload: {
        promptPreview: maskPreview(prompt, detections, 200),
        prompt: redact(prompt, detections),
        modelKey,
        policies,
      },
    });
    approvalId = approval?.id ?? null;
  }

  await audit({
    action: "gateway.request",
    resource: "model",
    resource_id: modelKey,
    decision: finalAction,
    policy_id: decision.policyId,
    policy_version: decision.policyVersion,
    request_id: requestRow?.id ?? null,
    risk: finalAction === "BLOCK" ? "high" : finalAction === "REQUIRE_APPROVAL" ? "medium" : "info",
    result: status,
    metadata: { detections: detections.length, cost: costUsd, principal: principal.kind },
  });

  // Unknown provider failures retain the reservation: the upstream may have
  // billed the call. Never automatically release ambiguous spend.
  if (reserved && status !== "provider_error") await store.settle(principal.orgId, idempotencyKey);

  return {
    decision: finalAction,
    reason: finalReason,
    policy: decision.policyName
      ? { name: decision.policyName, version: decision.policyVersion }
      : null,
    matchedRules: decision.matchedRules,
    findings: [...detections, ...responseDetections].map((d) => ({
      category: d.category,
      label: d.label,
      severity: d.severity,
      confidence: d.confidence,
      source: d.source,
    })),
    output,
    status,
    approvalId,
    requestId: requestRow?.id ?? null,
    usage: { inputTokens, outputTokens, costUsd, latency },
  };
}
