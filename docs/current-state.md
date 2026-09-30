# Nexora Current State

## Dependency audit repair — 2026-09-30

Fresh CI run `36787600726` failed the high-severity audit on four brace-expansion
advisories; the other 15 verification groups passed. A targeted transitive update
changed only the locked brace-expansion versions from 1.1.18 to 1.1.21 and from
5.0.9 to 5.0.12. Repair workflow `36787823073`, artifact `11130477483`, passed
the high-severity audit with those versions. Package manifests, policy code and
security gates are unchanged. Full CI on the final repair head remains required
before integration; production behavior still needs the ordered live proofs below.

## Current inspection — 2026-09-30

This snapshot supersedes earlier baselines. No major product capability was newly runtime verified.
Historical evidence is preserved in `docs/evidence/2026-09-29-ledger-superseded.yaml`; earlier labels
based only on CI, schema, rows, or configuration do not establish production behavior.

- Inspected main / implementation SHA: `f54b698b23e176473fac9e8eeb0c92294edbeb1a`.
- CI run `36612760244`, job `109558068871`, completed successfully on that SHA.
- Lovable project `f46c7dc2-f8c6-4710-96bb-07ffc11e5270` reports that exact latest SHA,
  published=true, status=ready. This is connector readback; independent served-build attestation
  remains NOT_VERIFIED.
- Production migration `20260929000300_org_bootstrap_rls_fix` is in history. The live membership
  INSERT policy requires the creator's own authenticated identity for initial org_admin bootstrap.
- All 36 public tables inspected have RLS enabled. None of the inspected public functions is
  executable by anon or authenticated. These are configuration observations, not isolation proof.
- Repository migration versions `20260920000100`, `20260925000100`, and `20260929000200` are
  absent from production migration history. Related AI-control/governance objects exist, so
  schema/history reconciliation needs definition-level verification before recording migration
  history. Do not blindly replay non-idempotent migrations.
- Production has zero governed_executions, governance_audit_events, tool_invocations, and
  paddle_webhook_events at inspection. This does not prove the controls fail; it means these stores
  supply no existing positive-path evidence.
- Open PRs: #19 and #20, both old and nonmergeable. Open issue: #22. No newer main CI regression
  was observed. Do not merge stale branches without comparing their changes against current main.
- Main protected=false, required-check enforcement=off. The connector's protection read returned
  HTTP 403, `Resource not accessible by integration`; administration is unavailable through it.

Reproducible inspection evidence and timestamps: `docs/evidence/2026-09-30-live-inspection.json`.

## Authentication gate

The deployed `/auth` form rendered. Secure sign-in submitted and the application returned
`Invalid login credentials`. No credentials were read or recorded. Signup/email-confirmation,
successful application login, and authenticated protected application access remain NOT_VERIFIED.
This is a credential rejection observation, not proof that application authentication is broken.

Preserve historical negative evidence separately: run `36364520249`, job `108748168833`, recorded
anonymous agent API rejection and invalid user JWT rejection (HTTP 401). Direct valid password
sessions and protected organization inserts were recorded in run `36363244693`, attempt 3,
job `109201239548`; those do not prove application signup/login or two-tenant isolation.

## Product capability status

| Capability                                 | Current verification status | Remaining proof                                                                   |
| ------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------- |
| Deployed signup/login and protected access | NOT_VERIFIED                | Usable disposable account, signup confirmation, signed-in application resource    |
| Two-user / two-tenant isolation            | NOT_VERIFIED                | A→A, B→B allowed; A→B, B→A denied                                                 |
| Governed provider ALLOW                    | NOT_VERIFIED                | Actual response, provider IDs, usage/cost and intent/execution/audit linkage      |
| Governed DENY                              | NOT_VERIFIED                | Pre-egress denial plus independent downstream zero-invocation proof               |
| PII masking                                | NOT_VERIFIED                | Sanitized payload immediately before external forwarding                          |
| Prompt injection enforcement               | NOT_VERIFIED                | Privileged-action denial before execution                                         |
| Hard budget                                | NOT_VERIFIED                | Denied operation with zero billable provider calls                                |
| Routing and attribution                    | NOT_VERIFIED                | Actual selected provider/model and tenant/intent/execution costs                  |
| MCP/tool authorization                     | NOT_VERIFIED                | Controlled real tool succeeds when authorized; denied before invocation otherwise |
| Persistent multi-step intent               | NOT_VERIFIED                | One live intent retained through model/tool steps                                 |
| Audit reconstruction / immutability        | NOT_VERIFIED                | Reconstruct real production chain and prove mutation rejection                    |
| Paddle lifecycle / entitlements            | NOT_VERIFIED                | Sandbox webhook lifecycle and server-side allow/deny enforcement                  |

Do not infer missing provider secrets from this inspection: deployed credential validity and quota
are unknown until exercised. No live payment was taken and no customer entitlement was altered.

## Required external actions and continuation

1. Complete secure login with an existing disposable account, or manually create and confirm one
   in the deployed application. Resume by proving authenticated protected access before the
   ordered tenant/provider/tool/agent/billing proof chain.
2. Repository owner: enable protection for main in GitHub Settings → Branches. Require PRs,
   strict/up-to-date `validate`, resolved conversations, apply to administrators, and disallow
   force pushes and deletion. Leave linear-history enforcement off to support non-rewriting
   merge commits. Use an independent required approval once a reviewer is available; a solo
   author cannot approve their own PR. Alternatively replace BRANCH_PROTECTION_TOKEN with a
   repository-scoped credential having Administration read/write, then correct the workflow's
   linear-history setting and verify the resulting rules. Never share this token in chat.
3. Compare complete production definitions/privileges/constraints/triggers with the three missing
   history migrations. Repair only proven differences, then reconcile history with evidence.

Controlled design-partner pilot readiness is NOT ESTABLISHED. Broader production readiness is
NOT ESTABLISHED. Architecture and tests remain intact; completion requires the real-runtime proof
chain plus enabled repository protection and migration reconciliation.

A later documentation commit does not retroactively attest another deployed build. Record its
exact resulting main SHA, CI and Lovable readback separately after integration.
