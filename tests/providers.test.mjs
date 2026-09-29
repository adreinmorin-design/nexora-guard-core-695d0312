import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderError,
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

for (const [upstream, expected] of [
  [400, 502],
  [401, 502],
  [403, 502],
  [404, 400],
  [429, 429],
  [500, 502],
]) {
  test(`upstream ${upstream} retains correlation and safe error mapping`, async () => {
    process.env.OPENAI_API_KEY = "test-secret";
    globalThis.fetch = async () =>
      new Response("secret upstream body", {
        status: upstream,
        headers: { "x-request-id": "req_failure-123" },
      });
    await assert.rejects(executeProviderRequest("openai/test", "safe"), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, expected);
      assert.equal(error.providerRequestId, "req_failure-123");
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  });
}

test("body decoding and cleanup failures retain received request IDs", async () => {
  process.env.OPENAI_API_KEY = "test-secret";
  globalThis.fetch = async () =>
    new Response("not json", { headers: { "request-id": "req_decode" } });
  await assert.rejects(executeProviderRequest("openai/test", "safe"), {
    status: 502,
    providerRequestId: "req_decode",
  });
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: new Headers({ "x-correlation-id": "req_cleanup" }),
    body: {
      cancel: async () => {
        throw new Error("cleanup");
      },
    },
  });
  await assert.rejects(executeProviderRequest("openai/test", "safe"), {
    status: 429,
    providerRequestId: "req_cleanup",
  });
});

test("native and compatible adapters preserve their actual response identifiers", async () => {
  process.env.OPENAI_API_KEY = "test-secret";
  process.env.ANTHROPIC_API_KEY = "test-secret";
  process.env.GOOGLE_AI_API_KEY = "test-secret";
  process.env.NEXORA_MISTRAL_API_KEY = "test-secret";
  process.env.NEXORA_MISTRAL_BASE_URL = "https://mistral.example/v1";
  process.env.PROVIDER_ALLOWED_ORIGINS = "https://mistral.example";
  for (const vendor of ["openai", "anthropic", "google", "mistral"]) {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "response_generic",
          responseId: "gemini_actual",
          output_text: "safe",
        }),
        { headers: { "x-request-id": "req_ok" } },
      );
    const result = await executeProviderRequest(`${vendor}/test`, "safe");
    assert.equal(result.providerRequestId, "req_ok");
    assert.equal(
      result.providerResponseId,
      vendor === "google" ? "gemini_actual" : "response_generic",
    );
  }
});

test("untrusted IDs reject invalid values without truncation or affecting responses", async () => {
  process.env.OPENAI_API_KEY = "test-secret";
  for (const id of [
    null,
    42,
    {},
    "",
    "a".repeat(257),
    "bad id",
    "bad\\nvalue",
    "<script>",
    "ümlaut",
  ]) {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ id, output_text: "safe" }), {
        headers: { "x-request-id": "x".repeat(257), "request-id": "req_fallback" },
      });
    const result = await executeProviderRequest("openai/test", "safe");
    assert.equal(result.providerResponseId, null);
    assert.equal(result.providerRequestId, "req_fallback");
    assert.equal(result.text, "safe");
  }
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "a".repeat(256) }), {
      headers: { "x-request-id": "req_ok" },
    });
  assert.equal(
    (await executeProviderRequest("openai/test", "safe")).providerResponseId.length,
    256,
  );
  assert.equal(new ProviderError(502, "safe", "bad\nvalue").providerRequestId, null);
});
