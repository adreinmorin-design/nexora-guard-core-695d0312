/**
 * Provider execution layer. Runs server-side only; provider credentials are
 * never exposed to the browser and never returned to the client.
 */

export type ProviderResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const SYSTEM_PROMPT =
  "You are NEXORA's governed assistant. The request you receive has already passed a deterministic policy engine and may contain redaction tokens such as [REDACTED:EMAIL]. Never attempt to reconstruct redacted values. Answer concisely and professionally.";

function requireKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new ProviderError(401, "Gateway credential is not configured.");
  return key;
}

async function runOpenAI(modelKey: string, prompt: string, key: string): Promise<ProviderResult> {
  const started = Date.now();
  const res = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: modelKey,
      instructions: SYSTEM_PROMPT,
      input: prompt,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(res.status, body.slice(0, 300) || "Provider request failed.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: {
            output_text?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
        };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        }
        if (event.type === "response.completed" && event.response) {
          if (!text && typeof event.response.output_text === "string") {
            text = event.response.output_text;
          }
          inputTokens = event.response.usage?.input_tokens ?? 0;
          outputTokens = event.response.usage?.output_tokens ?? 0;
        }
      } catch {
        // Ignore non-JSON keepalive frames.
      }
    }
  }

  return { text, inputTokens, outputTokens, latencyMs: Date.now() - started };
}

async function runChatCompletions(
  modelKey: string,
  prompt: string,
  key: string,
): Promise<ProviderResult> {
  const started = Date.now();
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: modelKey,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(res.status, body.slice(0, 300) || "Provider request failed.");
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    text: json.choices?.[0]?.message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}

export async function executeProviderRequest(
  modelKey: string,
  prompt: string,
): Promise<ProviderResult> {
  const key = requireKey();
  if (modelKey.startsWith("openai/")) return runOpenAI(modelKey, prompt, key);
  if (modelKey.startsWith("google/")) return runChatCompletions(modelKey, prompt, key);
  throw new ProviderError(400, `Provider execution for "${modelKey}" is NOT_CONFIGURED.`);
}
