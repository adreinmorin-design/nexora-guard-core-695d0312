# Billing

NEXORA uses Paddle as the intended merchant-of-record billing provider. The
database keeps provider-neutral customer and subscription identifiers so the
control plane does not trust browser checkout state.

## Plans

- Solo: $49/month or $490/year.
- Team: $249/month or $2,490/year.
- Enterprise: starts at $1,500/month under an annual contract.
- Model-provider usage, taxes outside the merchant-of-record flow, and custom
  implementation work are not included in the platform price.

New organizations receive a 14-day Team trial. Seat, agent, MCP-server and
monthly request limits are enforced server-side. Enterprise limits are set by
contract.

## Paddle activation

Create products and recurring prices in Paddle, then configure these server
secrets (use sandbox values first):

```text
PADDLE_ENVIRONMENT=sandbox
PADDLE_CLIENT_TOKEN=...
PADDLE_CHECKOUT_SIGNING_SECRET=...
PADDLE_WEBHOOK_SECRET=...
PADDLE_PRICE_SOLO_MONTHLY=pri_...
PADDLE_PRICE_SOLO_ANNUAL=pri_...
PADDLE_PRICE_TEAM_MONTHLY=pri_...
PADDLE_PRICE_TEAM_ANNUAL=pri_...
```

Point Paddle's notification destination at `/api/paddle/webhook`. NEXORA
verifies the `Paddle-Signature` header, rejects stale/replayed payloads, checks
the signed organization metadata and only then updates entitlements. Use the
Paddle sandbox until checkout, renewal, failed-payment, cancellation and
webhook replay scenarios pass.

Subscription changes must be applied from verified Paddle webhooks using the
organization ID carried in checkout custom data. Never activate a subscription
from a browser redirect alone. Store Paddle customer and subscription IDs in
`billing_subscriptions.provider_customer_id` and
`billing_subscriptions.provider_subscription_id`.

If any Paddle value is absent, checkout remains disabled and the billing page
explains that state. The pricing and entitlement layer can deploy independently
without pretending that payment collection is active.
