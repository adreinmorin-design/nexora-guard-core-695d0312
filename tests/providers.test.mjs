import test from "node:test";
import assert from "node:assert/strict";
import {
  executeProviderRequest,
  parseResponseText,
  parseUsage,
  providerReadiness,
} from "../src/lib/ai-gateway.server.ts";

const saved = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...saved };
  globalThis.fetch = originalFetch;
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("provider readiness never exposes secrets and recognizes native adapters", () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  assert.equal(providerReadiness("openai"), "NOT_CONFIGURED");
  process.env.ANTHROPIC_API_KEY = "test-secret";
  process.env.GOOGLE_AI_API_KEY = "test-secret";
  assert.equal(providerReadiness("anthropic"), "CONFIGURED");
  assert.equal(providerReadiness("google"), "CONFIGURED");
});

test("native adapters dispatch the governed prompt and normalize usage", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("anthropic")) {
      return response({
        content: [{ type: "text", text: "anthropic answer" }],
        usage: { input_tokens: 3, output_tokens: 5 },
      });
    }
    if (String(url).includes("generativelanguage")) {
      return response({
        candidates: [{ content: { parts: [{ text: "gemini answer" }] } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
      });
    }
    return response({ output_text: "openai answer", usage: { input_tokens: 2, output_tokens: 4 } });
  };
  process.env.OPENAI_API_KEY = "openai-secret";
  process.env.ANTHROPIC_API_KEY = "anthropic-secret";
  process.env.GOOGLE_AI_API_KEY = "google-secret";

  const openai = await executeProviderRequest("openai/test-model", "safe prompt");
  const anthropic = await executeProviderRequest("anthropic/test-model", "safe prompt");
  const google = await executeProviderRequest("google/test-model", "safe prompt");

  assert.equal(openai.text, "openai answer");
  assert.equal(anthropic.text, "anthropic answer");
  assert.equal(google.text, "gemini answer");
  assert.deepEqual(parseUsage({ usage: { prompt_tokens: 7, completion_tokens: 8 } }), {
    inputTokens: 7,
    outputTokens: 8,
  });
  assert.equal(
    parseResponseText({ choices: [{ message: { content: "compatible answer" } }] }),
    "compatible answer",
  );
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => !call.url.includes("secret")));
});

test("unknown vendors use the bounded OpenAI-compatible adapter", async () => {
  process.env.NEXORA_MISTRAL_API_KEY = "mistral-secret";
  process.env.NEXORA_MISTRAL_BASE_URL = "https://mistral.example/v1";
  process.env.PROVIDER_ALLOWED_ORIGINS = "https://mistral.example";
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://mistral.example/v1/chat/completions");
    return response({
      choices: [{ message: { content: "compatible answer" } }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    });
  };
  const result = await executeProviderRequest("mistral/mistral-large", "safe prompt");
  assert.equal(result.text, "compatible answer");
  assert.equal(result.inputTokens, 1);
  assert.equal(result.outputTokens, 2);
});

test("custom provider endpoints fail closed unless explicitly allowlisted", () => {
  process.env.NEXORA_MISTRAL_API_KEY = "mistral-secret";
  process.env.NEXORA_MISTRAL_BASE_URL = "http://127.0.0.1:8080/v1";
  delete process.env.PROVIDER_ALLOWED_ORIGINS;
  assert.equal(providerReadiness("mistral"), "NOT_CONFIGURED");
  process.env.NEXORA_MISTRAL_BASE_URL = "https://mistral.example/v1";
  assert.equal(providerReadiness("mistral"), "NOT_CONFIGURED");
  process.env.PROVIDER_ALLOWED_ORIGINS = "https://mistral.example";
  assert.equal(providerReadiness("mistral"), "CONFIGURED");
});
