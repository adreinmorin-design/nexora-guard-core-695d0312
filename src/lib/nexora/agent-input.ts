import { z } from "zod";

export const agentTaskInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("read"),
      resource: z.enum(["requests", "findings", "policies", "status"]),
      limit: z.number().int().min(1).max(100).default(50),
      idempotencyKey: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("finding"),
      findingId: z.string().uuid(),
      status: z.enum(["open", "resolved"]),
      idempotencyKey: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("model"),
      modelKey: z.string().min(1).max(200),
      prompt: z.string().min(1).max(20000),
      idempotencyKey: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool"),
      toolId: z.string().uuid(),
      arguments: z
        .record(z.unknown())
        .refine((v) => JSON.stringify(v).length <= 20000, "Tool arguments exceed the limit."),
      idempotencyKey: z.string().uuid(),
    })
    .strict(),
]);
export type AgentTaskInput = z.infer<typeof agentTaskInput>;

export async function readLimitedJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("JSON body required.");
  if (!request.body) throw new Error("Request body required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      size += value?.byteLength ?? 0;
      if (size > 32768) throw new Error("Request body exceeds 32 KiB.");
      text += decoder.decode(value, { stream: !done });
      if (done) break;
    }
    return JSON.parse(text);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function readAgentBody(request: Request) {
  return agentTaskInput.parse(await readLimitedJson(request));
}
