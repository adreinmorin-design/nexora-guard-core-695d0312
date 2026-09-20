import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ENTITLEMENT_LABELS,
  planAllowsEntitlement,
  type EntitlementKey,
  type EntitlementPlan,
} from "./entitlements";

type SubscriptionRow = {
  plan_key: EntitlementPlan;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  trial_ends_at: string | null;
};

export type EntitlementState = {
  plan: EntitlementPlan;
  status: SubscriptionRow["status"];
  active: boolean;
};

export async function getOrgEntitlementState(orgId: string): Promise<EntitlementState> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_subscriptions")
    .select("plan_key,status,trial_ends_at")
    .eq("org_id", orgId)
    .single();

  if (error || !data) throw new Error("Subscription state could not be verified.");

  const row = data as SubscriptionRow;
  const active =
    row.status === "active" ||
    (row.status === "trialing" &&
      Boolean(row.trial_ends_at) &&
      Date.parse(row.trial_ends_at as string) > Date.now());

  return { plan: row.plan_key, status: row.status, active };
}

export async function requireOrgEntitlement(
  orgId: string,
  entitlement: EntitlementKey,
): Promise<EntitlementState> {
  const state = await getOrgEntitlementState(orgId);
  if (!state.active) {
    throw new Error("An active NEXORA subscription is required for this feature.");
  }
  if (!planAllowsEntitlement(state.plan, entitlement)) {
    throw new Error(
      `${ENTITLEMENT_LABELS[entitlement]} requires the Team or Enterprise tier.`,
    );
  }
  return state;
}
