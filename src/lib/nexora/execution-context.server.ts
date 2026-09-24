import type { PipelineTraceEvent } from "./pipeline";
import { writeExecutionEvent } from "./execution-trace.server";

export function makeExecutionTrace(input: {
  orgId: string;
  executionId: string;
  actorType: "agent" | "user";
  agentId?: string;
}) {
  return (event: PipelineTraceEvent) =>
    writeExecutionEvent({
      orgId: input.orgId,
      executionId: input.executionId,
      actorType: input.actorType,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      stage: event.stage,
      status: event.status,
      summary: event.summary,
      ...(event.detail ? { detail: event.detail } : {}),
      requestId: event.requestId ?? null,
    });
}
