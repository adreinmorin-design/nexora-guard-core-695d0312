export type PlanKey = "solo" | "team" | "enterprise";

export type PlanBenefit = {
  title: string;
  description: string;
  delivery?: "included" | "contracted";
};

export type PlanSetupStep = {
  title: string;
  description: string;
  href: string;
};

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
  guide: {
    headline: string;
    benefits: PlanBenefit[];
    setup: PlanSetupStep[];
  };
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
    guide: {
      headline: "Core AI governance for a single operator.",
      benefits: [
        {
          title: "Governed AI gateway",
          description: "Route model traffic through server-side policy, tenant and budget checks.",
        },
        {
          title: "PII and secret protection",
          description: "Detect and redact sensitive data before governed requests leave NEXORA.",
        },
        {
          title: "Policy and budget controls",
          description: "Apply deterministic rules, request limits and organization budgets.",
        },
        {
          title: "Agent governance",
          description: "Connect and govern up to 3 AI agents with one MCP server.",
        },
        {
          title: "Audit visibility",
          description: "Keep 30 days of governed request and security history.",
        },
      ],
      setup: [
        {
          title: "Run your first governed request",
          description: "Verify routing, policy decisions and redaction in the Playground.",
          href: "/gateway/playground",
        },
        {
          title: "Review your baseline policies",
          description: "Tune the rules NEXORA applies before provider egress.",
          href: "/governance/policies",
        },
        {
          title: "Set your budget",
          description: "Choose the monthly spend guardrail for your organization.",
          href: "/governance/budgets",
        },
      ],
    },
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
      "Device AI discovery for enrolled endpoints",
      "10 operator seats and 25 agents",
      "180-day audit retention",
    ],
    guide: {
      headline: "Collaborative controls for teams running AI in production.",
      benefits: [
        {
          title: "Human approval workflows",
          description: "Route higher-risk AI actions to people before execution.",
        },
        {
          title: "MCP discovery and tool controls",
          description: "Discover tools, grant capabilities and govern which agents can use them.",
        },
        {
          title: "Security testing",
          description:
            "Use the security test suite and attack simulation workflows to validate controls.",
        },
        {
          title: "Team-scale access",
          description: "Support up to 10 operator seats, 25 agents and 10 MCP servers.",
        },
        {
          title: "Higher request capacity",
          description: "Govern up to 250,000 requests per month with 180-day audit retention.",
        },
      ],
      setup: [
        {
          title: "Add your operators",
          description: "Invite the people who will administer, approve and review AI activity.",
          href: "/admin/users",
        },
        {
          title: "Connect production agents",
          description: "Issue governed identities and scopes for your AI agents.",
          href: "/connect-agent",
        },
        {
          title: "Configure MCP controls",
          description: "Register MCP servers, discover tools and assign approved capabilities.",
          href: "/module/mcp-gateway",
        },
        {
          title: "Run security tests",
          description: "Validate your policies before expanding AI usage.",
          href: "/module/security-tests",
        },
        {
          title: "Enroll endpoint discovery",
          description:
            "Use an enrolled NEXORA agent to report recognized AI desktop apps and local runtimes.",
          href: "/module/ai-discovery",
        },
      ],
    },
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
    guide: {
      headline: "Contracted deployment, identity and integration options for larger organizations.",
      benefits: [
        {
          title: "Contracted scale and retention",
          description:
            "Set organization-specific capacity, seat, agent and retention requirements.",
          delivery: "contracted",
        },
        {
          title: "Enterprise identity and provisioning",
          description: "Plan SSO and enterprise identity requirements during implementation.",
          delivery: "contracted",
        },
        {
          title: "SIEM and incident delivery",
          description: "Integrate security and operational events with enterprise workflows.",
          delivery: "contracted",
        },
        {
          title: "Regional or dedicated deployment",
          description: "Define deployment requirements around region, isolation and operations.",
          delivery: "contracted",
        },
        {
          title: "Implementation and priority support",
          description: "Coordinate rollout, controls and support around your organization.",
          delivery: "contracted",
        },
      ],
      setup: [
        {
          title: "Review users and roles",
          description: "Map administrator, security and governance responsibilities.",
          href: "/admin/users",
        },
        {
          title: "Review integrations",
          description: "Identify the external systems that should connect to NEXORA.",
          href: "/module/integrations",
        },
        {
          title: "Review audit requirements",
          description: "Confirm the events and retention your compliance workflows require.",
          href: "/audit",
        },
      ],
    },
  },
] as const;

export const planByKey = (key: string | null | undefined): Plan =>
  PLANS.find((plan) => plan.key === key) ?? PLANS[1]!;

export function formatLimit(value: number | null): string {
  return value === null ? "Contracted" : new Intl.NumberFormat("en-US").format(value);
}
