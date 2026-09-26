import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ExecutionStage =
  | "identity"
  | "permissions"
  | "pii"
  | "injection"
  | "budget"
  | "provider_selection"
  | "tool_authorization"
  | "execution"
  | "audit";

export type ExecutionStageStatus =
  | "pending"
  | "running"
  | "passed"
  | "blocked"
  | "redacted"
  | "not_applicable"
  | "failed"
  | "completed";

export type ExecutionTraceEvent = {
  orgId: string;
  executionId: string;
  requestId?: string | null;
  agentId?: string | null;
  actorType: "agent" | "user";
  stage: ExecutionStage;
  status: ExecutionStageStatus;
  summary: string;
  detail?: Record<string, unknown>;
};

const FORBIDDEN_DETAIL_KEYS = new Set([
  "prompt",
  "rawprompt",
  "response",
  "rawresponse",
  "token",
  "tokens",
  "authorization",
  "credential",
  "credentials",
  "apikey",
  "secret",
  "password",
  "cookie",
]);
const MAX_DETAIL_DEPTH = 4;
const MAX_DETAIL_ENTRIES = 50;

function sanitizeDetailValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DETAIL_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") return value.slice(0, 500);
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_DETAIL_ENTRIES).map((item) => sanitizeDetailValue(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(
    0,
    MAX_DETAIL_ENTRIES,
  )) {
    if (FORBIDDEN_DETAIL_KEYS.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) continue;
    output[key] = sanitizeDetailValue(item, depth + 1);
  }
  return output;
}

export async function writeExecutionEvent(event: ExecutionTraceEvent): Promise<void> {
  const { error } = await (supabaseAdmin as any).from("execution_events").insert({
    org_id: event.orgId,
    execution_id: event.executionId,
    request_id: event.requestId ?? null,
    agent_id: event.agentId ?? null,
    actor_type: event.actorType,
    stage: event.stage,
    status: event.status,
    summary: event.summary.slice(0, 300),
    detail: event.detail ? safeExecutionDetail(event.detail) : {},
  });
  if (error) throw new Error("Execution trace persistence unavailable.");
}

export function safeExecutionDetail(input: Record<string, unknown> = {}): Record<string, unknown> {
  return sanitizeDetailValue(input, 0) as Record<string, unknown>;
}
