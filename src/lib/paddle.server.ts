/**
 * Paddle Billing integration. Server-only.
 *
 * The browser receives only a Paddle client token, a price ID and a signed
 * organization payload. Entitlements are activated from verified webhooks,
 * never from a checkout redirect or a client-supplied organization ID.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type CheckoutPlan = "solo" | "team";
export type CheckoutInterval = "monthly" | "annual";

export type PaddleCheckoutData = {
  org_id: string;
  plan_key: CheckoutPlan;
  interval: CheckoutInterval;
  user_id: string;
  signature: string;
};

export type PaddleCheckoutConfig = {
  enabled: true;
  clientToken: string;
  environment: "sandbox" | "production";
  priceId: string;
  customData: PaddleCheckoutData;
};

const PRICE_ENV: Record<CheckoutPlan, Record<CheckoutInterval, string>> = {
  solo: {
    monthly: "PADDLE_PRICE_SOLO_MONTHLY",
    annual: "PADDLE_PRICE_SOLO_ANNUAL",
  },
  team: {
    monthly: "PADDLE_PRICE_TEAM_MONTHLY",
    annual: "PADDLE_PRICE_TEAM_ANNUAL",
  },
};

function value(name: string): string | undefined {
  const result = process.env[name]?.trim();
  return result || undefined;
}

export function paddleEnvironment(): "sandbox" | "production" {
  return process.env["PADDLE_ENVIRONMENT"]?.trim().toLowerCase() ===
    "production"
    ? "production"
    : "sandbox";
}

export function paddlePriceId(
  plan: CheckoutPlan,
  interval: CheckoutInterval,
): string | undefined {
  return value(PRICE_ENV[plan][interval]);
}

/** Keep this canonical representation stable; it is part of webhook security. */
export function checkoutSigningPayload(
  data: Omit<PaddleCheckoutData, "signature">,
): string {
  return [data.org_id, data.plan_key, data.interval, data.user_id].join(".");
}

export function signCheckoutData(
  data: Omit<PaddleCheckoutData, "signature">,
  secret = value("PADDLE_CHECKOUT_SIGNING_SECRET"),
): string | undefined {
  if (!secret) return undefined;
  return createHmac("sha256", secret)
    .update(checkoutSigningPayload(data), "utf8")
    .digest("hex");
}

export function verifyCheckoutData(
  data: PaddleCheckoutData,
  secret = value("PADDLE_CHECKOUT_SIGNING_SECRET"),
): boolean {
  if (!secret || !data.signature) return false;
  const expected = signCheckoutData(
    {
      org_id: data.org_id,
      plan_key: data.plan_key,
      interval: data.interval,
      user_id: data.user_id,
    },
    secret,
  );
  if (!expected || !/^[a-f0-9]{64}$/.test(data.signature)) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(data.signature, "hex"),
  );
}

/**
 * Paddle-Signature is `ts=<unix>;h1=<hex hmac>`. The signed value is the
 * timestamp, a colon, and the exact raw request body.
 */
export function verifyPaddleWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret = value("PADDLE_WEBHOOK_SECRET"),
  nowMs = Date.now(),
): boolean {
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(/[;,]/).map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = Number(parts.ts);
  const provided = parts.h1;
  if (
    !Number.isInteger(timestamp) ||
    !provided ||
    !/^[a-f0-9]{64}$/i.test(provided)
  )
    return false;
  // Replay protection: Paddle retries legitimate events, but a signed body
  // older than five minutes should not be accepted by a public endpoint.
  if (Math.abs(nowMs - timestamp * 1000) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}:${rawBody}`, "utf8")
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided, "hex"),
  );
}

export function createCheckoutConfig(
  orgId: string,
  userId: string,
  plan: CheckoutPlan,
  interval: CheckoutInterval,
): PaddleCheckoutConfig | null {
  const clientToken = value("PADDLE_CLIENT_TOKEN");
  const priceId = paddlePriceId(plan, interval);
  const secret = value("PADDLE_CHECKOUT_SIGNING_SECRET");
  if (!clientToken || !priceId || !secret) return null;
  const unsigned = {
    org_id: orgId,
    plan_key: plan,
    interval,
    user_id: userId,
  } as const;
  const signature = signCheckoutData(unsigned, secret);
  if (!signature) return null;
  return {
    enabled: true,
    clientToken,
    environment: paddleEnvironment(),
    priceId,
    customData: { ...unsigned, signature },
  };
}

export function planFromPriceId(priceId: unknown): CheckoutPlan | undefined {
  if (typeof priceId !== "string") return undefined;
  for (const plan of Object.keys(PRICE_ENV) as CheckoutPlan[]) {
    for (const interval of ["monthly", "annual"] as CheckoutInterval[]) {
      if (paddlePriceId(plan, interval) === priceId) return plan;
    }
  }
  return undefined;
}

export function resolvePaddleWebhookIdentity(
  priceId: unknown,
  custom: Partial<PaddleCheckoutData> | null | undefined,
  secret = value("PADDLE_CHECKOUT_SIGNING_SECRET"),
): {
  orgId: string | null;
  planKey: CheckoutPlan | undefined;
  signedIdentity: boolean;
} | null {
  const pricePlan = planFromPriceId(priceId);
  const hasAnyIdentity = Boolean(
    custom &&
    (custom.org_id ||
      custom.plan_key ||
      custom.interval ||
      custom.user_id ||
      custom.signature),
  );
  if (!hasAnyIdentity)
    return { orgId: null, planKey: pricePlan, signedIdentity: false };
  const complete =
    typeof custom?.org_id === "string" &&
    (custom?.plan_key === "solo" || custom?.plan_key === "team") &&
    (custom?.interval === "monthly" || custom?.interval === "annual") &&
    typeof custom?.user_id === "string" &&
    typeof custom?.signature === "string";
  if (!complete || !verifyCheckoutData(custom as PaddleCheckoutData, secret))
    return null;
  if (pricePlan && pricePlan !== custom.plan_key) return null;
  return {
    orgId: custom.org_id,
    planKey: pricePlan ?? custom.plan_key,
    signedIdentity: true,
  };
}
