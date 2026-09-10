import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

import { inspect, redact, maskPreview, type Detection } from "./nexora/dlp";
import { evaluate, type GovAction, type PolicyRecord } from "./nexora/policy-engine";
import { SEED_MODELS, SEED_POLICIES, SEED_PROVIDERS } from "./nexora/catalog";

type Ctx = {
  supabase: Awaited<ReturnType<typeof getSupabase>>;
  userId: string;
};

// Small helper only used for the type above.
async function getSupabase() {
  throw new Error("unreachable");
  // eslint-disable-next-line no-unreachable
  return null as never;
}

const GOV_ROLES = ["platform_admin", "org_admin", "governance_admin", "security_admin"];

type Workspace = {
  orgId: string;
  orgName: string;
  roles: string[];
};

/**
 * Tenant resolution is always server-side. The browser never supplies an
 * organization id; it is derived from the authenticated user's memberships.
 */
async function resolveWorkspace(context: any): Promise<Workspace> {
  const { data, error } = await context.supabase
    .from("org_members")
    .select("org_id, role, organizations(name)")
    .eq("user_id", context.userId);

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("NO_WORKSPACE");

  const orgId = data[0].org_id as string;
  const scoped = data.filter((row: any) => row.org_id === orgId);
  return {
    orgId,
    orgName: (scoped[0] as any).organizations?.name ?? "Organization",
    roles: scoped.map((row: any) => row.role as string),
  };
}

async function writeAudit(
  context: any,
  orgId: string,
  event: {
    action: string;
    resource: string;
    resource_id?: string | null;
    decision?: GovAction | null;
    policy_id?: string | null;
    policy_version?: number | null;
    request_id?: string | null;
    risk?: "critical" | "high" | "medium" | "low" | "info";
    result?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await context.supabase.from("audit_events").insert({
    org_id: orgId,
    actor_id: context.userId,
    actor_type: "user",
    source: "console",
    ...event,
  });
}

/* ------------------------------------------------------------------ */
/* Workspace bootstrap                                                 */
/* ------------------------------------------------------------------ */

export const ensureWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const email = (context.claims?.email as string | undefined) ?? null;

    await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, email }, { onConflict: "id" });

    const existing = await context.supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", context.userId)
      .limit(1);

    if (existing.data && existing.data.length > 0) {
      const ws = await resolveWorkspace(context);
      return { ...ws, provisioned: false };
    }

    const domain = email?.split("@")[1]?.split(".")[0] ?? "nexora";
    const label = domain.charAt(0).toUpperCase() + domain.slice(1);
    const slug = `${domain}-${Math.random().toString(36).slice(2, 8)}`;

    const org = await context.supabase
      .from("organizations")
      .insert({ name: `${label} Organization`, slug, created_by: context.userId })
      .select("id, name")
      .single();

    if (org.error) throw new Error(org.error.message);
    const orgId = org.data.id as string;

    // The founding user becomes org admin first, which authorizes the rest.
    const first = await context.supabase
      .from("org_members")
      .insert({ org_id: orgId, user_id: context.userId, role: "org_admin" });
    if (first.error) throw new Error(first.error.message);

    await context.supabase.from("org_members").insert(
      ["security_admin", "governance_admin", "agent_admin"].map((role) => ({
        org_id: orgId,
        user_id: context.userId,
        role,
      })),
    );

    const providers = await context.supabase
      .from("providers")
      .insert(SEED_PROVIDERS.map((p) => ({ ...p, org_id: orgId })))
      .select("id, vendor");
    if (providers.error) throw new Error(providers.error.message);

    const byVendor = new Map<string, string>(
      (providers.data as Array<{ id: string; vendor: string }>).map((p) => [p.vendor, p.id]),
    );

    await context.supabase.from("models").insert(
      SEED_MODELS.map((m) => ({
        org_id: orgId,
        provider_id: byVendor.get(m.vendor)!,
        model_key: m.model_key,
        display_name: m.display_name,
        context_window: m.context_window,
        input_cost_per_1k: m.input_cost_per_1k,
        output_cost_per_1k: m.output_cost_per_1k,
        classification: m.classification,
        status: m.status,
      })),
    );

    const policies = await context.supabase
      .from("policies")
      .insert(
        SEED_POLICIES.map((p) => ({
          org_id: orgId,
          name: p.name,
          description: p.description,
          scope: p.scope,
          priority: p.priority,
          action: p.action,
          conditions: p.conditions,
          created_by: context.userId,
        })),
      )
      .select("id, name, action, priority, conditions, version");

    if (policies.data) {
      await context.supabase.from("policy_versions").insert(
        (policies.data as any[]).map((p) => ({
          org_id: orgId,
          policy_id: p.id,
          version: p.version,
          snapshot: p,
          change_note: "Initial baseline policy",
          created_by: context.userId,
        })),
      );
    }

    await context.supabase.from("budgets").insert({
      org_id: orgId,
      name: "Organization monthly budget",
      scope: "organization",
      period: "monthly",
      limit_usd: 250,
      action_on_exceed: "REQUIRE_APPROVAL",
    });

    await writeAudit(context, orgId, {
      action: "organization.provisioned",
      resource: "organization",
      resource_id: orgId,
      risk: "info",
      metadata: { seeded: true },
    });

    return {
      orgId,
      orgName: org.data.name as string,
      roles: ["org_admin", "security_admin", "governance_admin", "agent_admin"],
      provisioned: true,
    };
  });

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export const getOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();

    const [requests, findings, approvals, policies, budgets, members] = await Promise.all([
      context.supabase
        .from("requests")
        .select("decision, cost_usd, latency_ms, model, created_at, redacted")
        .eq("org_id", ws.orgId)
        .gte("created_at", since),
      context.supabase
        .from("security_findings")
        .select("severity, status")
        .eq("org_id", ws.orgId),
      context.supabase
        .from("approvals")
        .select("id, status")
        .eq("org_id", ws.orgId)
        .eq("status", "pending"),
      context.supabase.from("policies").select("id, status").eq("org_id", ws.orgId),
      context.supabase.from("budgets").select("limit_usd, period").eq("org_id", ws.orgId),
      context.supabase.from("org_members").select("user_id").eq("org_id", ws.orgId),
    ]);

    const rows = (requests.data ?? []) as any[];
    const spend = rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
    const blocked = rows.filter((r) => r.decision === "BLOCK").length;
    const redacted = rows.filter((r) => r.redacted).length;
    const violations = rows.filter((r) => r.decision !== "ALLOW" && r.decision !== "LOG").length;
    const openFindings = ((findings.data ?? []) as any[]).filter((f) => f.status === "open");
    const critical = openFindings.filter((f) => f.severity === "critical").length;
    const high = openFindings.filter((f) => f.severity === "high").length;

    const byModel = new Map<string, number>();
    for (const r of rows) {
      if (!r.model) continue;
      byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
    }

    const byDay = new Map<string, { day: string; total: number; blocked: number }>();
    for (const r of rows) {
      const day = String(r.created_at).slice(0, 10);
      const entry = byDay.get(day) ?? { day, total: 0, blocked: 0 };
      entry.total += 1;
      if (r.decision === "BLOCK") entry.blocked += 1;
      byDay.set(day, entry);
    }

    const latencies = rows.map((r) => Number(r.latency_ms ?? 0)).filter((n) => n > 0);
    const riskScore = Math.min(
      100,
      critical * 25 + high * 10 + blocked * 3 + openFindings.length * 2,
    );

    return {
      workspace: ws,
      totals: {
        requests: rows.length,
        blocked,
        redacted,
        violations,
        spend,
        pendingApprovals: (approvals.data ?? []).length,
        openFindings: openFindings.length,
        criticalFindings: critical,
        activePolicies: ((policies.data ?? []) as any[]).filter((p) => p.status === "active").length,
        members: (members.data ?? []).length,
        budget: Number(((budgets.data ?? [])[0] as any)?.limit_usd ?? 0),
        avgLatency: latencies.length
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0,
        riskScore,
      },
      decisionSplit: ["ALLOW", "LOG", "REDACT", "REQUIRE_APPROVAL", "BLOCK"].map((d) => ({
        decision: d,
        count: rows.filter((r) => r.decision === d).length,
      })),
      topModels: [...byModel.entries()]
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      traffic: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
    };
  });

export const listRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const { data, error } = await context.supabase
      .from("requests")
      .select("*")
      .eq("org_id", ws.orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const [providers, models] = await Promise.all([
      context.supabase.from("providers").select("*").eq("org_id", ws.orgId).order("name"),
      context.supabase.from("models").select("*").eq("org_id", ws.orgId).order("display_name"),
    ]);
    return {
      workspace: ws,
      providers: providers.data ?? [],
      models: models.data ?? [],
    };
  });

export const listPolicies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const [policies, versions] = await Promise.all([
      context.supabase
        .from("policies")
        .select("*")
        .eq("org_id", ws.orgId)
        .order("priority", { ascending: true }),
      context.supabase
        .from("policy_versions")
        .select("id, policy_id, version, change_note, created_at")
        .eq("org_id", ws.orgId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    return {
      workspace: ws,
      canGovern: ws.roles.some((r) => GOV_ROLES.includes(r)),
      policies: policies.data ?? [],
      versions: versions.data ?? [],
    };
  });

export const listFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const { data } = await context.supabase
      .from("security_findings")
      .select("*")
      .eq("org_id", ws.orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

export const listAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const { data } = await context.supabase
      .from("audit_events")
      .select("*")
      .eq("org_id", ws.orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const listApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const { data } = await context.supabase
      .from("approvals")
      .select("*")
      .eq("org_id", ws.orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    return {
      workspace: ws,
      canDecide: ws.roles.some((r) => GOV_ROLES.includes(r)),
      approvals: data ?? [],
    };
  });

export const listBudgets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const [budgets, requests] = await Promise.all([
      context.supabase.from("budgets").select("*").eq("org_id", ws.orgId).order("name"),
      context.supabase
        .from("requests")
        .select("cost_usd")
        .eq("org_id", ws.orgId)
        .gte("created_at", since.toISOString()),
    ]);
    const spend = ((requests.data ?? []) as any[]).reduce(
      (sum, r) => sum + Number(r.cost_usd ?? 0),
      0,
    );
    return {
      workspace: ws,
      canGovern: ws.roles.some((r) => GOV_ROLES.includes(r)),
      budgets: budgets.data ?? [],
      monthToDateSpend: spend,
    };
  });

export const listMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const { data } = await context.supabase
      .from("org_members")
      .select("id, user_id, role, created_at")
      .eq("org_id", ws.orgId)
      .order("created_at");
    return { workspace: ws, members: data ?? [] };
  });

/* ------------------------------------------------------------------ */
/* Policy authoring                                                    */
/* ------------------------------------------------------------------ */

const conditionSchema = z.object({
  field: z.string(),
  op: z.enum(["in", "equals", "not_equals", "gt", "lt"]),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});

const policyInput = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  priority: z.number().int().min(1).max(999),
  action: z.enum(["ALLOW", "LOG", "REDACT", "REQUIRE_APPROVAL", "BLOCK"]),
  scope: z.string().default("organization"),
  status: z.enum(["draft", "active", "suspended", "archived"]).default("active"),
  conditions: z.array(conditionSchema).default([]),
  changeNote: z.string().optional(),
});

export const savePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => policyInput.parse(input))
  .handler(async ({ data, context }: { data: any; context: any }) => {
    const ws = await resolveWorkspace(context);
    if (!ws.roles.some((r) => GOV_ROLES.includes(r))) {
      throw new Error("Forbidden: policy authoring requires a governance or admin role.");
    }

    let policyId = data.id ?? null;
    let version = 1;

    if (policyId) {
      const current = await context.supabase
        .from("policies")
        .select("version")
        .eq("id", policyId)
        .eq("org_id", ws.orgId)
        .single();
      if (current.error) throw new Error("Policy not found in this organization.");
      version = Number(current.data.version) + 1;

      const updated = await context.supabase
        .from("policies")
        .update({
          name: data.name,
          description: data.description ?? null,
          priority: data.priority,
          action: data.action,
          scope: data.scope,
          status: data.status,
          conditions: data.conditions,
          version,
          updated_at: new Date().toISOString(),
        })
        .eq("id", policyId)
        .eq("org_id", ws.orgId);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const created = await context.supabase
        .from("policies")
        .insert({
          org_id: ws.orgId,
          name: data.name,
          description: data.description ?? null,
          priority: data.priority,
          action: data.action,
          scope: data.scope,
          status: data.status,
          conditions: data.conditions,
          created_by: context.userId,
        })
        .select("id, version")
        .single();
      if (created.error) throw new Error(created.error.message);
      policyId = created.data.id as string;
      version = Number(created.data.version);
    }

    await context.supabase.from("policy_versions").insert({
      org_id: ws.orgId,
      policy_id: policyId,
      version,
      snapshot: { ...data, version },
      change_note: data.changeNote ?? (data.id ? "Policy updated" : "Policy created"),
      created_by: context.userId,
    });

    await writeAudit(context, ws.orgId, {
      action: data.id ? "policy.updated" : "policy.created",
      resource: "policy",
      resource_id: policyId,
      policy_id: policyId,
      policy_version: version,
      risk: "medium",
      metadata: { name: data.name, action: data.action, priority: data.priority },
    });

    return { id: policyId, version };
  });

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(input),
  )
  .handler(async ({ data, context }: { data: any; context: any }) => {
    const ws = await resolveWorkspace(context);
    if (!ws.roles.some((r) => GOV_ROLES.includes(r))) {
      throw new Error("Forbidden: you are not an approver in this organization.");
    }

    const existing = await context.supabase
      .from("approvals")
      .select("id, status, requester_id, expires_at")
      .eq("id", data.id)
      .eq("org_id", ws.orgId)
      .single();
    if (existing.error) throw new Error("Approval request not found.");
    if (existing.data.status !== "pending") throw new Error("This request is already decided.");
    if (existing.data.requester_id === context.userId) {
      throw new Error("Self-approval is not permitted.");
    }
    if (new Date(existing.data.expires_at).getTime() < Date.now()) {
      throw new Error("This approval request has expired.");
    }

    const { error } = await context.supabase
      .from("approvals")
      .update({
        status: data.decision,
        approver_id: context.userId,
        decided_at: new Date().toISOString(),
        execution_result: data.decision === "approved" ? "authorized" : "not_executed",
      })
      .eq("id", data.id)
      .eq("org_id", ws.orgId);
    if (error) throw new Error(error.message);

    await writeAudit(context, ws.orgId, {
      action: `approval.${data.decision}`,
      resource: "approval",
      resource_id: data.id,
      risk: data.decision === "approved" ? "high" : "low",
      result: data.decision,
    });

    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Gateway request pipeline                                            */
/* ------------------------------------------------------------------ */

export const submitGatewayRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ prompt: z.string().min(1).max(20000), modelKey: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }: { data: any; context: any }) => {
    const ws = await resolveWorkspace(context);
    const startedAt = Date.now();

    // 1. Model must be registered and approved inside this tenant.
    const model = await context.supabase
      .from("models")
      .select("model_key, display_name, classification, status, input_cost_per_1k, output_cost_per_1k, providers(vendor, status, credential_state)")
      .eq("org_id", ws.orgId)
      .eq("model_key", data.modelKey)
      .maybeSingle();

    if (!model.data) {
      const req = await recordRequest(context, ws.orgId, {
        model: data.modelKey,
        provider: null,
        decision: "BLOCK",
        reason: "Model is not registered in this organization's model registry.",
        prompt_preview: data.prompt.slice(0, 200),
        latency_ms: Date.now() - startedAt,
        status: "blocked",
      });
      await writeAudit(context, ws.orgId, {
        action: "gateway.request",
        resource: "model",
        resource_id: data.modelKey,
        decision: "BLOCK",
        request_id: req?.id ?? null,
        risk: "high",
        result: "blocked",
      });
      return {
        decision: "BLOCK" as GovAction,
        reason: "Model is not registered in this organization's model registry.",
        policy: null,
        matchedRules: [],
        findings: [],
        output: null,
        requestId: req?.id ?? null,
      };
    }

    const provider = (model.data as any).providers;
    const modelClassification = (model.data as any).classification as string;
    const vendor = provider?.vendor as string;

    if ((model.data as any).status !== "active" || provider?.status !== "active") {
      return await blockedResponse(
        context,
        ws.orgId,
        data,
        vendor,
        "Model or provider is not in an active state.",
        startedAt,
      );
    }

    if (provider?.credential_state === "NOT_CONFIGURED") {
      return await blockedResponse(
        context,
        ws.orgId,
        data,
        vendor,
        `Provider execution for ${vendor} is NOT_CONFIGURED.`,
        startedAt,
      );
    }

    // 2. Deterministic inspection of the prompt.
    const detections = inspect(data.prompt);

    // 3. Cost context (server-side only, never trusted from the browser).
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const spendRows = await context.supabase
      .from("requests")
      .select("cost_usd")
      .eq("org_id", ws.orgId)
      .gte("created_at", monthStart.toISOString());
    const monthlySpend = ((spendRows.data ?? []) as any[]).reduce(
      (sum, r) => sum + Number(r.cost_usd ?? 0),
      0,
    );
    const estTokens = Math.ceil(data.prompt.length / 4);
    const estimatedCost =
      (estTokens / 1000) * Number((model.data as any).input_cost_per_1k ?? 0);

    // 4. Load tenant policies and evaluate deterministically.
    const policyRows = await context.supabase
      .from("policies")
      .select("id, name, description, priority, action, version, status, scope, conditions")
      .eq("org_id", ws.orgId);

    const policies = (policyRows.data ?? []) as PolicyRecord[];
    const decision = evaluate(policies, {
      detections,
      modelKey: data.modelKey,
      modelClassification,
      provider: vendor,
      estimatedCostUsd: estimatedCost,
      monthlySpendUsd: monthlySpend,
      actorType: "user",
      stage: "request",
    });

    // 5. Budget enforcement, server-side.
    const budgetRows = await context.supabase
      .from("budgets")
      .select("name, limit_usd, action_on_exceed, status, period")
      .eq("org_id", ws.orgId)
      .eq("status", "active");
    let budgetAction: GovAction | null = null;
    let budgetReason = "";
    for (const b of (budgetRows.data ?? []) as any[]) {
      if (monthlySpend + estimatedCost > Number(b.limit_usd)) {
        budgetAction = b.action_on_exceed as GovAction;
        budgetReason = `Budget "${b.name}" exceeded ($${monthlySpend.toFixed(4)} of $${Number(b.limit_usd).toFixed(2)}).`;
      }
    }

    const order: GovAction[] = ["ALLOW", "LOG", "REDACT", "REQUIRE_APPROVAL", "BLOCK"];
    let finalAction = decision.action;
    let finalReason = decision.reason;
    if (budgetAction && order.indexOf(budgetAction) > order.indexOf(finalAction)) {
      finalAction = budgetAction;
      finalReason = budgetReason;
    }

    const findingsToWrite = detections.map((d) => ({
      severity: d.severity,
      category: d.category,
      title: `${d.label} detected in prompt`,
      detection_source: d.source,
      confidence: d.confidence,
      evidence: { sample: `${d.match.slice(0, 4)}…`, offset: d.start, stage: "request" },
      affected_resource: data.modelKey,
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

    if (finalAction === "BLOCK") {
      status = "blocked";
    } else if (finalAction === "REQUIRE_APPROVAL") {
      status = "pending_approval";
    } else {
      const outbound =
        finalAction === "REDACT" ? redact(data.prompt, detections) : data.prompt;
      redactedFlag = finalAction === "REDACT";
      try {
        const { executeProviderRequest } = await import("./ai-gateway.server");
        const result = await executeProviderRequest(data.modelKey, outbound);
        inputTokens = result.inputTokens || estTokens;
        outputTokens = result.outputTokens || Math.ceil(result.text.length / 4);
        latency = result.latencyMs;
        costUsd =
          (inputTokens / 1000) * Number((model.data as any).input_cost_per_1k ?? 0) +
          (outputTokens / 1000) * Number((model.data as any).output_cost_per_1k ?? 0);

        // 6. Response inspection — responses are governed too.
        responseDetections = inspect(result.text);
        const responseDecision = evaluate(policies, {
          detections: responseDetections,
          modelKey: data.modelKey,
          modelClassification,
          provider: vendor,
          estimatedCostUsd: costUsd,
          monthlySpendUsd: monthlySpend + costUsd,
          actorType: "user",
          stage: "response",
        });

        if (responseDecision.action === "BLOCK") {
          output = null;
          status = "response_blocked";
          finalAction = "BLOCK";
          finalReason = `Response withheld — ${responseDecision.reason}`;
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
            evidence: { sample: `${d.match.slice(0, 4)}…`, offset: d.start, stage: "response" },
            affected_resource: data.modelKey,
            remediation: "Investigate the source of the leaked value and tighten data access.",
          });
        }
      } catch (error: any) {
        status = "provider_error";
        finalReason = `${finalReason} · provider error: ${error?.message ?? "unknown"}`;
      }
    }

    const requestRow = await recordRequest(context, ws.orgId, {
      model: data.modelKey,
      provider: vendor,
      decision: finalAction,
      reason: finalReason,
      policy_id: decision.policyId,
      policy_version: decision.policyVersion,
      matched_rules: decision.matchedRules,
      redacted: redactedFlag,
      prompt_preview: maskPreview(data.prompt, detections, 300),
      response_preview: output ? output.slice(0, 300) : null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: Number(costUsd.toFixed(6)),
      latency_ms: latency || Date.now() - startedAt,
      status,
    });

    if (findingsToWrite.length > 0) {
      await context.supabase.from("security_findings").insert(
        findingsToWrite.map((f) => ({ ...f, org_id: ws.orgId, request_id: requestRow?.id ?? null })),
      );
    }

    if (finalAction === "REQUIRE_APPROVAL") {
      const approval = await context.supabase
        .from("approvals")
        .insert({
          org_id: ws.orgId,
          request_id: requestRow?.id ?? null,
          requester_id: context.userId,
          action: "gateway.execute",
          target: data.modelKey,
          risk: detections.some((d) => d.severity === "critical") ? "critical" : "high",
          reason: finalReason,
          policy_id: decision.policyId,
          policy_version: decision.policyVersion,
          payload: { promptPreview: maskPreview(data.prompt, detections, 200) },
        })
        .select("id")
        .single();
      approvalId = (approval.data as any)?.id ?? null;
    }

    await writeAudit(context, ws.orgId, {
      action: "gateway.request",
      resource: "model",
      resource_id: data.modelKey,
      decision: finalAction,
      policy_id: decision.policyId,
      policy_version: decision.policyVersion,
      request_id: requestRow?.id ?? null,
      risk:
        finalAction === "BLOCK"
          ? "high"
          : finalAction === "REQUIRE_APPROVAL"
            ? "medium"
            : "info",
      result: status,
      metadata: { detections: detections.length, cost: costUsd },
    });

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
  });

async function recordRequest(context: any, orgId: string, values: Record<string, unknown>) {
  const { data } = await context.supabase
    .from("requests")
    .insert({ org_id: orgId, user_id: context.userId, ...values })
    .select("id")
    .single();
  return data as { id: string } | null;
}

async function blockedResponse(
  context: any,
  orgId: string,
  data: any,
  vendor: string | null,
  reason: string,
  startedAt: number,
) {
  const req = await recordRequest(context, orgId, {
    model: data.modelKey,
    provider: vendor,
    decision: "BLOCK",
    reason,
    prompt_preview: data.prompt.slice(0, 200),
    latency_ms: Date.now() - startedAt,
    status: "blocked",
  });
  await writeAudit(context, orgId, {
    action: "gateway.request",
    resource: "model",
    resource_id: data.modelKey,
    decision: "BLOCK",
    request_id: req?.id ?? null,
    risk: "medium",
    result: "blocked",
  });
  return {
    decision: "BLOCK" as GovAction,
    reason,
    policy: null,
    matchedRules: [],
    findings: [],
    output: null,
    requestId: req?.id ?? null,
  };
}

export type { Ctx };
