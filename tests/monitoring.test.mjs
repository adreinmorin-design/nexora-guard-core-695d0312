import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSlackAlertPayload,
  notifySlackAlert,
} from "../src/lib/monitoring.server.ts";

const saved = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...saved };
  globalThis.fetch = originalFetch;
});

test("Slack payload contains only bounded operational metadata", () => {
  process.env.NEXORA_ENVIRONMENT = "production";
  const payload = buildSlackAlertPayload({
    category: "provider",
    severity: "critical",
    summary: "AI gateway or agent endpoint returned a server error",
    route: "/api/agent",
    status: 502,
    provider: "openai",
  });

  const serialized = JSON.stringify(payload);
  assert.match(serialized, /NEXORA Critical Alert/);
  assert.match(serialized, /production/);
  assert.match(serialized, /\/api\/agent/);
  assert.match(serialized, /openai/);
  assert.doesNotMatch(serialized, /Authorization|Bearer|prompt|request body/i);
});

test("Slack transport rejects non-Slack webhook URLs without network access", async () => {
  process.env.SLACK_WEBHOOK_URL = "https://example.com/services/T/B/X";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("ok");
  };

  const result = await notifySlackAlert({
    category: "runtime",
    severity: "critical",
    summary: "Application returned a server error",
    route: "/overview",
    status: 500,
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, "invalid_webhook");
  assert.equal(called, false);
});

test("Slack transport posts once and deduplicates repeated alerts", async () => {
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/X";
  process.env.NEXORA_ENVIRONMENT = "test";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response("ok", { status: 200 });
  };

  const alert = {
    category: "billing",
    severity: "critical",
    summary: "Billing endpoint returned a server error",
    route: "/api/paddle/webhook",
    status: 503,
  };

  const first = await notifySlackAlert(alert);
  const second = await notifySlackAlert(alert);

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason, "duplicate");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.slack.com/services/T/B/X");
});
