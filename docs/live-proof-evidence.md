# Nexora live proof: evidence protocol

Status: **unproven until the acceptance table is populated from production**.

As of 2026-09-23, the six production `requests` rows inspected through Lovable all had
`status = 'provider_error'`. This protocol does not count them as successful
provider execution. Do not describe the live gateway as proven until the tests
below pass. Never use a mock response or manually insert evidence rows.

## Goal and constraints

Prove that an authenticated agent request passes identity, permissions, data
inspection, budget, provider selection and audit; that a denied request cannot
reach a provider; and that an MCP invocation is authorized or denied before
the tool runs. Use one non-sensitive, inexpensive test prompt and a unique
correlation label. Use a configured production provider key stored server-side.
Do not expose credentials, raw prompts, customer data or upstream error bodies
in the evidence bundle.

## Preconditions

1. CI green for the exact production commit; record commit SHA and deployed URL.
2. Owner can sign in at `/auth`; an active model in `/gateway/providers` or
   `/gateway/models` shows `CONFIGURED`. This only checks presence, not validity.
3. Owner has approved a disposable test agent, its minimal model scope, and one
   harmless MCP tool with a grant. Keep agent token out of screenshots and logs.
4. Production has applied migration `20260920000100` for `execution_events`
   and `20260921000100` for audit immutability. Verify schema and migration
   state before making the demo call.
5. Set a small test budget and a permitted provider/model. Preserve the
   previous settings and restore them after the run.

## Two-minute recording

| Time | Action | Observable evidence |
| --- | --- | --- |
| 0:00–0:20 | Show deployed commit, configured model, active policy, and live execution timeline. | Commit SHA, environment, policy version. |
| 0:20–0:50 | Send one agent request containing `NEXORA-PROOF-<UTC>`: “Reply with exactly: governed execution confirmed.” | HTTP result, request ID, nonempty provider output, token usage, nonzero measured latency. |
| 0:50–1:10 | Submit an otherwise identical request with a budget ceiling below its estimated cost, using a fresh idempotency key. | BLOCK, no provider output, zero provider tokens, request ID and budget trace. |
| 1:10–1:30 | Have the same agent invoke the approved harmless MCP tool; then attempt an ungranted tool with another fresh key. | Tool authorization ALLOW and BLOCK, with separate execution IDs and no denied tool side effect. |
| 1:30–2:00 | Show request history, execution events, and audit events for those exact IDs. | Matching org/request/actor IDs and timestamps; immutable audit trigger present. |

If a tool cannot be safely invoked in the production tenant, label that step
**not tested**; a simulated MCP decision is insufficient.

## Acceptance gates

| Gate | Pass condition |
| --- | --- |
| Real model | `requests.status = 'completed'` (or documented successful equivalent), output from the upstream provider, positive input/output tokens, recorded cost and latency. A `CONFIGURED` badge alone fails. |
| Budget enforcement | A denied request persisted as BLOCK, no provider output or provider usage, budget-stage trace blocked, audit result blocked. Verify the provider was not called using provider usage/trace evidence; zero tokens alone is not conclusive. |
| Tool grant | One permitted MCP invocation completes and one ungranted invocation is denied before execution. Confirm side-effect state for both. |
| Trace linkage | Each relevant execution has ordered identity, permissions, PII, injection, budget, provider-selection, tool-authorization, execution and audit stage records, with `not_applicable` where appropriate. Missing trace records fail the full-traceability claim. |
| Audit | Matching `audit_events.request_id` and decision/result for each request; the database trigger prevents UPDATE/DELETE and ordinary roles lack those grants. A trigger check proves configuration, not indefinite retention or external tamper resistance. |
| Replay | Reusing an idempotency key produces no second upstream call or tool side effect. Do this only after the first request has a known terminal state. |

## Read-only evidence queries

Run using the connected production database after each test. Store returned
IDs and counts, not prompt or response content. Replace the UUID placeholder
with the actual request ID returned by the gateway.

```sql
SELECT id, org_id, actor_type, source, provider, model,
       decision::text, status, redacted, input_tokens, output_tokens,
       cost_usd, latency_ms, policy_version, created_at
FROM public.requests
WHERE id = '<REQUEST_UUID>'::uuid;
```

```sql
SELECT id, action, resource, resource_id, decision::text, result,
       request_id, created_at
FROM public.audit_events
WHERE request_id = '<REQUEST_UUID>'::uuid
ORDER BY created_at, id;
```

```sql
WITH matched_execution AS (
  SELECT DISTINCT execution_id
  FROM public.execution_events
  WHERE request_id = '<REQUEST_UUID>'::uuid
)
SELECT e.execution_id, e.request_id, e.stage, e.status,
       e.summary, e.created_at, e.id
FROM public.execution_events e
JOIN matched_execution m USING (execution_id)
ORDER BY e.id;
```

```sql
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260920000100', '20260921000100')
ORDER BY version;
```

```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.audit_events'::regclass
  AND tgname = 'audit_events_immutable'
  AND NOT tgisinternal;
```

Early execution events have a null `request_id`; the final audit-stage event
links the execution ID to the request. An execution with no linked final event
fails this query and needs investigation.

Do not test immutability by mutating a production audit row. Use a disposable
isolated database transaction or the existing database test suite to exercise
the rejection trigger.

## Evidence bundle manifest

Record the UTC time, deployed commit SHA, production URL, model key, policy
version, request IDs, execution IDs, sanitized HTTP responses, the read-only
query outputs above, CI run URL, and a screen recording. Redact bearer tokens,
provider keys, mailbox data, raw prompts, and user identifiers before sharing.

If a provider call fails, collect its **safe error class** from server logs,
check provider credential presence/entitlement, model name, endpoint allowlist,
upstream status and network reachability. Never retry an ambiguous timeout
automatically; it may already have incurred provider charges.
