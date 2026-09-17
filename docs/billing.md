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

Create products and recurring prices in Paddle, then configure server secrets
for the Paddle API key and webhook secret plus public client-side token and
price IDs. Use Paddle sandbox until checkout, renewal, failed-payment,
cancellation and webhook replay scenarios pass.

Subscription changes must be applied from verified Paddle webhooks using the
organization ID carried in checkout custom data. Never activate a subscription
from a browser redirect alone. Store Paddle customer and subscription IDs in
`billing_subscriptions.provider_customer_id` and
`billing_subscriptions.provider_subscription_id`.

Checkout is intentionally unavailable until a Paddle account, approved domain,
products, prices and webhook destination exist. The pricing and entitlement
layer can deploy independently without pretending that payment collection is
active.
