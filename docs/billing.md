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

New organizations receive a 14-day Team trial. If a user cancels during the
trial, access remains available through the end of the trial. Continuing after
the trial requires activation of a paid tier at the displayed price. Because
NEXORA is a digital subscription service offered with a trial period, paid
subscription charges are non-refundable except where applicable law requires
otherwise.

Seat, agent, MCP-server and monthly request limits are enforced server-side. Premium capabilities are also
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

## Live default payment link

Use the public pricing page as Paddle's default payment link once its domain is
approved in the live Paddle account:

- Lovable production host: `https://nexora-guard-core.lovable.app/pricing`
- Custom domain, once it resolves to this deployment and is approved by Paddle:
  `https://nexoraguard.shop/pricing`

The pricing page initializes Paddle.js only when
`PADDLE_ENVIRONMENT=production` and `PADDLE_CLIENT_TOKEN` begins with
`live_`. It fails closed for transaction payment links if either condition is
not met. Paddle can append its `_ptxn` transaction query parameter to this
page to open the matching checkout.

## Public legal policies

Paddle-facing website policy pages are public and linked from the public site and
billing surfaces:

- Terms of Service: `/terms`
- Privacy Notice: `/privacy`
- Refund Policy: `/refund`

The refund policy states that paid digital subscription charges are
non-refundable except where applicable law requires otherwise. Trial cancellation
keeps access active through the stated trial end, and paid continuation requires
selection or activation of the desired paid tier at its displayed price.
