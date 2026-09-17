import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeProviderRequest, providerReadiness } from "../ai-gateway.server";
import { runGovernedRequest, type GatewayStore } from "./pipeline";
import type { PolicyRecord } from "./policy-engine";

// Every query is checked. Supabase returns errors as values, not exceptions.
export async function checked(query: PromiseLike<any>): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error("Gateway persistence unavailable; request stopped.");
  return data;
}

export function makeStore(context: any, orgId: string): GatewayStore {
  const db = context.supabase;
  const admin: any = supabaseAdmin;
  const scoped = (id: string) => {
    if (id !== orgId) throw new Error("Invalid workspace.");
  };
  return {
    async getModel(id, key) {
      scoped(id);
      const row = await checked(
        db
          .from("models")
          .select("*, providers(vendor, status, org_id)")
          .eq("org_id", id)
          .eq("model_key", key)
          .maybeSingle(),
      );
      if (!row) return null;
      if (row.providers?.org_id !== id) throw new Error("Invalid provider workspace.");
      return {
        ...row,
        provider_vendor: row.providers.vendor,
        provider_status: row.providers.status,
        provider_credential_state: providerReadiness(row.providers.vendor),
      };
    },
    async monthlySpend(id) {
      scoped(id);
      return Number(await checked(admin.rpc("nexora_monthly_spend", { p_org: id })));
    },
    async listPolicies(id) {
      scoped(id);
      return checked(
        db
          .from("policies")
          .select("id, name, description, priority, action, version, status, scope, conditions")
          .eq("org_id", id)
          .order("id"),
      );
    },
    async listBudgets(id) {
      scoped(id);
      return checked(db.from("budgets").select("*").eq("org_id", id).eq("status", "active"));
    },
    async findRequestByIdempotencyKey(id, key) {
      scoped(id);
      return checked(
        db.from("requests").select("id").eq("org_id", id).eq("idempotency_key", key).maybeSingle(),
      );
    },
    async insertRequest(row) {
      scoped(String(row["org_id"]));
      return checked(admin.from("requests").insert(row).select("id").single());
    },
    async insertFindings(rows) {
      rows.forEach((r) => scoped(String(r["org_id"])));
      await checked(admin.from("security_findings").insert(rows));
    },
    async insertApproval(row) {
      scoped(String(row["org_id"]));
      return checked(admin.from("approvals").insert(row).select("id").single());
    },
    async insertAudit(row) {
      scoped(String(row["org_id"]));
      await checked(admin.from("audit_events").insert(row));
    },
    async reserve(id, key, cost) {
      scoped(id);
      return checked(
        admin.rpc("nexora_reserve", {
          p_org: id,
          p_key: key,
          p_cost: cost,
        }),
      );
    },
    async settle(id, key) {
      scoped(id);
      await checked(admin.rpc("nexora_settle", { p_org: id, p_key: key }));
    },
  };
}

export async function runConsoleRequest(
  context: any,
  orgId: string,
  input: { prompt: string; modelKey: string; idempotencyKey?: string },
  approvedPolicies?: PolicyRecord[],
) {
  const memberships = await checked(
    context.supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", context.userId),
  );
  if (
    !memberships.some((m: any) =>
      [
        "platform_admin",
        "org_admin",
        "governance_admin",
        "security_admin",
        "developer",
        "agent_admin",
      ].includes(m.role),
    )
  ) {
    throw new Error("This role cannot execute gateway requests.");
  }
  return runGovernedRequest({
    store: makeStore(context, orgId),
    principal: { kind: "user", id: context.userId, orgId, source: "console" },
    ...input,
    ...(approvedPolicies ? { approvedPolicies } : {}),
    execute: executeProviderRequest,
  });
}

export async function decideAndExecute(
  context: any,
  orgId: string,
  id: string,
  decision: "approved" | "rejected",
) {
  // RPC atomically checks role, requester, expiry and current status.
  const admin: any = supabaseAdmin;
  const approval = await checked(
    admin.rpc("nexora_decide_approval", {
      p_org: orgId,
      p_id: id,
      p_actor: context.userId,
      p_decision: decision,
    }),
  );
  if (decision === "rejected") return { ok: true };
  const payload = approval.payload;
  if (approval.action === "mcp.execute") {
    const { executeApprovedTool } = await import("./mcp.server");
    try {
      const outcome = await executeApprovedTool(orgId, id, payload);
      await checked(
        admin
          .from("approvals")
          .update({ execution_result: outcome.status })
          .eq("org_id", orgId)
          .eq("id", id),
      );
      return { ok: true, outcome };
    } catch {
      await checked(
        admin
          .from("approvals")
          .update({ execution_result: "failed_no_retry" })
          .eq("org_id", orgId)
          .eq("id", id),
      );
      throw new Error("Approved tool execution failed; inspect its task record before retrying.");
    }
  }
  if (
    typeof payload?.prompt !== "string" ||
    !payload.prompt.length ||
    payload.prompt.length > 20000 ||
    typeof payload?.modelKey !== "string" ||
    !Array.isArray(payload?.policies)
  ) {
    await checked(
      admin
        .from("approvals")
        .update({ execution_result: "resubmit_required" })
        .eq("id", id)
        .eq("org_id", orgId),
    );
    throw new Error("Legacy approval has no executable payload. Submit a new request.");
  }
  try {
    // Policies are reloaded; only unchanged approval policies may be satisfied.
    // Budget admission and response policies are never waived by approval.
    const input = {
      prompt: payload.prompt,
      modelKey: payload.modelKey,
      idempotencyKey: id,
    };
    const outcome = payload.agentId
      ? await (
          await import("./agents.server")
        ).executeAgentModel(orgId, payload.agentId, input, payload.policies)
      : await runConsoleRequest(
          { supabase: admin, userId: approval.requester_id },
          orgId,
          input,
          payload.policies,
        );
    await checked(
      admin
        .from("approvals")
        .update({ execution_result: outcome.status })
        .eq("org_id", orgId)
        .eq("id", id),
    );
    return { ok: true, outcome };
  } catch {
    await checked(
      admin
        .from("approvals")
        .update({ execution_result: "failed_no_retry" })
        .eq("org_id", orgId)
        .eq("id", id),
    );
    throw new Error("Approved execution failed. Inspect request status before submitting again.");
  }
}
