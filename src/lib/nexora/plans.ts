export type PlanKey = "solo" | "team" | "enterprise";

export type Plan = {
  key: PlanKey;
  name: string;
  audience: string;
  monthlyPriceUsd: number | null;
  annualPriceUsd: number | null;
  seats: number | null;
  agents: number | null;
  monthlyRequests: number | null;
  mcpServers: number | null;
  auditRetentionDays: number | null;
  featured?: boolean;
  features: string[];
};

export const PLANS: readonly Plan[] = [
  {
    key: "solo",
    name: "Solo",
    audience: "Independent consultants and small businesses",
    monthlyPriceUsd: 49,
    annualPriceUsd: 490,
    seats: 1,
    agents: 3,
    monthlyRequests: 25_000,
    mcpServers: 1,
    auditRetentionDays: 30,
    features: [
      "Deterministic policy enforcement",
      "PII and secret redaction",
      "Budgets and request audit",
      "3 governed agents",
      "30-day audit retention",
    ],
  },
  {
    key: "team",
    name: "Team",
    audience: "Growing product and security teams",
    monthlyPriceUsd: 249,
    annualPriceUsd: 2_490,
    seats: 10,
    agents: 25,
    monthlyRequests: 250_000,
    mcpServers: 10,
    auditRetentionDays: 180,
    featured: true,
    features: [
      "Everything in Solo",
      "Human approval workflows",
      "MCP discovery and tool controls",
      "Security test suite",
      "10 operator seats and 25 agents",
      "180-day audit retention",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    audience: "Organizations with compliance and deployment requirements",
    monthlyPriceUsd: 1_500,
    annualPriceUsd: null,
    seats: null,
    agents: null,
    monthlyRequests: null,
    mcpServers: null,
    auditRetentionDays: null,
    features: [
      "Everything in Team",
      "Contracted usage and retention",
      "Enterprise identity and provisioning",
      "SIEM and incident-delivery integration",
      "Regional or dedicated deployment options",
      "Implementation and priority support",
    ],
  },
] as const;

export const planByKey = (key: string | null | undefined): Plan =>
  PLANS.find((plan) => plan.key === key) ?? PLANS[1]!;

export function formatLimit(value: number | null): string {
  return value === null ? "Contracted" : new Intl.NumberFormat("en-US").format(value);
}
