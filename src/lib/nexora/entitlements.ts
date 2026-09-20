export type EntitlementKey =
  | "human_approvals"
  | "mcp_controls"
  | "security_tests"
  | "attack_simulation"
  | "device_ai_discovery";

export type EntitlementPlan = "solo" | "team" | "enterprise";

const TEAM_AND_ABOVE = new Set<EntitlementKey>([
  "human_approvals",
  "mcp_controls",
  "security_tests",
  "attack_simulation",
  "device_ai_discovery",
]);

export function planAllowsEntitlement(plan: EntitlementPlan, entitlement: EntitlementKey): boolean {
  if (plan === "enterprise") return true;
  if (plan === "team") return TEAM_AND_ABOVE.has(entitlement);
  return false;
}

export const ENTITLEMENT_LABELS: Record<EntitlementKey, string> = {
  human_approvals: "Human approval workflows",
  mcp_controls: "MCP discovery and tool controls",
  security_tests: "Security test suite",
  attack_simulation: "Attack simulation",
  device_ai_discovery: "Device AI discovery",
};
