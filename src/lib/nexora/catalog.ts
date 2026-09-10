/** Seed catalog for a newly provisioned NEXORA organization. */

export const SEED_PROVIDERS = [
  { name: "OpenAI", vendor: "openai", credential_state: "MANAGED", region: "global" },
  { name: "Google", vendor: "google", credential_state: "MANAGED", region: "global" },
  { name: "Anthropic", vendor: "anthropic", credential_state: "NOT_CONFIGURED", region: "global" },
] as const;

export const SEED_MODELS: Array<{
  vendor: string;
  model_key: string;
  display_name: string;
  context_window: number;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  classification: string;
  status: "active" | "draft";
}> = [
  {
    vendor: "openai",
    model_key: "openai/gpt-5.4-mini",
    display_name: "GPT-5.4 Mini",
    context_window: 400000,
    input_cost_per_1k: 0.00025,
    output_cost_per_1k: 0.002,
    classification: "standard",
    status: "active",
  },
  {
    vendor: "openai",
    model_key: "openai/gpt-5.5",
    display_name: "GPT-5.5",
    context_window: 400000,
    input_cost_per_1k: 0.00125,
    output_cost_per_1k: 0.01,
    classification: "frontier",
    status: "active",
  },
  {
    vendor: "google",
    model_key: "google/gemini-3.8-flash",
    display_name: "Gemini 3.8 Flash",
    context_window: 1000000,
    input_cost_per_1k: 0.0003,
    output_cost_per_1k: 0.0025,
    classification: "standard",
    status: "active",
  },
  {
    vendor: "google",
    model_key: "google/gemini-3.1-flash-lite",
    display_name: "Gemini 3.1 Flash Lite",
    context_window: 1000000,
    input_cost_per_1k: 0.0001,
    output_cost_per_1k: 0.0004,
    classification: "economy",
    status: "active",
  },
];

export const SEED_POLICIES = [
  {
    name: "Restricted Data Protection",
    description: "Blocks government and payment identifiers from leaving the tenant boundary.",
    priority: 10,
    action: "BLOCK" as const,
    scope: "organization",
    conditions: [
      { field: "detection_category", op: "in", value: ["ssn", "credit_card", "iban"] },
    ],
  },
  {
    name: "Secret Egress Prevention",
    description: "Blocks credentials, keys and connection strings in prompts and responses.",
    priority: 20,
    action: "BLOCK" as const,
    scope: "organization",
    conditions: [
      {
        field: "detection_category",
        op: "in",
        value: ["api_key", "private_key", "connection_string", "jwt", "password"],
      },
    ],
  },
  {
    name: "Prompt Injection Containment",
    description: "Routes suspected injection and extraction attempts to human approval.",
    priority: 30,
    action: "REQUIRE_APPROVAL" as const,
    scope: "organization",
    conditions: [
      {
        field: "detection_category",
        op: "in",
        value: ["prompt_injection", "system_prompt_extraction", "data_exfiltration"],
      },
    ],
  },
  {
    name: "PII Redaction",
    description: "Redacts contact-level personal data before provider execution.",
    priority: 50,
    action: "REDACT" as const,
    scope: "organization",
    conditions: [
      { field: "detection_category", op: "in", value: ["email", "phone", "ip_address"] },
    ],
  },
  {
    name: "Frontier Model Spend Control",
    description: "Requires approval for frontier models once monthly spend passes the threshold.",
    priority: 60,
    action: "REQUIRE_APPROVAL" as const,
    scope: "organization",
    conditions: [
      { field: "model_classification", op: "equals", value: "frontier" },
      { field: "monthly_spend_usd", op: "gt", value: 25 },
    ],
  },
  {
    name: "Baseline Traffic Logging",
    description: "Unconditional audit logging for every governed request.",
    priority: 900,
    action: "LOG" as const,
    scope: "organization",
    conditions: [],
  },
];
