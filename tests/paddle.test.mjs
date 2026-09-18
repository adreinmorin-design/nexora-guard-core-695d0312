import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createCheckoutConfig,
  planFromPriceId,
  signCheckoutData,
  resolvePaddleWebhookIdentity,
  verifyCheckoutData,
  verifyPaddleWebhook,
} from "../src/lib/paddle.server.ts";

const saved = { ...process.env };

test.afterEach(() => {
  process.env = { ...saved };
});

test("checkout metadata is signed and tamper resistant", () => {
  process.env.PADDLE_CHECKOUT_SIGNING_SECRET = "checkout-secret";
  const unsigned = {
    org_id: "org-1",
    plan_key: "team",
    interval: "annual",
    user_id: "user-1",
  };
  const signature = signCheckoutData(unsigned);
  assert.ok(signature);
  assert.equal(verifyCheckoutData({ ...unsigned, signature }), true);
  assert.equal(verifyCheckoutData({ ...unsigned, plan_key: "solo", signature }), false);
});

test("checkout remains disabled until all Paddle values exist", () => {
  process.env.PADDLE_CHECKOUT_SIGNING_SECRET = "checkout-secret";
  process.env.PADDLE_CLIENT_TOKEN = "test-client-token";
  process.env.PADDLE_PRICE_TEAM_MONTHLY = "pri_team_monthly";
  assert.equal(createCheckoutConfig("org-1", "user-1", "team", "monthly")?.enabled, true);
  assert.equal(planFromPriceId("pri_team_monthly"), "team");
  delete process.env.PADDLE_CHECKOUT_SIGNING_SECRET;
  assert.equal(createCheckoutConfig("org-1", "user-1", "team", "monthly"), null);
});

test("webhook signatures require a fresh timestamp and exact body", () => {
  process.env.PADDLE_WEBHOOK_SECRET = "webhook-secret";
  const body = JSON.stringify({ event_type: "subscription.updated" });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", "webhook-secret")
    .update(`${timestamp}:${body}`)
    .digest("hex");
  const header = `ts=${timestamp};h1=${digest}`;
  assert.equal(verifyPaddleWebhook(body, header), true);
  assert.equal(verifyPaddleWebhook(`${body} `, header), false);
  assert.equal(
    verifyPaddleWebhook(body, header, "webhook-secret", Date.now() - 6 * 60 * 1000),
    false,
  );
});

test("webhook identity rejects unsigned or price-mismatched tenant metadata", () => {
  process.env.PADDLE_CHECKOUT_SIGNING_SECRET = "checkout-secret";
  process.env.PADDLE_PRICE_TEAM_MONTHLY = "pri_team_monthly";
  const unsigned = {
    org_id: "org-1",
    plan_key: "team",
    interval: "monthly",
    user_id: "user-1",
  };
  const signature = signCheckoutData(unsigned);
  assert.ok(signature);
  assert.deepEqual(
    resolvePaddleWebhookIdentity("pri_team_monthly", {
      ...unsigned,
      signature,
    }),
    { orgId: "org-1", planKey: "team", signedIdentity: true },
  );
  assert.equal(
    resolvePaddleWebhookIdentity("pri_team_monthly", {
      ...unsigned,
      org_id: "attacker-org",
      signature,
    }),
    null,
  );
  process.env.PADDLE_PRICE_SOLO_MONTHLY = "pri_solo_monthly";
  assert.equal(
    resolvePaddleWebhookIdentity("pri_solo_monthly", {
      ...unsigned,
      signature,
    }),
    null,
  );
});
