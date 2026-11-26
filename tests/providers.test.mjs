import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderError,
  executeProviderRequest,
  parseResponseText,
  parseUsage,
  providerCredentialVariable,
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
  delete process.env.OPEN_AI_PLATFORM_API_KEY;
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

function clearProviderEnv() {
  for (const name of Object.keys(process.env))
    if (
      /^(OPENAI|OPEN_AI|ANTHROPIC|GOOGLE_AI|GEMINI|NEXORA_)/.test(name) ||
      name === "PROVIDER_ALLOWED_ORIGINS"
    )
      delete process.env[name];
}

function fetchSpy(body = { output_text: "ok" }) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response(body);
  };
  return calls;
}

test("Gemini vendor aliases resolve to the native Google adapter", async () => {
  clearProviderEnv();
  process.env.GEMINI_API_KEY = "gemini-secret";
  for (const alias of [
    "gemini",
    "GEMINI",
    "google",
    "google-ai",
    "google_gemini",
    "google-generative-ai",
  ]) {
    assert.equal(providerReadiness(alias), "CONFIGURED", alias);
    assert.equal(providerCredentialVariable(alias), "GOOGLE_AI_API_KEY or GEMINI_API_KEY", alias);
    const calls = fetchSpy({
      candidates: [{ content: { parts: [{ text: "gemini answer" }] } }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
    });
    const result = await executeProviderRequest(`${alias}/gemini-2.5-flash`, "safe prompt");
    assert.equal(calls.length, 1, alias);
    assert.equal(
      calls[0].url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      alias,
    );
    assert.equal(new Headers(calls[0].init.headers).get("x-goog-api-key"), "gemini-secret");
    assert.equal(result.text, "gemini answer");
    assert.equal(result.inputTokens, 2);
    assert.equal(result.outputTokens, 3);
  }
});

for (const [modelKey, message] of [
  ["openai/gpt-test", /OpenAI provider is NOT_CONFIGURED/],
  ["anthropic/claude-test", /Anthropic provider is NOT_CONFIGURED/],
  ["gemini/gemini-test", /Google provider is NOT_CONFIGURED/],
  ["mistral/mistral-large", /mistral provider is NOT_CONFIGURED/],
]) {
  test(`missing API key for ${modelKey} fails clearly without any fetch`, async () => {
    clearProviderEnv();
    // Endpoint configured and allowlisted, only the key is missing.
    process.env.NEXORA_MISTRAL_BASE_URL = "https://mistral.example/v1";
    process.env.PROVIDER_ALLOWED_ORIGINS = "https://mistral.example";
    process.env.OPENAI_API_KEY = "   ";
    const calls = fetchSpy();
    await assert.rejects(executeProviderRequest(modelKey, "safe"), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 503);
      assert.match(error.message, message);
      return true;
    });
    assert.equal(calls.length, 0, "provider fetch must not be invoked");
  });
}

for (const [label, base, allowlist] of [
  ["not in PROVIDER_ALLOWED_ORIGINS", "https://rogue.example/v1", "https://mistral.example"],
  ["no allowlist configured", "https://mistral.example/v1", undefined],
  ["plain HTTP even when allowlisted", "http://mistral.example/v1", "http://mistral.example"],
  ["loopback address", "https://127.0.0.1/v1", "https://127.0.0.1"],
  ["embedded credentials", "https://user:pw@mistral.example/v1", "https://mistral.example"],
]) {
  test(`OpenAI-compatible base URL rejected (${label}) without any fetch`, async () => {
    clearProviderEnv();
    process.env.NEXORA_MISTRAL_API_KEY = "mistral-secret";
    process.env.NEXORA_MISTRAL_BASE_URL = base;
    if (allowlist) process.env.PROVIDER_ALLOWED_ORIGINS = allowlist;
    const calls = fetchSpy();
    await assert.rejects(executeProviderRequest("mistral/mistral-large", "safe"), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 503);
      assert.match(error.message, /not in PROVIDER_ALLOWED_ORIGINS/);
      assert.ok(!error.message.includes("mistral-secret"));
      return true;
    });
    assert.equal(calls.length, 0, "provider fetch must not be invoked");
    assert.equal(providerReadiness("mistral"), "NOT_CONFIGURED");
  });
}

test("native base URL override outside the allowlist is rejected without fetch", async () => {
  clearProviderEnv();
  process.env.OPENAI_API_KEY = "openai-secret";
  process.env.OPENAI_BASE_URL = "https://rogue.example/v1";
  const calls = fetchSpy();
  await assert.rejects(executeProviderRequest("openai/gpt-test", "safe"), {
    status: 503,
    message: /not in PROVIDER_ALLOWED_ORIGINS/,
  });
  assert.equal(calls.length, 0);
});
