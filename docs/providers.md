# Provider configuration

NEXORA keeps provider credentials in deployment secrets. The browser only sees
`CONFIGURED` or `NOT_CONFIGURED`; it never receives a key, key length or
upstream error body.

## Native adapters

| Vendor        | Secret                                         | Optional endpoint    | Protocol                 |
| ------------- | ---------------------------------------------- | -------------------- | ------------------------ |
| OpenAI        | `OPENAI_API_KEY` or `OPEN_AI_PLATFORM_API_KEY` | `OPENAI_BASE_URL`    | Responses API            |
| Anthropic     | `ANTHROPIC_API_KEY`                            | `ANTHROPIC_BASE_URL` | Messages API             |
| Google Gemini | `GOOGLE_AI_API_KEY` or `GEMINI_API_KEY`        | `GOOGLE_AI_BASE_URL` | Gemini `generateContent` |

The default endpoints are the vendors' official public APIs. Keep provider keys
server-side and scope them to the minimum models and environments required.

## OpenAI-compatible vendors

For a vendor or internal gateway exposing the Chat Completions shape, use a
provider row whose `vendor` matches the model-key prefix and configure:

```text
NEXORA_<VENDOR>_API_KEY
NEXORA_<VENDOR>_BASE_URL
```

For example, model key `mistral/mistral-large-latest` reads
`NEXORA_MISTRAL_API_KEY` and `NEXORA_MISTRAL_BASE_URL`. This supports compatible
deployments such as Mistral, Groq, xAI, DeepSeek, Together, OpenRouter and
private gateways without pretending their API semantics are identical.

## Adding a model

Add a model to the organization registry with a vendor-prefixed key, current
context window, classification and pricing. A model remains blocked unless its
provider is active, its credential is configured and the model is active in the
tenant registry. Provider readiness does not prove entitlement; run a governed
non-sensitive request to verify access.

## Operations checklist

- Use separate credentials for development, staging and production.
- Restrict outbound egress to the provider endpoints you approve.
- Keep provider data-retention settings aligned with organizational policy.
- Set provider-side rate limits below the Nexora budget ceiling where possible.
- Reconcile ambiguous timeouts before retrying; the upstream call may have been billed.
