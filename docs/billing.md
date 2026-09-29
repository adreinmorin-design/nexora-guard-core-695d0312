# Billing

NEXORA uses Paddle as the intended merchant-of-record billing provider. The
database keeps provider-neutral customer and subscription identifiers so the
control plane does not trust browser checkout state.

## Plans

- Solo: $49/month or $490/year.
- Team: $399/month or $3,990/year.
- Enterprise: custom pricing under an annual contract.
- Model-provider usage, taxes outside the merchant-of-record flow, and custom
  implementation work are not included in the platform price.

New organizations receive a 14-day Team trial. Seat, agent, MCP-server and
monthly request limits are enforced server-side. Premium capabilities are also
checked against the current subscription on the server and again at the
database boundary where applicable.

Solo does not receive Team-only entitlements. Team and Enterprise receive:
human approval workflows, MCP discovery/tool controls, the security test suite,
attack simulation, and consented device AI discovery. An expired trial,
past-due subscription, canceled subscription, or incomplete subscription fails
closed for those premium operations.

Enterprise limits and Enterprise-specific identity, SIEM, deployment, and
support terms are set by contract; the self-service app does not pretend those
contracted services are automatically provisioned.

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
