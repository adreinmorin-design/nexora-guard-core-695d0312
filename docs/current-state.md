# Nexora Current State

> Evidence-backed snapshot. Do not promote product capabilities based on code existence or repository tests alone.

## Snapshot

- Repository: `adreinmorin-design/nexora-guard-core-695d0312`
- Branch: `main`
- Implementation baseline verified in CI: `dc0150ec5f716b5816a1dcf938ba8e6f3bce1bbf`
- Snapshot date: 2026-09-26
- CI run: `36252888633`
- CI artifact: `10909992025`
- Artifact digest: `sha256:a8a3de5b261082753937081b57193ba944b08ed83196e7f0bb8a408058e8f2c8`

Documentation-only commits may be newer than the implementation baseline above.

## Governance Core Integration — IMPLEMENTED + CI VERIFIED

PR #24 integrated the governed execution work from the superseded PR #21 onto the current main history without rewriting Lovable-connected history.

The merged implementation includes:

- first-class intents and governed executions
- identity / intent / execution linkage
- intent lineage events
- PRE_EXECUTION governance decisions
- PRE_MODEL_INVOCATION and PRE_RESPONSE boundaries
- governed MCP/tool authorization paths
- budget admission before provider dispatch
- PII redaction before forwarding
- tamper-evident governance audit hashing
- immutable governance evidence / lineage database controls
- risk accumulation and quarantine semantics
- retrospective policy evaluation
- governance migration and tests

PR #21 is closed as superseded.

## Repository Verification — RUNTIME_VERIFIED FOR REPOSITORY/CI CONTEXT

GitHub Actions run `36252888633` completed successfully on the merged main implementation baseline.

The complete verification runner reported:

- 16 verification groups passed
- 0 verification groups failed
- gateway tests: 21 passed, 0 failed
- governance core tests: 6 passed, 0 failed
- security tests: 3 passed, 0 failed
- provider tests: 4 passed, 0 failed
- Paddle tests: 4 passed, 0 failed
- billing tests: 2 passed, 0 failed
- database migration tests: 1 passed, 0 failed
- hardening/auth runtime tests: 5 passed, 0 failed
- monitoring tests: 3 passed, 0 failed
- email tests: 2 passed, 0 failed

The runner also passed dependency audit, Prettier, ESLint, TypeScript, and production build.

Repository tests prove implementation behavior in the CI/test environment. They do not by themselves prove live production execution.

## Production Lovable Deployment — DEPLOYED

Direct Lovable readback after the merge reports:

- project id: `f46c7dc2-f8c6-4710-96bb-07ffc11e5270`
- project name: Nexora
- published: true
- project status: ready
- latest synced commit: `dc0150ec5f716b5816a1dcf938ba8e6f3bce1bbf`
- production URL: `https://nexora-guard-core.lovable.app`
- explicit republish deployment id: `972d133b-8f48-48a1-8685-5f44272f1b80`

The available external HTTP inspection tool could not access the Lovable hostname, so a successful public HTTP response is not claimed from this environment.

## Production Governance Database Migration — RUNTIME_VERIFIED

The production Lovable/Supabase database initially did not contain the new governance tables.

Migration `20260925000100_governed_execution_core.sql` was applied directly to the connected production database.

Post-migration direct readback verified RLS enabled on:

- `intents`
- `governed_executions`
- `governance_audit_events`
- `governance_audit_heads`
- `intent_lineage_events`
- `governance_risk_thresholds`

Direct function privilege inspection verified:

- `nexora_append_governance_event` is SECURITY INVOKER
- `nexora_record_execution_risk` is SECURITY INVOKER
- neither is executable by `anon`
- neither is executable by `authenticated`
- both are executable by `service_role`

## Existing Production Database Security Evidence — RUNTIME_VERIFIED

Previously captured direct production evidence remains valid for:

- production database connectivity
- RLS enabled across application tables
- anonymous data boundary
- no inspected anonymous/public SECURITY DEFINER exposure
- authenticated non-member negative-path isolation

Full two-real-tenant isolation remains unverified.

## Production Provider Configuration — CONFIGURED, LIVE EXECUTION NOT VERIFIED

Direct production database readback observed:

- OpenAI provider status: active
- credential_state: `MANAGED`
- three active OpenAI models
- Anthropic and Google records exist but are not configured for live credentials

A configured provider record is not proof of a successful live provider invocation.

## Product Runtime Capabilities Still Requiring Direct Evidence

Do not promote these to `RUNTIME_VERIFIED` until direct live evidence is captured:

- interactive authentication through the deployed application
- full identity → tenant → intent runtime flow
- true tenant-A versus tenant-B isolation using two authorized identities
- policy allow path with a real downstream provider response
- policy deny path proving zero downstream provider dispatch
- PII redaction immediately before live provider forwarding
- prompt-injection enforcement before a privileged live action
- hard budget denial proving zero billable provider calls
- live provider routing and usage attribution
- live MCP/tool allow and deny paths
- persistent intent reuse across a real multi-step agent execution
- live audit reconstruction from intent_id / execution_id / request_id
- Paddle sandbox lifecycle and server-side entitlement verification

## Repository Control Blocker

### Main branch protection — FAILED / EXTERNAL ADMIN ACTION REQUIRED

Direct GitHub readback still reports:

- `main` protected: false
- required status-check enforcement: off

The connected GitHub integration and built-in Actions token do not have repository administration permission to enable branch protection. This is not treated as fixed until GitHub reports protection enabled.

## Rule

No product capability moves to `RUNTIME_VERIFIED` without a concrete evidence reference proving the actual live behavior.
