# Nexora Current State

> Evidence-backed snapshot. Do not promote product capabilities based on code existence or repository tests alone.

## Snapshot

- Repository: `adreinmorin-design/nexora-guard-core-695d0312`
- Branch: `main`
- Production implementation baseline: `a3fc42213d2d240e016cf05bc2cbe383a6253b88`
- Current `main` head: `4953fd096b4038061f660fd4046ff01fa526e178`
- Latest verified main CI: run `36364668266` (success)
- Snapshot date: 2026-09-27
- CI run: `36279267631`
- CI artifact: `10917808932`
- Artifact digest: `sha256:73bf8b9953a3e97d7af1b25faa130dbaaab560e19b605fa875fc5611388a480e`

Post-proof verification-harness, workflow, and documentation commits may be newer than the production implementation baseline above. No governed-execution core rewrite was performed.


## 2026-09-27 Production Verification Progress

Repository/deployment evidence captured after the original governance baseline:

- verification-harness PR #29 merged as `87d6397ec3e1d737e0e61e5b150bf534d9cbd12e`; PR CI run `36362509373` passed
- live tenant-isolation harness reruns now use unique users and tenant slugs per GitHub run attempt, preventing stale-account collisions without disabling email confirmation
- production smoke run `36364520249`, job `108748168833`, passed against the live deployment:
  - `GET /` = 200
  - `GET /auth` = 200
  - anonymous `POST /api/agent` = 401
  - deliberately invalid user bearer session against production Supabase/PostgREST = 401
- invalid-session smoke change merged in PR #30 as `b1e33e710e0996de5ed0a20e37af74ab1a9fc3ef`
- branch-protection activation change merged in PR #31 as `4953fd096b4038061f660fd4046ff01fa526e178`
- main CI run `36364668266` passed on `4953fd096b4038061f660fd4046ff01fa526e178`
- Lovable readback reports `latest_commit_sha=4953fd096b4038061f660fd4046ff01fa526e178`, published=true, project status=ready

These facts strengthen deployment and negative-authentication evidence. They do **not** prove a successful valid login, tenant isolation, provider execution, policy allow/deny, PII forwarding state, prompt-injection enforcement, hard-budget zero-dispatch, MCP/tool invocation, intent persistence, full trace reconstruction, or Paddle lifecycle.

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

GitHub Actions run `36279267631` completed successfully for head SHA `a3fc42213d2d240e016cf05bc2cbe383a6253b88`. Because this was a verification-only pull request, Actions checked the synthetic merge commit `e1471455498fbf3f842a84fd156d165edf1210fa`; direct commit comparison showed zero changed files between that merge commit and `a3fc42213d2d240e016cf05bc2cbe383a6253b88`, so the tested tree was identical to the integrated HEAD.

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

## Production Lovable Deployment — RUNTIME_VERIFIED

Exact deployment sequence evidence:

- production implementation SHA: `a3fc42213d2d240e016cf05bc2cbe383a6253b88`
- Lovable project id: `f46c7dc2-f8c6-4710-96bb-07ffc11e5270`
- Lovable readback before and after deploy: `latest_commit_sha=a3fc42213d2d240e016cf05bc2cbe383a6253b88`
- project published: true
- project status: ready
- explicit deployment id: `a4eae11e-2849-4593-bcc3-bf0eea9fa84c`
- production URL: `https://nexora-guard-core.lovable.app`

Post-deploy live production smoke evidence:

- GitHub Actions run: `36279456208`
- smoke job: `108508386247`
- `GET /` returned HTTP 200
- `GET /auth` returned HTTP 200
- unauthenticated `POST /api/agent` returned HTTP 401
- response body: `{"error":"Valid agent bearer credential required."}`

This verifies that the published production host is live and that the protected agent endpoint fails closed for an anonymous request. It does not prove successful interactive login, authenticated agent execution, provider invocation, policy allow/deny behavior, tenant isolation, or other unexercised runtime capabilities.

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

- successful valid authentication through the deployed application (the auth route is reachable; anonymous agent access and a deliberately invalid user bearer session are both rejected with HTTP 401; valid login is not yet proven)
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

The repository now contains an activated protection workflow. GitHub Actions run `36364668290` proved that `BRANCH_PROTECTION_TOKEN` is configured, but the protection PUT returned HTTP 403 with `Resource not accessible by personal access token`. The remaining blocker is the token's repository-administration permission (or an equivalent direct GitHub Settings action). This is not treated as fixed until GitHub reports protection enabled.

## Rule

No product capability moves to `RUNTIME_VERIFIED` without a concrete evidence reference proving the actual live behavior.
