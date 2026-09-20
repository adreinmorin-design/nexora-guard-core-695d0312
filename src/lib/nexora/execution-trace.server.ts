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
    detail: event.detail ?? {},
  });
  if (error) throw new Error("Execution trace persistence unavailable.");
}

export function safeExecutionDetail(input: Record<string, unknown> = {}): Record<string, unknown> {
  const forbidden = new Set([
    "prompt",
    "rawPrompt",
    "response",
    "token",
    "authorization",
    "credential",
    "apiKey",
    "secret",
  ]);
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !forbidden.has(key))
      .slice(0, 20),
  );
}
