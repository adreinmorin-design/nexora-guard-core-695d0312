/**
 * Provider execution layer. Server-only.
 *
 * Every adapter receives the already-governed prompt. No provider key, raw
 * upstream body or secret configuration is returned to the browser or logs.
 * Unknown vendors can use the OpenAI-compatible adapter when both a key and a
 * deployment-specific base URL are configured.
 */

import { MAX_OUTPUT_TOKENS } from "./nexora/limits";

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

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 20_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const GOOGLE_GENERATIVE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const SYSTEM_PROMPT =
  "You are NEXORA's governed assistant. The request you receive has already passed a deterministic policy engine and may contain redaction tokens such as [REDACTED:EMAIL]. Never attempt to reconstruct redacted values. Answer concisely and professionally.";

export const SUPPORTED_VENDORS = ["openai", "anthropic", "google", "openai-compatible"] as const;

function canonicalVendor(vendor: string): string {
  const normalized = vendor.trim().toLowerCase();
  if (["gemini", "google-ai", "google_gemini", "google-generative-ai"].includes(normalized))
    return "google";
  return normalized;
}

function nonEmpty(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function vendorEnvPart(vendor: string): string {
  return vendor.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

export function providerCredentialVariable(vendor: string): string {
  vendor = canonicalVendor(vendor);
  if (vendor === "openai") return "OPENAI_API_KEY or OPEN_AI_PLATFORM_API_KEY";
  if (vendor === "anthropic") return "ANTHROPIC_API_KEY";
  if (vendor === "google") return "GOOGLE_AI_API_KEY or GEMINI_API_KEY";
  return `NEXORA_${vendorEnvPart(vendor)}_API_KEY`;
}

function providerKey(vendor: string): string | undefined {
  vendor = canonicalVendor(vendor);
  if (vendor === "openai")
    return nonEmpty("OPENAI_API_KEY") ?? nonEmpty("OPEN_AI_PLATFORM_API_KEY");
  if (vendor === "anthropic") return nonEmpty("ANTHROPIC_API_KEY");
  if (vendor === "google") return nonEmpty("GOOGLE_AI_API_KEY") ?? nonEmpty("GEMINI_API_KEY");
  return (
    nonEmpty(`NEXORA_${vendorEnvPart(vendor)}_API_KEY`) ??
    nonEmpty(`NEXORA_PROVIDER_${vendorEnvPart(vendor)}_API_KEY`)
  );
}

function compatibleBaseUrl(vendor: string): string | undefined {
  return (
    nonEmpty(`NEXORA_${vendorEnvPart(vendor)}_BASE_URL`) ??
    nonEmpty(`NEXORA_PROVIDER_${vendorEnvPart(vendor)}_BASE_URL`)
  );
}

function providerBaseUrl(vendor: string): string | undefined {
  vendor = canonicalVendor(vendor);
  if (vendor === "openai") return nonEmpty("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  if (vendor === "anthropic")
    return nonEmpty("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com/v1";
  if (vendor === "google") return nonEmpty("GOOGLE_AI_BASE_URL") ?? GOOGLE_GENERATIVE_URL;
  return compatibleBaseUrl(vendor);
}

function endpoint(base: string, path: string): string {
  const normalized = base.replace(/\/$/, "");
  return normalized.endsWith(path) ? normalized : `${normalized}${path}`;
}

/** Readiness never reveals key material or its length. */
export function providerReadiness(vendor: string): ReadinessState {
  vendor = canonicalVendor(vendor);
  if (!providerKey(vendor)) return "NOT_CONFIGURED";
  if (!["openai", "anthropic", "google"].includes(vendor) && !providerBaseUrl(vendor)) {
    return "NOT_CONFIGURED";
  }
  return "CONFIGURED";
}

export function readinessSnapshot(
  vendors: string[] = ["openai", "anthropic", "google"],
): Record<string, ReadinessState> {
  return Object.fromEntries(vendors.map((vendor) => [vendor, providerReadiness(vendor)]));
}

/** "openai/gpt-4.1-mini" -> "gpt-4.1-mini" */
export function toUpstreamModel(modelKey: string): string {
  const slash = modelKey.indexOf("/");
  return slash < 0 ? modelKey : modelKey.slice(slash + 1);
}

type Usage = {
  inputTokens: number;
  outputTokens: number;
};

function numberOrZero(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function parseUsage(json: any): Usage {
  const usage = json?.usage ?? json?.usageMetadata ?? {};
  return {
    inputTokens: numberOrZero(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount),
    outputTokens: numberOrZero(
      usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount,
    ),
  };
}

export function parseResponseText(json: any): string {
  if (typeof json?.output_text === "string") return json.output_text;
  const responses = (json?.output ?? []) as Array<{
    content?: Array<{ type?: string; text?: unknown }>;
  }>;
  const responseText = responses
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" || part.type === undefined)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  if (responseText) return responseText;
  if (typeof json?.content === "string") return json.content;
  if (Array.isArray(json?.content)) {
    const content = json.content
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
    if (content) return content;
  }
  if (Array.isArray(json?.choices)) {
    return json.choices
      .map((choice: any) => choice?.message?.content ?? choice?.text ?? "")
      .filter((text: unknown): text is string => typeof text === "string")
      .join("");
  }
  if (Array.isArray(json?.candidates)) {
    return json.candidates
      .flatMap((candidate: any) => candidate?.content?.parts ?? [])
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function mapUpstreamStatus(status: number): ProviderError {
  if (status === 401 || status === 403)
    return new ProviderError(502, "Provider rejected the server credential.");
  if (status === 404) return new ProviderError(400, "Requested model is unavailable upstream.");
  if (status === 429) return new ProviderError(429, "Provider rate limit reached. Retry shortly.");
  if (status >= 500) return new ProviderError(502, "Provider is temporarily unavailable.");
  return new ProviderError(502, "Provider rejected the request.");
}

async function requestJson(
  url: string,
  init: RequestInit,
  started: number,
): Promise<{ json: any; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw mapUpstreamStatus(response.status);
    }
    return { json: await response.json(), latencyMs: Date.now() - started };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted)
      throw new ProviderError(504, "Provider request timed out after 30s.");
    throw new ProviderError(502, "Provider request could not be completed.");
  } finally {
    clearTimeout(timer);
  }
}

function validatePrompt(prompt: string) {
  if (prompt.length > MAX_INPUT_CHARS)
    throw new ProviderError(413, "Prompt exceeds the gateway input limit.");
}

async function runOpenAI(model: string, prompt: string): Promise<ProviderResult> {
  const key = providerKey("openai");
  if (!key) throw new ProviderError(503, "OpenAI provider is NOT_CONFIGURED.");
  validatePrompt(prompt);
  const started = Date.now();
  const base = providerBaseUrl("openai")!;
  const url = endpoint(base, "/responses");
  const { json, latencyMs } = await requestJson(
    url === OPENAI_RESPONSES_URL ? url : url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: toUpstreamModel(model),
        instructions: SYSTEM_PROMPT,
        input: prompt,
        stream: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      }),
    },
    started,
  );
  const usage = parseUsage(json);
  return { text: parseResponseText(json), ...usage, latencyMs };
}

async function runAnthropic(model: string, prompt: string): Promise<ProviderResult> {
  const key = providerKey("anthropic");
  if (!key) throw new ProviderError(503, "Anthropic provider is NOT_CONFIGURED.");
  validatePrompt(prompt);
  const started = Date.now();
  const { json, latencyMs } = await requestJson(
    endpoint(providerBaseUrl("anthropic")!, "/messages"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: toUpstreamModel(model),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    },
    started,
  );
  const usage = parseUsage(json);
  return { text: parseResponseText(json), ...usage, latencyMs };
}

async function runGoogle(model: string, prompt: string): Promise<ProviderResult> {
  const key = providerKey("google");
  if (!key) throw new ProviderError(503, "Google provider is NOT_CONFIGURED.");
  validatePrompt(prompt);
  const started = Date.now();
  const modelName = encodeURIComponent(toUpstreamModel(model));
  const base = providerBaseUrl("google")!.replace(/\/$/, "");
  const url = `${base}/${modelName}:generateContent`;
  const { json, latencyMs } = await requestJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
    },
    started,
  );
  const usage = parseUsage(json);
  return { text: parseResponseText(json), ...usage, latencyMs };
}

async function runOpenAiCompatible(
  vendor: string,
  model: string,
  prompt: string,
): Promise<ProviderResult> {
  const key = providerKey(vendor);
  const base = providerBaseUrl(vendor);
  if (!key || !base) throw new ProviderError(503, `${vendor} provider is NOT_CONFIGURED.`);
  validatePrompt(prompt);
  const started = Date.now();
  const url = endpoint(base, "/chat/completions");
  const { json, latencyMs } = await requestJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: toUpstreamModel(model),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
      }),
    },
    started,
  );
  const usage = parseUsage(json);
  return { text: parseResponseText(json), ...usage, latencyMs };
}

export async function executeProviderRequest(
  modelKey: string,
  prompt: string,
): Promise<ProviderResult> {
  const slash = modelKey.indexOf("/");
  const vendor = canonicalVendor(slash < 0 ? "openai" : modelKey.slice(0, slash));
  if (vendor === "openai") return runOpenAI(modelKey, prompt);
  if (vendor === "anthropic") return runAnthropic(modelKey, prompt);
  if (vendor === "google" || vendor === "gemini") return runGoogle(modelKey, prompt);
  return runOpenAiCompatible(vendor, modelKey, prompt);
}
