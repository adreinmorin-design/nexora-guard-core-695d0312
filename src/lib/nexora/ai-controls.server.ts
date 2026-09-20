import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AiControlState = {
  execution_enabled: boolean;
  console_enabled: boolean;
  agents_enabled: boolean;
  max_request_cost_usd: number | null;
};

const DEFAULTS: AiControlState = {
  execution_enabled: true,
  console_enabled: true,
  agents_enabled: true,
  max_request_cost_usd: null,
};

export async function getAiControlState(orgId: string): Promise<AiControlState> {
  const { data, error } = await (supabaseAdmin as any)
    .from("org_ai_controls")
    .select("execution_enabled,console_enabled,agents_enabled,max_request_cost_usd")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error("AI control state could not be verified.");
  if (!data) return DEFAULTS;
  return {
    execution_enabled: Boolean(data.execution_enabled),
    console_enabled: Boolean(data.console_enabled),
    agents_enabled: Boolean(data.agents_enabled),
    max_request_cost_usd:
      data.max_request_cost_usd == null ? null : Number(data.max_request_cost_usd),
  };
}

export async function requireAiExecutionAllowed(
  orgId: string,
  actorType: "agent" | "user",
): Promise<AiControlState> {
  const state = await getAiControlState(orgId);
  if (!state.execution_enabled) throw new Error("AI execution is suspended by an organization administrator.");
  if (actorType === "agent" && !state.agents_enabled)
    throw new Error("Agent execution is suspended by an organization administrator.");
  if (actorType === "user" && !state.console_enabled)
    throw new Error("Console execution is suspended by an organization administrator.");
  return state;
}
