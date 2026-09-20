import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

import type { GovAction } from "./nexora/policy-engine";
import { SEED_MODELS, SEED_POLICIES, SEED_PROVIDERS } from "./nexora/catalog";
import { requireOrgEntitlement } from "./nexora/entitlements.server";

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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await (supabaseAdmin as any).from("audit_events").insert({
    org_id: orgId,
    actor_id: context.userId,
    actor_type: "user",
    source: "console",
    ...event,
  });
  if (error) throw new Error("Audit persistence unavailable.");
}

/* ------------------------------------------------------------------ */
/* Workspace bootstrap                                                 */
/* ------------------------------------------------------------------ */

export const ensureWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const email = (context.claims?.email as string | undefined) ?? null;

    const profile = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, email }, { onConflict: "id" });
    if (profile.error) throw new Error(profile.error.message);

    const existing = await context.supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", context.userId)
      .limit(1);
    if (existing.error) throw new Error(existing.error.message);

    if (existing.data && existing.data.length > 0) {
      const ws = await resolveWorkspace(context);
      return { ...ws, provisioned: false };
    }

    const domain = email?.split("@")[1]?.split(".")[0] ?? "nexora";
    const label = domain.charAt(0).toUpperCase() + domain.slice(1);
    const slug = `${domain}-${Math.random().toString(36).slice(2, 8)}`;

    // Bootstrap is a server-only operation. Using the service role here avoids
    // the first-member RLS deadlock while keeping tenant access derived from the
    // already verified user identity above. Normal reads and user mutations
    // continue to use the authenticated client and RLS.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const org = await db
      .from("organizations")
      .insert({ name: `${label} Organization`, slug, created_by: context.userId })
      .select("id, name")
      .single();

    if (org.error || !org.data) {
      throw new Error(org.error?.message ?? "Organization could not be created.");
    }
    const orgId = org.data.id as string;

    try {
      const membership = await db.from("org_members").insert(
        ["org_admin", "security_admin", "governance_admin", "agent_admin"].map((role) => ({
          org_id: orgId,
          user_id: context.userId,
          role,
        })),
      );
      if (membership.error) throw new Error(membership.error.message);

      const providers = await db
        .from("providers")
        .insert(SEED_PROVIDERS.map((p) => ({ ...p, org_id: orgId })))
        .select("id, vendor");
      if (providers.error) throw new Error(providers.error.message);

      const byVendor = new Map<string, string>(
        (providers.data as Array<{ id: string; vendor: string }>).map((p) => [p.vendor, p.id]),
      );

      const models = await db.from("models").insert(
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
      if (models.error) throw new Error(models.error.message);

      const policies = await db
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
      if (policies.error) throw new Error(policies.error.message);

      if (policies.data?.length) {
        const policyVersions = await db.from("policy_versions").insert(
          (policies.data as any[]).map((p) => ({
            org_id: orgId,
            policy_id: p.id,
            version: p.version,
            snapshot: p,
            change_note: "Initial baseline policy",
            created_by: context.userId,
          })),
        );
        if (policyVersions.error) throw new Error(policyVersions.error.message);
      }

      const budget = await db.from("budgets").insert({
        org_id: orgId,
        name: "Organization monthly budget",
        scope: "organization",
        period: "monthly",
        limit_usd: 250,
        action_on_exceed: "REQUIRE_APPROVAL",
      });
      if (budget.error) throw new Error(budget.error.message);

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
    } catch (error) {
      // A failed bootstrap must not leave another orphan organization behind.
      // The organization owns its seeded rows through cascading foreign keys.
      const cleanup = await db
        .from("organizations")
        .delete()
        .eq("id", orgId)
        .eq("created_by", context.userId);
      if (cleanup.error) {
        console.error("[NEXORA] Failed to clean up incomplete workspace", cleanup.error);
      }
      throw error;
    }
  });

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export const getOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();

    const [requests, findings, approvals, policies, budgets, members, agents] = await Promise.all([
      context.supabase
        .from("requests")
        .select("decision, cost_usd, latency_ms, model, created_at, redacted")
        .eq("org_id", ws.orgId)
        .gte("created_at", since),
      context.supabase.from("security_findings").select("severity, status").eq("org_id", ws.orgId),
      context.supabase
        .from("approvals")
        .select("id, status")
        .eq("org_id", ws.orgId)
        .eq("status", "pending"),
      context.supabase.from("policies").select("id, status").eq("org_id", ws.orgId),
      context.supabase.from("budgets").select("limit_usd, period").eq("org_id", ws.orgId),
      context.supabase.from("org_members").select("user_id").eq("org_id", ws.orgId),
      db
        .from("agents")
        .select("id", { count: "exact", head: true })
        .eq("org_id", ws.orgId)
        .eq("status", "active"),
    ]);
    if ([requests, findings, approvals, policies, budgets, members, agents].some((r) => r.error))
      throw new Error("Overview could not be loaded.");

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
        activeAgents: agents.count ?? 0,
        blocked,
        redacted,
        violations,
        spend,
        pendingApprovals: (approvals.data ?? []).length,
        openFindings: openFindings.length,
        criticalFindings: critical,
        activePolicies: ((policies.data ?? []) as any[]).filter((p) => p.status === "active")
          .length,
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
      db.from("models").select("*, providers(vendor)").eq("org_id", ws.orgId).order("display_name"),
    ]);
    if (providers.error || models.error) throw new Error("Catalog could not be loaded.");
    const { providerCredentialVariable, providerReadiness } = await import("./ai-gateway.server");
    return {
      workspace: ws,
      providers: (providers.data ?? []).map((p: any) => ({
        ...p,
        credential_state: providerReadiness(p.vendor),
        credential_variable: providerCredentialVariable(p.vendor),
        adapter: ["openai", "anthropic", "google"].includes(p.vendor)
          ? p.vendor
          : "openai-compatible",
      })),
      models: (models.data ?? []).map((model: any) => ({
        ...model,
        provider_vendor: model.providers?.vendor ?? "unknown",
        execution_state: providerReadiness(model.providers?.vendor ?? "unknown"),
      })),
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
    await requireOrgEntitlement(ws.orgId, "human_approvals");
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
  .validator((input: unknown) => policyInput.parse(input))
  .handler(async ({ data, context }: { data: any; context: any }) => {
    const ws = await resolveWorkspace(context);
    if (!ws.roles.some((r) => GOV_ROLES.includes(r))) {
      throw new Error("Forbidden: policy authoring requires a governance or admin role.");
    }
    if (data.action === "REQUIRE_APPROVAL") {
      await requireOrgEntitlement(ws.orgId, "human_approvals");
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
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(input),
  )
  .handler(async ({ data, context }: { data: any; context: any }) => {
    const ws = await resolveWorkspace(context);
    if (!ws.roles.some((r) => GOV_ROLES.includes(r))) {
      throw new Error("Forbidden: you are not an approver in this organization.");
    }
    await requireOrgEntitlement(ws.orgId, "human_approvals");

    const { decideAndExecute } = await import("./nexora/gateway.server");
    return decideAndExecute(context, ws.orgId, data.id, data.decision);
  });

/* ------------------------------------------------------------------ */
/* Gateway request pipeline                                            */
/* ------------------------------------------------------------------ */

export const submitGatewayRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(1).max(20000),
        modelKey: z.string().min(1),
        idempotencyKey: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }: { data: any; context: any }) => {
    const ws = await resolveWorkspace(context);
    const { runConsoleRequest } = await import("./nexora/gateway.server");
    return runConsoleRequest(context, ws.orgId, data);
  });

/* ------------------------------------------------------------------ */
/* Control-plane registries                                            */
/* ------------------------------------------------------------------ */

export const listControlPlane = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ module: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }: { data: { module: string }; context: any }) => {
    const ws = await resolveWorkspace(context);
    const premiumModuleEntitlement = {
      "mcp-gateway": "mcp_controls",
      "security-tests": "security_tests",
      "attack-simulation": "attack_simulation",
      "ai-discovery": "device_ai_discovery",
    } as const;
    const premiumEntitlement =
      premiumModuleEntitlement[data.module as keyof typeof premiumModuleEntitlement];
    if (premiumEntitlement) await requireOrgEntitlement(ws.orgId, premiumEntitlement);
    const q = (table: string, columns: string) =>
      context.supabase
        .from(table)
        .select(columns)
        .eq("org_id", ws.orgId)
        .order("created_at", { ascending: false })
        .limit(200);
    let query: any;
    switch (data.module) {
      case "agent-registry":
        query = q("agents", "id,name,slug,description,status,credential_expires_at,created_at");
        break;
      case "agent-tools":
        query = q("agent_capabilities", "id,agent_id,capability,created_at,agents(name)");
        break;
      case "mcp-gateway": {
        const result = await q("mcp_servers", "id,name,url,transport,auth_mode,status,created_at");
        if (result.error) throw new Error("MCP servers could not be loaded.");
        const { mcpReadiness, mcpSecretName } = await import("./nexora/mcp.server");
        return {
          workspace: ws,
          module: data.module,
          rows: result.data.map((s: any) => ({
            ...s,
            readiness: mcpReadiness(s),
            secret_name: mcpSecretName(s.id),
          })),
        };
      }
      case "threats":
        query = q("security_findings", "id,title,category,severity,status,created_at,request_id");
        break;
      case "security-tests":
      case "attack-simulation":
        query = q("audit_events", "id,action,result,metadata,created_at").eq(
          "action",
          data.module === "security-tests" ? "security.suite" : "security.simulation",
        );
        break;
      case "latency":
        query = q("requests", "id,model,decision,status,latency_ms,created_at");
        break;
      case "errors":
        query = q("requests", "id,model,decision,status,latency_ms,created_at").in("status", [
          "provider_error",
          "error",
          "failed",
        ]);
        break;
      case "agent-tasks":
        query = q("requests", "id,agent_id,model,decision,status,created_at").eq(
          "actor_type",
          "agent",
        );
        break;
      case "ai-discovery":
        query = q(
          "device_ai_inventory",
          "id,device_label,platform,app_name,vendor,observation_type,version,active,last_seen,created_at",
        );
        break;
      case "integrations": {
        const { providerReadiness } = await import("./ai-gateway.server");
        const result = await q("providers", "id,name,vendor,status");
        if (result.error) throw new Error("Integrations could not be loaded.");
        return {
          workspace: ws,
          module: data.module,
          rows: result.data.map((p: any) => ({ ...p, readiness: providerReadiness(p.vendor) })),
        };
      }
      case "settings":
        return { workspace: ws, module: data.module, rows: [] };
      default:
        throw new Error("Unknown module.");
    }
    const { data: rows, error } = await query;
    if (error) throw new Error("Module data could not be loaded. Please retry.");
    return { workspace: ws, module: data.module, rows: rows ?? [] };
  });

export const createAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(100),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80),
        description: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }: { data: any; context: any }) => {
    const ws = await resolveWorkspace(context);
    if (
      !ws.roles.some((r) =>
        ["platform_admin", "org_admin", "agent_admin", "security_admin"].includes(r),
      )
    ) {
      throw new Error("Forbidden: agent administration role required.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: agent, error } = await (supabaseAdmin as any)
      .from("agents")
      .insert({
        org_id: ws.orgId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        owner_id: context.userId,
        status: "draft",
      })
      .select("id, name, slug, status, created_at")
      .single();
    if (error) throw new Error("Agent could not be created.");
    await writeAudit(context, ws.orgId, {
      action: "agent.created",
      resource: "agent",
      resource_id: agent.id,
      risk: "medium",
      metadata: { slug: agent.slug },
    });
    return agent;
  });

export const runSecurityTests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ adversarial: z.boolean() }).parse(input))
  .handler(async ({ data, context }: { data: { adversarial: boolean }; context: any }) => {
    const ws = await resolveWorkspace(context);
    await requireOrgEntitlement(
      ws.orgId,
      data.adversarial ? "attack_simulation" : "security_tests",
    );
    if (!ws.roles.some((r) => GOV_ROLES.includes(r)))
      throw new Error("Security administration role required.");
    const { data: policies, error } = await context.supabase
      .from("policies")
      .select("*")
      .eq("org_id", ws.orgId)
      .eq("status", "active");
    if (error) throw new Error("Policies could not be loaded.");
    const { runSecuritySuite } = await import("./nexora/security-suite");
    const cases = runSecuritySuite(policies ?? [], data.adversarial);
    const passed = cases.filter((c) => c.passed).length;
    await writeAudit(context, ws.orgId, {
      action: data.adversarial ? "security.simulation" : "security.suite",
      resource: "policy_suite",
      result: passed === cases.length ? "passed" : "failed",
      risk: passed === cases.length ? "info" : "high",
      metadata: {
        suiteVersion: 1,
        scope: "deterministic_policy_only",
        passed,
        total: cases.length,
        cases,
        policies: (policies ?? []).map((p: any) => ({ id: p.id, version: p.version })),
      },
    });
    return { cases, passed, total: cases.length };
  });

const controlMutation = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("agent-status"),
    id: z.string().uuid(),
    status: z.enum(["draft", "suspended", "archived"]),
  }),
  z.object({
    action: z.literal("grant-capability"),
    id: z.string().uuid(),
    capability: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9:._-]+$/),
  }),
  z.object({ action: z.literal("revoke-capability"), id: z.string().uuid() }),
  z.object({
    action: z.literal("register-mcp"),
    authMode: z.enum(["none", "bearer"]).default("bearer"),
    name: z.string().trim().min(2).max(100),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((s) => {
        const u = new URL(s);
        return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
      }, "Use an HTTPS URL without credentials or query parameters."),
  }),
  z.object({ action: z.literal("rename-organization"), name: z.string().trim().min(2).max(100) }),
  z.object({
    action: z.literal("finding-status"),
    id: z.string().uuid(),
    status: z.enum(["open", "resolved"]),
  }),
]);

export type ControlMutation = z.infer<typeof controlMutation>;

export const manageControlPlane = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => controlMutation.parse(input))
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    const allowed =
      data.action === "rename-organization"
        ? ["platform_admin", "org_admin"]
        : data.action === "finding-status"
          ? ["platform_admin", "org_admin", "security_admin"]
          : ["platform_admin", "org_admin", "security_admin", "agent_admin"];
    if (!ws.roles.some((r) => allowed.includes(r)))
      throw new Error("Administration role required.");
    if (data.action === "register-mcp") {
      await requireOrgEntitlement(ws.orgId, "mcp_controls");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    let query: any;
    switch (data.action) {
      case "agent-status":
        query = db
          .from("agents")
          .update({ status: data.status })
          .eq("org_id", ws.orgId)
          .eq("id", data.id);
        break;
      case "grant-capability": {
        const agent = await db
          .from("agents")
          .select("id")
          .eq("org_id", ws.orgId)
          .eq("id", data.id)
          .single();
        if (agent.error || !agent.data) throw new Error("Agent not found in this organization.");
        query = db.from("agent_capabilities").upsert(
          {
            org_id: ws.orgId,
            agent_id: data.id,
            capability: data.capability,
            granted_by: context.userId,
          },
          { onConflict: "agent_id,capability" },
        );
        break;
      }
      case "revoke-capability":
        query = db.from("agent_capabilities").delete().eq("org_id", ws.orgId).eq("id", data.id);
        break;
      case "register-mcp":
        query = db.from("mcp_servers").insert({
          org_id: ws.orgId,
          name: data.name,
          url: data.url,
          status: "draft",
          transport: "http",
          auth_mode: data.authMode,
          created_by: context.userId,
        });
        break;
      case "rename-organization":
        query = db.from("organizations").update({ name: data.name }).eq("id", ws.orgId);
        break;
      case "finding-status":
        query = db
          .from("security_findings")
          .update({ status: data.status })
          .eq("org_id", ws.orgId)
          .eq("id", data.id);
        break;
    }
    const result = await query.select("id");
    if (result.error || !result.data?.length)
      throw new Error("Change could not be saved. The record may no longer exist.");
    await writeAudit(context, ws.orgId, {
      action: `control.${data.action}`,
      resource: data.action,
      resource_id: result.data[0].id,
      result: "success",
    });
    return { saved: true };
  });

export const rotateAgentCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newAgentCredential } = await import("./nexora/agent-credentials");
    const credential = await newAgentCredential();
    const { error } = await (supabaseAdmin as any).rpc("nexora_rotate_agent", {
      p_org: ws.orgId,
      p_agent: data.id,
      p_actor: context.userId,
      p_hash: credential.hash,
      p_prefix: credential.prefix,
    });
    if (error)
      throw new Error(
        "Credential rotation requires an available agent and an administration role.",
      );
    return { token: credential.token };
  });

export const getAgentWorkbench = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ws = await resolveWorkspace(context);
    const db: any = context.supabase;
    const results = await Promise.all([
      db.from("agents").select("id,name,status").eq("org_id", ws.orgId).order("name").limit(200),
      db
        .from("mcp_tools")
        .select("id,server_id,remote_name,description,required_capability,status,risk,input_schema")
        .eq("org_id", ws.orgId)
        .order("tool_name")
        .limit(200),
      db
        .from("mcp_tool_grants")
        .select("id,agent_id,tool_id,requires_approval")
        .eq("org_id", ws.orgId)
        .limit(200),
      db
        .from("tool_invocations")
        .select("id,agent_id,tool_id,status,decision,reason,created_at")
        .eq("org_id", ws.orgId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("models")
        .select("model_key,display_name")
        .eq("org_id", ws.orgId)
        .eq("status", "active")
        .order("display_name"),
    ]);
    if (results.some((r) => r.error)) throw new Error("Agent workbench could not be loaded.");
    return {
      workspace: ws,
      agents: results[0].data,
      tools: results[1].data,
      grants: results[2].data,
      invocations: results[3].data,
      models: results[4].data,
    };
  });

export const executeAgentTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(async (input: unknown) => {
    const { agentTaskInput } = await import("./nexora/agent-input");
    return z.object({ agentId: z.string().uuid(), task: agentTaskInput }).parse(input);
  })
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    if (
      !ws.roles.some((r) =>
        ["platform_admin", "org_admin", "security_admin", "agent_admin"].includes(r),
      )
    )
      throw new Error("Agent administration role required.");
    if (data.task.kind === "tool") {
      await requireOrgEntitlement(ws.orgId, "mcp_controls");
    }
    const { claimAgent, runAgentOperation } = await import("./nexora/agents.server");
    const { data: agent, error } = await context.supabase
      .from("agents")
      .select("id")
      .eq("org_id", ws.orgId)
      .eq("id", data.agentId)
      .single();
    if (error || !agent) throw new Error("Agent not found in this organization.");
    await claimAgent({ id: data.agentId, key: data.task.idempotencyKey, actor: context.userId });
    return runAgentOperation(ws.orgId, data.agentId, data.task);
  });

const toolAdminInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("discover"), serverId: z.string().uuid() }),
  z.object({
    action: z.literal("server-status"),
    serverId: z.string().uuid(),
    status: z.enum(["active", "suspended"]),
  }),
  z.object({
    action: z.literal("tool-status"),
    toolId: z.string().uuid(),
    status: z.enum(["active", "suspended"]),
  }),
  z.object({
    action: z.literal("grant"),
    agentId: z.string().uuid(),
    toolId: z.string().uuid(),
    requiresApproval: z.boolean(),
  }),
  z.object({ action: z.literal("revoke"), grantId: z.string().uuid() }),
]);
export type ToolAdminInput = z.infer<typeof toolAdminInput>;
export const manageAgentTools = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => toolAdminInput.parse(input))
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    await requireOrgEntitlement(ws.orgId, "mcp_controls");
    if (
      !ws.roles.some((r) =>
        ["platform_admin", "org_admin", "security_admin", "agent_admin"].includes(r),
      )
    )
      throw new Error("Agent administration role required.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { checked } = await import("./nexora/gateway.server");
    const db: any = supabaseAdmin;
    if (data.action === "discover")
      return (await import("./nexora/mcp.server")).discoverMcp(
        ws.orgId,
        data.serverId,
        context.userId,
      );
    let query;
    if (data.action === "server-status")
      query = db
        .from("mcp_servers")
        .update({ status: data.status })
        .eq("org_id", ws.orgId)
        .eq("id", data.serverId);
    if (data.action === "tool-status")
      query = db
        .from("mcp_tools")
        .update({ status: data.status })
        .eq("org_id", ws.orgId)
        .eq("id", data.toolId)
        .not("definition_hash", "is", null);
    if (data.action === "revoke")
      query = db.from("mcp_tool_grants").delete().eq("org_id", ws.orgId).eq("id", data.grantId);
    if (data.action === "grant") {
      const agent = await checked(
        db.from("agents").select("id").eq("org_id", ws.orgId).eq("id", data.agentId).single(),
      );
      const tool = await checked(
        db
          .from("mcp_tools")
          .select("id,required_capability")
          .eq("org_id", ws.orgId)
          .eq("id", data.toolId)
          .single(),
      );
      if (!agent || !tool) throw new Error("Agent and tool must belong to this organization.");
      await checked(
        db.from("agent_capabilities").upsert(
          {
            org_id: ws.orgId,
            agent_id: agent.id,
            capability: tool.required_capability,
            granted_by: context.userId,
          },
          { onConflict: "agent_id,capability" },
        ),
      );
      query = db.from("mcp_tool_grants").upsert(
        {
          org_id: ws.orgId,
          agent_id: agent.id,
          tool_id: tool.id,
          requires_approval: data.requiresApproval,
          granted_by: context.userId,
        },
        { onConflict: "agent_id,tool_id" },
      );
    }
    const rows = await checked(query.select("id"));
    if (!rows.length) throw new Error("Record unavailable.");
    await writeAudit(context, ws.orgId, {
      action: `mcp.${data.action}`,
      resource: "mcp",
      resource_id: rows[0].id,
      result: "success",
    });
    return { saved: true };
  });

const connectionScope = z.enum([
  "requests:read",
  "findings:read",
  "policies:read",
  "model:invoke",
  "findings:resolve",
]);

export const inspectAgentConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ code: z.string().regex(/^[A-F0-9]{10}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: connection, error } = await (supabaseAdmin as any)
      .from("agent_connections")
      .select("client_name,scopes,status,expires_at")
      .eq("user_code", data.code)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .single();
    if (error || !connection)
      throw new Error("Connection code is invalid, expired, or already used.");
    return { workspace: ws, connection };
  });

export const consentAgentConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        code: z.string().regex(/^[A-F0-9]{10}$/),
        allow: z.boolean(),
        scopes: z.array(connectionScope).max(5),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).rpc("nexora_consent_connection", {
      p_code: data.code,
      p_org: ws.orgId,
      p_actor: context.userId,
      p_allow: data.allow,
      p_scopes: [...new Set(data.scopes)],
    });
    if (error)
      throw new Error(
        "Permission could not be granted. Check your role or request a new connection code.",
      );
    return { approved: data.allow };
  });

export const connectAgentDirect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(80),
        scopes: z.array(connectionScope).min(1).max(5),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    const { startAgentConnection, exchangeAgentConnection } =
      await import("./nexora/connections.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scopes = [...new Set(data.scopes)];
    const connection = await startAgentConnection(data.name, scopes);
    const { error } = await (supabaseAdmin as any).rpc("nexora_consent_connection", {
      p_code: connection.user_code,
      p_org: ws.orgId,
      p_actor: context.userId,
      p_allow: true,
      p_scopes: scopes,
    });
    if (error) throw new Error("Your role cannot grant the selected permissions.");
    const result = await exchangeAgentConnection(connection.device_code);
    if (result.error) throw new Error("Connection could not be completed.");
    return result as {
      access_token: string;
      agent_id: string;
      scope: string;
      expires_in: number;
    };
  });

export const listAgentConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ws = await resolveWorkspace(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [agents, usage] = await Promise.all([
      context.supabase
        .from("agents")
        .select("id,name,owner_id,status,credential_expires_at,created_at" as any)
        .eq("org_id", ws.orgId)
        .order("created_at", { ascending: false })
        .limit(200),
      (supabaseAdmin as any).rpc("nexora_agent_usage", { p_org: ws.orgId }),
    ]);
    if (agents.error || usage.error) throw new Error("Connections could not be loaded.");
    const activity = new Map<
      string,
      {
        requests: number;
        costUsd: number;
        inputTokens: number;
        outputTokens: number;
        lastUsedAt: string | null;
      }
    >();
    for (const row of (usage.data ?? []) as any[]) {
      if (!row.agent_id) continue;
      const entry = activity.get(row.agent_id) ?? {
        requests: 0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        lastUsedAt: null,
      };
      entry.requests = Number(row.request_count ?? 0);
      entry.costUsd = Number(row.cost_usd ?? 0);
      entry.inputTokens = Number(row.input_tokens ?? 0);
      entry.outputTokens = Number(row.output_tokens ?? 0);
      entry.lastUsedAt = row.last_used_at ?? null;
      activity.set(row.agent_id, entry);
    }
    return {
      workspace: ws,
      userId: context.userId,
      agents: ((agents.data ?? []) as any[]).map((agent) => ({
        ...agent,
        usage: activity.get(agent.id) ?? {
          requests: 0,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          lastUsedAt: null,
        },
      })),
    };
  });

export const disconnectAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).rpc("nexora_revoke_connection", {
      p_org: ws.orgId,
      p_agent: data.id,
      p_actor: context.userId,
    });
    if (error)
      throw new Error("Only the connection owner or an administrator may disconnect this agent.");
    return { disconnected: true };
  });

export const getBillingState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ws = await resolveWorkspace(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db: any = supabaseAdmin;
    const [subscription, usage] = await Promise.all([
      db
        .from("billing_subscriptions")
        .select(
          "plan_key,status,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end",
        )
        .eq("org_id", ws.orgId)
        .single(),
      db.rpc("nexora_billing_usage", { p_org: ws.orgId }),
    ]);
    if (subscription.error || usage.error) throw new Error("Billing status could not be loaded.");
    return {
      workspace: ws,
      subscription: subscription.data,
      usage: {
        seats: Number(usage.data?.seats ?? 0),
        agents: Number(usage.data?.agents ?? 0),
        mcpServers: Number(usage.data?.mcp_servers ?? 0),
        requests: Number(usage.data?.requests ?? 0),
      },
    };
  });

export const getPaddleCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        plan: z.enum(["solo", "team"]),
        interval: z.enum(["monthly", "annual"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    if (!ws.roles.some((role) => ["platform_admin", "org_admin"].includes(role)))
      throw new Error("Organization administrator role required for billing changes.");
    const { createCheckoutConfig } = await import("./paddle.server");
    const config = createCheckoutConfig(ws.orgId, context.userId, data.plan, data.interval);
    return config ?? { enabled: false as const, reason: "PADDLE_NOT_CONFIGURED" as const };
  });

/* ------------------------------------------------------------------ */
/* Live execution control                                              */
/* ------------------------------------------------------------------ */

export const getLiveExecutionControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        executionId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(12),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ws = await resolveWorkspace(context);
    const db: any = context.supabase;
    let eventsQuery = db
      .from("execution_events")
      .select(
        "id,execution_id,request_id,agent_id,actor_type,stage,status,summary,detail,created_at",
      )
      .eq("org_id", ws.orgId)
      .order("created_at", { ascending: false })
      .limit(data.executionId ? 200 : Math.min(500, data.limit * 20));
    if (data.executionId) eventsQuery = eventsQuery.eq("execution_id", data.executionId);

    const [events, agents, controls] = await Promise.all([
      eventsQuery,
      db.from("agents").select("id,name,slug,status").eq("org_id", ws.orgId),
      db
        .from("org_ai_controls")
        .select("execution_enabled,console_enabled,agents_enabled,max_request_cost_usd,updated_at")
        .eq("org_id", ws.orgId)
        .maybeSingle(),
    ]);
    if (events.error || agents.error || controls.error)
      throw new Error("Live execution control could not be loaded.");

    const agentMap = new Map((agents.data ?? []).map((a: any) => [a.id, a]));
    const grouped = new Map<string, any>();
    for (const event of events.data ?? []) {
      const key = String(event.execution_id);
      const current = grouped.get(key) ?? {
        executionId: key,
        requestId: event.request_id ?? null,
        actorType: event.actor_type,
        agent: event.agent_id ? (agentMap.get(event.agent_id) ?? null) : null,
        latestAt: event.created_at,
        stages: [],
      };
      current.requestId = current.requestId ?? event.request_id ?? null;
      current.latestAt =
        new Date(event.created_at).getTime() > new Date(current.latestAt).getTime()
          ? event.created_at
          : current.latestAt;
      current.stages.push(event);
      grouped.set(key, current);
    }

    const executions = [...grouped.values()]
      .map((execution) => ({
        ...execution,
        stages: execution.stages.sort(
          (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
      }))
      .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
      .slice(0, data.limit);

    return {
      workspace: ws,
      controls: controls.data ?? {
        execution_enabled: true,
        console_enabled: true,
        agents_enabled: true,
        max_request_cost_usd: null,
        updated_at: null,
      },
      executions,
    };
  });

const aiAdminMutation = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("global-controls"),
    executionEnabled: z.boolean(),
    consoleEnabled: z.boolean(),
    agentsEnabled: z.boolean(),
    maxRequestCostUsd: z.number().min(0).max(100000).nullable(),
  }),
  z.object({
    action: z.literal("provider-status"),
    id: z.string().uuid(),
    status: z.enum(["active", "suspended"]),
  }),
  z.object({
    action: z.literal("model-status"),
    id: z.string().uuid(),
    status: z.enum(["active", "suspended"]),
  }),
  z.object({
    action: z.literal("agent-status"),
    id: z.string().uuid(),
    status: z.enum(["active", "suspended"]),
  }),
  z.object({
    action: z.literal("budget-limit"),
    id: z.string().uuid(),
    limitUsd: z.number().min(0).max(100000000),
  }),
]);

export type AiAdminMutation = z.infer<typeof aiAdminMutation>;

export const getAdminAiControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: { context: any }) => {
    const ws = await resolveWorkspace(context);
    const db: any = context.supabase;
    const canControl = ws.roles.some((role) => ["platform_admin", "org_admin"].includes(role));
    if (!canControl) throw new Error("Organization administrator role required.");

    const [controls, providers, models, agents, budgets] = await Promise.all([
      db.from("org_ai_controls").select("*").eq("org_id", ws.orgId).maybeSingle(),
      db
        .from("providers")
        .select("id,name,vendor,status,credential_state")
        .eq("org_id", ws.orgId)
        .order("name"),
      db
        .from("models")
        .select("id,model_key,display_name,classification,status,provider_id")
        .eq("org_id", ws.orgId)
        .order("display_name"),
      db
        .from("agents")
        .select("id,name,slug,status,last_used_at")
        .eq("org_id", ws.orgId)
        .order("name"),
      db
        .from("budgets")
        .select("id,name,limit_usd,action_on_exceed,status")
        .eq("org_id", ws.orgId)
        .order("name"),
    ]);
    if ([controls, providers, models, agents, budgets].some((result) => result.error))
      throw new Error("AI administration controls could not be loaded.");

    return {
      workspace: ws,
      controls: controls.data ?? {
        execution_enabled: true,
        console_enabled: true,
        agents_enabled: true,
        max_request_cost_usd: null,
      },
      providers: providers.data ?? [],
      models: models.data ?? [],
      agents: agents.data ?? [],
      budgets: budgets.data ?? [],
    };
  });

export const updateAdminAiControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => aiAdminMutation.parse(input))
  .handler(async ({ data, context }: { data: AiAdminMutation; context: any }) => {
    const ws = await resolveWorkspace(context);
    if (!ws.roles.some((role) => ["platform_admin", "org_admin"].includes(role)))
      throw new Error("Organization administrator role required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db: any = supabaseAdmin;
    let result: any;

    switch (data.action) {
      case "global-controls":
        result = await db
          .from("org_ai_controls")
          .upsert(
            {
              org_id: ws.orgId,
              execution_enabled: data.executionEnabled,
              console_enabled: data.consoleEnabled,
              agents_enabled: data.agentsEnabled,
              max_request_cost_usd: data.maxRequestCostUsd,
              updated_by: context.userId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "org_id" },
          )
          .select("org_id")
          .single();
        break;
      case "provider-status":
        result = await db
          .from("providers")
          .update({ status: data.status })
          .eq("org_id", ws.orgId)
          .eq("id", data.id)
          .select("id")
          .single();
        break;
      case "model-status":
        result = await db
          .from("models")
          .update({ status: data.status })
          .eq("org_id", ws.orgId)
          .eq("id", data.id)
          .select("id")
          .single();
        break;
      case "agent-status":
        result = await db
          .from("agents")
          .update({ status: data.status })
          .eq("org_id", ws.orgId)
          .eq("id", data.id)
          .neq("status", "archived")
          .select("id")
          .single();
        break;
      case "budget-limit":
        result = await db
          .from("budgets")
          .update({ limit_usd: data.limitUsd })
          .eq("org_id", ws.orgId)
          .eq("id", data.id)
          .select("id")
          .single();
        break;
    }

    if (result.error || !result.data) throw new Error("AI control change could not be saved.");

    await writeAudit(context, ws.orgId, {
      action: `admin.ai_control.${data.action}`,
      resource: "ai_control",
      resource_id: "id" in data ? data.id : ws.orgId,
      risk: data.action === "global-controls" && !data.executionEnabled ? "high" : "medium",
      metadata:
        data.action === "global-controls"
          ? {
              executionEnabled: data.executionEnabled,
              consoleEnabled: data.consoleEnabled,
              agentsEnabled: data.agentsEnabled,
              maxRequestCostUsd: data.maxRequestCostUsd,
            }
          : data.action === "budget-limit"
            ? { limitUsd: data.limitUsd }
            : { status: data.status },
    });

    return { saved: true };
  });
