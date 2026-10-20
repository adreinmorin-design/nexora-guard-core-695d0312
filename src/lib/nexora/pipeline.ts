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

import { validateProviderIdentifier } from "./provider-evidence";
import { inspect, redact, maskPreview, type Detection } from "./dlp";
import { evaluate, type Decision, type GovAction, type PolicyRecord } from "./policy-engine";
import { executeUnderDecision } from "./enforcement";
import { MAX_OUTPUT_TOKENS, INPUT_OVERHEAD_TOKENS } from "./limits";
import {
  legacyActionToPolicyOutcome,
  type EnforcementPoint,
  type PolicyOutcome,
} from "./governance-types";

export type ProviderResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  providerRequestId?: string | null;
  providerResponseId?: string | null;
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
  ownerId?: string;
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

export type PipelineTraceEvent = {
  stage:
    | "pii"
    | "injection"
    | "budget"
    | "provider_selection"
    | "tool_authorization"
    | "execution"
    | "audit";
  status: "running" | "passed" | "blocked" | "redacted" | "not_applicable" | "failed" | "completed";
  summary: string;
  detail?: Record<string, unknown>;
  requestId?: string | null;
};

export type GovernanceDecisionEvent = {
  enforcementPoint: EnforcementPoint;
  decision: PolicyOutcome;
  reason: string;
  policyId: string | null;
  policyVersion: number | null;
  ruleId: string | null;
  evaluatedContext: Record<string, unknown>;
  attributes?: Record<string, unknown>;
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
  providerRequestId?: string | null;
  providerResponseId?: string | null;
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
  maxRequestCostUsd?: number | null;
  trace?: (event: PipelineTraceEvent) => Promise<void>;
  governanceDecision?: (event: GovernanceDecisionEvent) => Promise<void>;
  governedContext?: { intentId: string; executionId: string };
}): Promise<GatewayOutcome> {
  const { store, principal, prompt, modelKey, execute } = params;
  const trace = async (event: PipelineTraceEvent) => {
    try {
      await params.trace?.(event);
    } catch {
      // Execution tracing is operational visibility, not the security audit
      // authority. A trace outage must not weaken policy enforcement.
    }
  };
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

  // 1. Resolve the model internally. The buyer-facing provider-selection
  // event is emitted after data and budget controls on the successful path.
  const model = await store.getModel(principal.orgId, modelKey);
  if (!model) {
    await trace({
      stage: "provider_selection",
      status: "blocked",
      summary: "Requested model is not registered for this organization.",
      detail: { modelKey },
    });
    return failClosed("Model is not registered in this organization's model registry.", "high");
  }
  if (model.status !== "active" || model.provider_status !== "active") {
    await trace({
      stage: "provider_selection",
      status: "blocked",
      summary: "Model or provider is suspended.",
      detail: { provider: model.provider_vendor, modelKey },
    });
    return failClosed("Model or provider is not in an active state.");
  }
  if (model.provider_credential_state !== "CONFIGURED") {
    await trace({
      stage: "provider_selection",
      status: "blocked",
      summary: "Provider credential is not configured.",
      detail: { provider: model.provider_vendor, modelKey },
    });
    return failClosed(`Provider execution for ${model.provider_vendor} is NOT_CONFIGURED.`);
  }
  // 2. Deterministic inspection.
  const detections = inspect(prompt);
  const injectionCategories = new Set([
    "prompt_injection",
    "system_prompt_extraction",
    "data_exfiltration",
  ]);
  const injectionDetections = detections.filter((d) => injectionCategories.has(d.category));
  const piiDetections = detections.filter((d) => !injectionCategories.has(d.category));
  await trace({
    stage: "pii",
    status: "passed",
    summary: piiDetections.length
      ? `${piiDetections.length} sensitive-data finding(s) detected for policy evaluation.`
      : "No PII or secret pattern detected.",
    detail: {
      detections: piiDetections.map((d) => ({
        category: d.category,
        severity: d.severity,
        confidence: d.confidence,
      })),
    },
  });
  await trace({
    stage: "injection",
    status: "passed",
    summary: injectionDetections.length
      ? `${injectionDetections.length} injection/exfiltration signal(s) detected.`
      : "No prompt-injection signal detected.",
    detail: {
      detections: injectionDetections.map((d) => ({
        category: d.category,
        severity: d.severity,
        confidence: d.confidence,
      })),
    },
  });

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
  if (
    params.maxRequestCostUsd != null &&
    Number.isFinite(params.maxRequestCostUsd) &&
    estimatedCost > params.maxRequestCostUsd
  ) {
    await trace({
      stage: "budget",
      status: "blocked",
      summary: "Estimated request cost exceeds the administrator per-request ceiling.",
      detail: {
        estimatedCostUsd: Number(estimatedCost.toFixed(6)),
        maxRequestCostUsd: params.maxRequestCostUsd,
      },
    });
    return failClosed("Estimated request cost exceeds the administrator per-request ceiling.");
  }

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
  let budgetGate: { action: GovAction; reason: string } | null = null;
  for (const b of await store.listBudgets(principal.orgId)) {
    // Authoritative, period-aware admission happens atomically in reserve().
    if (b.period !== "monthly") continue;
    if (monthlySpend + estimatedCost > Number(b.limit_usd)) {
      const action = b.action_on_exceed;
      const reason = `Budget "${b.name}" exceeded (${monthlySpend.toFixed(4)} of ${Number(b.limit_usd).toFixed(2)}).`;
      if (!budgetGate || ORDER.indexOf(action) > ORDER.indexOf(budgetGate.action)) {
        budgetGate = { action, reason };
      }
      if (ORDER.indexOf(action) > ORDER.indexOf(finalAction)) {
        finalAction = action;
        finalReason = reason;
      }
    }
  }

  await trace({
    stage: "budget",
    status:
      budgetGate?.action === "BLOCK" || budgetGate?.action === "REQUIRE_APPROVAL"
        ? "blocked"
        : "passed",
    summary: budgetGate
      ? budgetGate.action === "REQUIRE_APPROVAL"
        ? `Budget threshold reached; human approval is required. ${budgetGate.reason}`
        : budgetGate.reason
      : `Budget admitted. Estimated cost $${estimatedCost.toFixed(6)}.`,
    detail: {
      monthlySpendUsd: Number(monthlySpend.toFixed(6)),
      estimatedCostUsd: Number(estimatedCost.toFixed(6)),
      budgetAction: budgetGate?.action ?? "ALLOW",
    },
  });
  await trace({
    stage: "provider_selection",
    status: "passed",
    summary: `${model.provider_vendor} selected for ${model.display_name}.`,
    detail: { provider: model.provider_vendor, modelKey, classification: model.classification },
  });

  // Security evidence is authoritative. Unlike operational trace callbacks,
  // failure to persist the PRE_MODEL_INVOCATION decision stops execution.
  await params.governanceDecision?.({
    enforcementPoint: "PRE_MODEL_INVOCATION",
    decision: legacyActionToPolicyOutcome(finalAction),
    reason: finalReason,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    ruleId: decision.matchedRules[0]?.policyId ?? null,
    evaluatedContext: {
      modelKey,
      provider: model.provider_vendor,
      modelClassification: model.classification,
      detectionCategories: detections.map((d) => d.category),
      estimatedCostUsd: Number(estimatedCost.toFixed(6)),
      monthlySpendUsd: Number(monthlySpend.toFixed(6)),
      actorType: principal.kind,
      budgetAction: budgetGate?.action ?? "ALLOW",
    },
    attributes: {
      modelKey,
      provider: model.provider_vendor,
      transformed: finalAction === "REDACT",
      policyContext: {
        detectionCategories: detections.map((d) => ({
          category: d.category,
          severity: d.severity,
        })),
        modelKey,
        modelClassification: model.classification,
        provider: model.provider_vendor,
        estimatedCostUsd: Number(estimatedCost.toFixed(6)),
        monthlySpendUsd: Number(monthlySpend.toFixed(6)),
        actorType: principal.kind,
        stage: "request",
      },
    },
  });
  await trace({
    stage: "tool_authorization",
    status: "not_applicable",
    summary: "No external tool requested; model execution path only.",
  });

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
  let providerRequestId: string | null = null;
  let providerResponseId: string | null = null;
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

  await trace({
    stage: "execution",
    status:
      finalAction === "BLOCK"
        ? "blocked"
        : finalAction === "REQUIRE_APPROVAL"
          ? "blocked"
          : "running",
    summary:
      finalAction === "BLOCK"
        ? "Execution stopped before provider egress."
        : finalAction === "REQUIRE_APPROVAL"
          ? "Execution paused for human approval."
          : `Dispatch authorized with ${finalAction} decision.`,
    detail: { action: finalAction },
  });

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
      providerRequestId = validateProviderIdentifier(result.providerRequestId);
      providerResponseId = validateProviderIdentifier(result.providerResponseId);
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

      await params.governanceDecision?.({
        enforcementPoint: "PRE_RESPONSE",
        decision: legacyActionToPolicyOutcome(responseDecision.action),
        reason: responseDecision.reason,
        policyId: responseDecision.policyId,
        policyVersion: responseDecision.policyVersion,
        ruleId: responseDecision.matchedRules[0]?.policyId ?? null,
        evaluatedContext: {
          modelKey,
          provider: model.provider_vendor,
          responseDetectionCategories: responseDetections.map((d) => d.category),
          costUsd: Number(costUsd.toFixed(6)),
          actorType: principal.kind,
        },
        attributes: {
          outputWithheld:
            responseDecision.action === "BLOCK" || responseDecision.action === "REQUIRE_APPROVAL",
          transformed: responseDecision.action === "REDACT",
          policyContext: {
            detectionCategories: responseDetections.map((d) => ({
              category: d.category,
              severity: d.severity,
            })),
            modelKey,
            modelClassification: model.classification,
            provider: model.provider_vendor,
            estimatedCostUsd: Number(costUsd.toFixed(6)),
            monthlySpendUsd: Number((monthlySpend + costUsd).toFixed(6)),
            actorType: principal.kind,
            stage: "response",
          },
        },
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

      await trace({
        stage: "execution",
        status: status === "response_blocked" ? "blocked" : "completed",
        summary:
          status === "response_blocked"
            ? "Provider responded, but response controls withheld the output."
            : "Provider execution completed.",
        detail: {
          latencyMs: latency,
          inputTokens,
          outputTokens,
          costUsd: Number(costUsd.toFixed(6)),
          responseFindings: responseDetections.length,
          providerRequestId,
          providerResponseId,
        },
      });

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
    providerRequestId =
      validateProviderIdentifier(
        error instanceof Error && "providerRequestId" in error ? error.providerRequestId : null,
      ) ?? providerRequestId;
    // Only a real ProviderError carries a sanitized, hardcoded message (see
    // mapUpstreamStatus in ai-gateway.server.ts). A generic/unknown thrown
    // error must never be persisted — it could contain arbitrary internal
    // text — so it is duck-typed strictly by name + numeric status.
    const isClassifiedProviderError =
      error instanceof Error && error.name === "ProviderError" && "status" in error &&
      typeof error.status === "number";
    const providerFailureReason = isClassifiedProviderError ? error.message : null;
    const providerStatus = isClassifiedProviderError ? error.status : null;
    status = "provider_error";
    finalReason = providerFailureReason
      ? `${finalReason} · provider request failed: ${providerFailureReason}`
      : `${finalReason} · provider request failed; details withheld`;
    await trace({
      stage: "execution",
      status: "failed",
      summary: providerFailureReason
        ? "Provider execution failed; classified failure reason recorded."
        : "Provider execution failed; upstream details withheld.",
      detail: {
        providerRequestId,
        providerResponseId,
        ...(isClassifiedProviderError ? { providerStatus, providerFailureReason } : {}),
      },
    });
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
    provider_request_id: providerRequestId,
    provider_response_id: providerResponseId,
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

  if (finalAction === "REQUIRE_APPROVAL" && (principal.kind === "user" || principal.ownerId)) {
    const approval = await store.insertApproval({
      org_id: principal.orgId,
      request_id: requestRow?.id ?? null,
      requester_id: principal.kind === "agent" ? principal.ownerId : principal.id,
      action: "gateway.execute",
      target: modelKey,
      risk: detections.some((d) => d.severity === "critical") ? "critical" : "high",
      reason: finalReason,
      policy_id: decision.policyId,
      policy_version: decision.policyVersion,
      policy_revalidated_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      ...(params.governedContext
        ? {
            intent_id: params.governedContext.intentId,
            original_execution_id: params.governedContext.executionId,
            approval_scope: {
              operation: "model.invoke",
              provider: model.provider_vendor,
              model: modelKey,
              data_classification: model.classification,
            },
            single_use: true,
          }
        : {}),
      // Sanitized payload only — never the raw prompt.
      payload: {
        promptPreview: maskPreview(prompt, detections, 200),
        prompt: redact(prompt, detections),
        modelKey,
        policies,
        ...(principal.kind === "agent" ? { agentId: principal.id } : {}),
      },
    });
    approvalId = approval?.id ?? null;
  }

  await trace({
    stage: "audit",
    status: "running",
    summary: "Writing governed request and immutable audit evidence.",
    requestId: requestRow?.id ?? null,
  });
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
    metadata: {
      detections: detections.length,
      cost: costUsd,
      principal: principal.kind,
      providerRequestId,
      providerResponseId,
    },
  });

  await trace({
    stage: "audit",
    status: "completed",
    summary: "Governed request, findings and audit evidence persisted.",
    requestId: requestRow?.id ?? null,
    detail: { decision: finalAction, status },
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
    providerRequestId,
    providerResponseId,
    usage: { inputTokens, outputTokens, costUsd, latency },
  };
}
