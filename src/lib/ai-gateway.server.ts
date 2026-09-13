/**
 * Provider execution layer. Runs server-side only.
 *
 * The OpenAI Platform is called directly (https://api.openai.com/v1/responses).
 * The API key is read from the server environment inside the request handler and
 * is never returned, logged, persisted or surfaced to the browser in any form.
 * Other vendors are explicitly NOT_CONFIGURED — nothing is simulated.
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
    this.name = "ProviderError";
  }
}

export type ReadinessState = "CONFIGURED" | "NOT_CONFIGURED";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 20_000;

export const SYSTEM_PROMPT =
  "You are NEXORA's governed assistant. The request you receive has already passed a deterministic policy engine and may contain redaction tokens such as [REDACTED:EMAIL]. Never attempt to reconstruct redacted values. Answer concisely and professionally.";

/** Vendors this deployment can actually execute against. */
export const SUPPORTED_VENDORS = ["openai"] as const;

function openAiKey(): string | undefined {
  // Read at call time; never at module scope, never logged.
  const key = process.env["OPENAI_API_KEY"];
  return key && key.trim().length > 0 ? key : undefined;
}

/**
 * Safe readiness probe. Returns only a state string — never the credential,
 * its length, or any fragment of it.
 */
export function providerReadiness(vendor: string): ReadinessState {
  if (vendor === "openai") return openAiKey() ? "CONFIGURED" : "NOT_CONFIGURED";
  return "NOT_CONFIGURED";
}

export function readinessSnapshot(): Record<string, ReadinessState> {
  return { openai: providerReadiness("openai") };
}

/** "openai/gpt-4.1-mini" -> "gpt-4.1-mini" */
export function toUpstreamModel(modelKey: string): string {
  return modelKey.startsWith("openai/") ? modelKey.slice("openai/".length) : modelKey;
}

type ResponsesPayload = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** Robustly pull text out of the Responses API shape. */
export function parseResponseText(json: unknown): string {
  const payload = (json ?? {}) as ResponsesPayload;
  if (typeof payload.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }
  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") chunks.push(part.text);
      else if (part?.type === undefined && typeof part?.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("");
}

export function parseUsage(json: unknown): { inputTokens: number; outputTokens: number } {
  const usage = ((json ?? {}) as ResponsesPayload).usage ?? {};
  return {
    inputTokens: Number(usage.input_tokens ?? 0) || 0,
    outputTokens: Number(usage.output_tokens ?? 0) || 0,
  };
}

/** Upstream failures are mapped to sanitized messages; bodies never leak out. */
function mapUpstreamStatus(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(502, "Provider rejected the server credential.");
  }
  if (status === 404) return new ProviderError(400, "Requested model is unavailable upstream.");
  if (status === 429) return new ProviderError(429, "Provider rate limit reached. Retry shortly.");
  if (status >= 500) return new ProviderError(502, "Provider is temporarily unavailable.");
  return new ProviderError(502, "Provider rejected the request.");
}

async function runOpenAI(modelKey: string, prompt: string): Promise<ProviderResult> {
  const key = openAiKey();
  if (!key) {
    throw new ProviderError(
      503,
      "OpenAI provider is NOT_CONFIGURED: no server-side API key is present.",
    );
  }
  if (prompt.length > MAX_INPUT_CHARS) {
    throw new ProviderError(413, "Prompt exceeds the gateway input limit.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();

  let res: Response;
  try {
    res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: toUpstreamModel(modelKey),
        instructions: SYSTEM_PROMPT,
        input: prompt,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if ((error as { name?: string })?.name === "AbortError") {
      throw new ProviderError(504, "Provider request timed out after 30s.");
    }
    throw new ProviderError(502, "Provider request could not be completed.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Body intentionally discarded: upstream bodies can echo request content.
    await res.text().catch(() => "");
    throw mapUpstreamStatus(res.status);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ProviderError(502, "Provider returned an unreadable response.");
  }

  const usage = parseUsage(json);
  return {
    text: parseResponseText(json),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - started,
  };
}

export async function executeProviderRequest(
  modelKey: string,
  prompt: string,
): Promise<ProviderResult> {
  const vendor = modelKey.includes("/") ? modelKey.split("/")[0]! : "openai";
  if (vendor === "openai") return runOpenAI(modelKey, prompt);
  throw new ProviderError(400, `Provider execution for "${vendor}" is NOT_CONFIGURED.`);
}
