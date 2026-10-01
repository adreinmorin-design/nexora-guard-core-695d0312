# Nexora Current State

## Production verification — 2026-09-30 UTC

This supersedes earlier baselines. Preserve Identity → Intent → Governed Execution → Policy →
Action → Model/Tool Invocation → Result → Evidence. Configuration, rows and CI do not establish
production behavior.

- Exact inspected production implementation: `a60c3bfd0b14e67ff088a57f524cab3b787002ea`.
- Main CI `36792902422` passed on that SHA; PR #43 CI `36792803403` also passed.
- Lovable reports the same latest SHA, published=true, ready. Publish request
  `ae2fd4bb-c047-4722-a17b-199e7439a04b` was accepted. Production browser reload shows the fix.
  Independent served-build SHA attestation remains NOT_VERIFIED.
- PR #42 repaired the brace-expansion security regression with lockfile versions 1.1.21/5.0.12.
  CI `36788107043` passed on `6c96ea31b4a495924bc2269b3d49577c36554bb4`.
- PR #43 fixes a real reporting defect: failed provider execution used to show COMPLETED after
  its audit write succeeded. Active/recent summaries now preserve FAILED/BLOCKED and show audit
  completion separately. Persisted production outcomes verified this after deployment.

This records the tested implementation. Resolve this document's later integration commit with
`git rev-parse HEAD` and verify its own CI/Lovable readback; runtime evidence retains its tested SHA.

## Capability evidence

Every RUNTIME_VERIFIED label below has concrete evidence in
`docs/evidence/2026-09-30-runtime-verification.json`, with browser observations in
`docs/evidence/2026-09-30-protected-access.json` and
`docs/evidence/2026-09-30-runtime-outcomes.json`.

| Capability                                    | Status           | Actual result / remaining proof                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing-user authenticated protected access  | RUNTIME_VERIFIED | Manual deployed sign-in produced a valid session; protected Requests returned server-backed tenant history. Evidence `/protected_access`. Signup/email UX is separate.                                                                                                                 |
| Execution outcome display                     | RUNTIME_VERIFIED | Deployed fix preserves FAILED/BLOCKED despite later audit completion. Evidence `/outcome_display`.                                                                                                                                                                                     |
| Signup/email lifecycle                        | NOT_VERIFIED     | Direct disposable Auth creation/administrative confirmation is setup, not public signup/email UX proof.                                                                                                                                                                                |
| Two-user / two-tenant isolation               | NOT_VERIFIED     | Run 36791629265/job 110145611471 authenticated two users and inserted two organizations; founder membership POST returned 403 before the four assertions. Replacement 36793077038/job 110150217165 separates write from protected read and timed out awaiting sessions. RLS unchanged. |
| Governed provider ALLOW                       | FAILED           | Harmless LOG request and separate REDACT request reached dispatch but returned provider_error. No successful provider response/usage/full intent linkage.                                                                                                                              |
| Governed DENY / zero invocation               | NOT_VERIFIED     | Injection request paused for approval; independent downstream zero-call evidence is absent.                                                                                                                                                                                            |
| PII masking                                   | NOT_VERIFIED     | Synthetic numeric timestamp triggered phone REDACT; immediate pre-forward payload was not captured.                                                                                                                                                                                    |
| Injection before privileged action            | NOT_VERIFIED     | Console prompt triggered REQUIRE_APPROVAL/pending_approval and withheld output. No privileged tool was requested.                                                                                                                                                                      |
| Hard budget / zero billable calls             | NOT_VERIFIED     | No complete denied-operation billing proof. Failed requests recording zero usage do not prove zero upstream billing.                                                                                                                                                                   |
| Routing / attribution                         | NOT_VERIFIED     | openai/gpt-4o-mini selected in trace; successful response and tenant/intent/execution usage/cost linkage missing.                                                                                                                                                                      |
| MCP authorization                             | NOT_VERIFIED     | Controlled external fixture and deployed origin/credential configuration unavailable through current connectors.                                                                                                                                                                       |
| Multi-step persistent intent / forensic chain | NOT_VERIFIED     | No successful live multi-step chain reconstructed.                                                                                                                                                                                                                                     |
| Paddle / server entitlements                  | NOT_VERIFIED     | Sandbox lifecycle/secret access unavailable; no live customer charge made.                                                                                                                                                                                                             |

Protected identity: user `b74c83ab-5488-4517-9c6c-a9ff1d4a75cc`, org
`9949362e-405f-4fef-9596-12d47f4239b7`. Historical invalid-login/session evidence stays separate in
`docs/evidence/2026-09-30-live-inspection.json` and run `36364520249`, job `108748168833`
(anonymous agent request and invalid PostgREST bearer each HTTP 401).

Provider failure on implementation `6c96ea31b4a495924bc2269b3d49577c36554bb4`:
request `fde06fa9-c3ef-47d4-84eb-ad86429b1a2a`, execution
`32c9c05b-1d16-490d-8559-f3193a28a8ba`, upstream request
`req_bb13af116fc64e3a892a98b27aa1bc0e`, 2026-09-30T23:37:30Z.
Execution event 93 failed; audit event 95 completed. Response ID absent; recorded tokens/cost zero.
This is failure evidence, not successful ALLOW or zero-call proof. Intent IDs/newer request IDs were
not retrieved because the database connector timed out. Injection execution prefix `644c2742`
appeared BLOCKED at 23:47:08Z; full reconstruction remains incomplete.

## Database and repository controls

Initial 22:42Z inspection found all 36 public tables with RLS and no inspected public function
executable by anon/authenticated. Initial zero counts are historical, not current counts or runtime
proof. Production events 85–95 were later retrieved. Subsequent queries returned HTTP 504
`MCP request timed out`; separate Supabase connector inventory is empty.

Bootstrap migration `20260929000300` is present. History versions `20260920000100`,
`20260925000100`, `20260929000200` remain absent despite related objects existing. Reconcile
definitions/privileges/constraints before recording history; do not blindly replay DDL.

Legacy PRs #19/#20 remain nonmergeable; issue #22 remains open. Main is unprotected. GitHub
administration returns HTTP 403 `Resource not accessible by integration`. A workflow file is not
an enabled rule. The workflow template now requires one review, dismisses stale approvals,
and leaves linear history off. It requires manual dispatch after admin credentials are configured;
this is implementation, not protection verification.

## Exact external actions and continuation

1. Inspect OpenAI request `req_bb13af116fc64e3a892a98b27aa1bc0e` in the provider dashboard.
   Diagnose the rejection and restore deployment credentials/quota/GPT-4o Mini access as needed.
   Do not share secrets in chat. Resume with harmless ALLOW and full response/intent/execution proof.
2. Replacement run expired at 2026-10-01T00:02:42Z before authentication or isolation assertions.
   Use a fresh disposable harness and confirm its verification inbox messages. Previous addresses were `adreinmorin+nxproof-a-36793077038-1@gmail.com` and
   `adreinmorin+nxproof-b-36793077038-1@gmail.com`. Timed-out administrative
   confirmation has unknown outcome; inspect before repeating.
   Do not disable global email confirmation.
3. Owner: GitHub Settings → Branches → main. Require PRs, strict/up-to-date `validate`, resolved
   conversations, admin enforcement, no force pushes/deletions and one independent reviewer.
   Leave linear history off for existing merge commits. The connection lacks Administration.
   Alternatively configure repository-scoped `BRANCH_PROTECTION_TOKEN` with Administration
   read/write through GitHub; then manually dispatch the corrected protection workflow.
4. Restore production database connector access and configure sandbox Paddle plus a controlled
   live MCP fixture through deployment configuration. Complete masking, denied-call, budget,
   tool, persistent-intent and entitlement proofs in the requested order with durable evidence.

Controlled design-partner pilot readiness is NOT ESTABLISHED. Broader production readiness is
NOT ESTABLISHED. Provider execution, tenant assertions, repository protection, migration
reconciliation and remaining runtime proofs prevent release sign-off.
