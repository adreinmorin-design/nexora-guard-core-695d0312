# Nexora verification — October 17, 2026 Pacific / October 18 UTC

**Release sign-off: NOT ESTABLISHED.** Repository validation passes except the dependency audit. Full authenticated end-to-end verification is blocked. No production capability was promoted on the basis of code, configuration, stored rows or unit tests.

## Baseline and evidence integrity

- Repository and Lovable latest commit: `ef9bf7aa391dba7c82a6f1bc7fdbc6133bb15e67`.
- Lovable: published, ready. This is deployment metadata; the served binary has no independent SHA attestation.
- Existing CI run `36798448209`, validate job `110167161826`: success on this commit, dated October 1. It is historical CI, not a new run.
- Main still reports `protected=false`.
- Source files were retrieved at the immutable SHA. Git blob hashes were checked against the recursive tree; all 213 initially retrieved text files matched after correcting a transfer-added trailing newline. Static assets and `.env.example` were subsequently retrieved separately. No application code was changed.
- Detailed observations: `2026-10-18-verification.json`; raw live HTTP results: `2026-10-18-http-verification.json`; logs: `2026-10-18-checks/`.

## Repository validation

Node `v24.19.0`, Bun `1.4.2`, committed `bun.lock`, `bun install --frozen-lockfile --ignore-scripts`.

| Check                            | Result                                        | Evidence                          |
| -------------------------------- | --------------------------------------------- | --------------------------------- |
| All 13 repository test files     | PASS: 67 tests, 0 failed                      | `2026-10-18-checks/tests.log`     |
| ESLint                           | PASS                                          | `2026-10-18-checks/lint.log`      |
| TypeScript                       | PASS                                          | `2026-10-18-checks/typecheck.log` |
| Prettier on pristine source      | PASS                                          | `2026-10-18-checks/format.log`    |
| Production build                 | PASS                                          | `2026-10-18-checks/build.log`     |
| Dependency audit, high threshold | FAIL: 6 advisory entries, 4 critical / 2 high | `2026-10-18-checks/audit.log`     |

An early dependency-free test attempt failed to load four test files because required packages were absent; the installed-dependency runs passed. An early formatting run found transport-added newlines; those were removed and every source hash rechecked before the final test/format run. Neither preliminary harness/setup problem is reported as a product defect.

Reproduce from the tested commit:

```bash
bun install --frozen-lockfile --ignore-scripts
node --import ./tests/resolve-ts.mjs --test tests/*.test.mjs
bun run lint
bunx tsc --noEmit
bun run format:check
bun run build
bun audit --audit-level=high
python3 scripts/live-verification-20261018.py
```

The HTTP script performs bounded public requests, including an invalid Paddle webhook. That endpoint may trigger configured security alerts. It does not invoke a model, accept a payment or require a credential.

## Dependency findings and remediation

These are confirmed affected-version matches, not demonstrated exploitability in Nexora. Six advisory entries affect five installed package names; the TanStack advisory appears for both its direct and transitive packages.

| Installed package                      | Advisory / severity                                      | Published fixed version                                                | Context and next step                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tanstack/react-start@1.168.32`       | GHSA-qx66-fv34-fjm8, critical                            | `1.168.60`                                                             | Server-function reflected XSS; align framework packages, rebuild and test the live transport.                                                                    |
| `@tanstack/start-server-core@1.169.17` | Same TanStack advisory, critical                         | `1.169.39`                                                             | Transitive server runtime; validate the resolved lockfile, not only the direct version.                                                                          |
| `seroval@1.5.6`                        | GHSA-p6vx-979v-rg4c, critical; GHSA-jp82-f5mq-hwhp, high | Critical advisory: `1.6.2`; high advisory audit range includes `1.6.2` | Choose a release outside both affected ranges and verify framework compatibility. No unsafe deserialization or memory-exhaustion payload was sent to production. |
| `shell-quote@1.10.0`                   | GHSA-pqg4-j6r4-53mv, critical                            | `1.11.0`                                                               | Dependency path runs through Lovable Vite config/devtools/launch-editor. Production remote-code execution is not established.                                    |
| `source-map-js@1.2.1`                  | GHSA-68fv-2mgg-jv7q, high                                | `1.2.2`                                                                | Build-tool dependency paths through Tailwind/PostCSS. No denial-of-service test performed.                                                                       |

Official advisory sources were checked October 18 UTC:

- https://github.com/advisories/GHSA-qx66-fv34-fjm8
- https://github.com/advisories/GHSA-p6vx-979v-rg4c
- https://github.com/advisories/GHSA-jp82-f5mq-hwhp — direct research fetch failed; affected range comes from the captured audit.
- https://github.com/advisories/GHSA-pqg4-j6r4-53mv
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q

## Live HTTP and browser checks

| Probe                                               | Observed result                                     | Scope                                                                            |
| --------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Home, auth, pricing, terms, privacy, refund         | Six HTTP 200 responses                              | Public availability only                                                         |
| Agent API missing/malformed bearer                  | HTTP 401                                            | Credential syntax rejection; not valid-agent execution                           |
| MCP GET                                             | HTTP 405                                            | Method restriction                                                               |
| MCP cross-origin POST                               | HTTP 403, `Origin denied`                           | Origin rejection                                                                 |
| MCP anonymous tools/list                            | HTTP 401                                            | Authentication rejection                                                         |
| Unsigned Paddle webhook                             | HTTP 401, `Invalid signature`                       | Signature rejection only; lifecycle/replay/entitlements not proved               |
| Invalid database bearer and anonymous organizations | HTTP 403, `error code: 1010`                        | BLOCKED before a verified PostgREST response; no RLS/session conclusion          |
| Browser existing-user sign-in                       | `Invalid login credentials` after secure submission | Positive session unavailable; does not establish all users are unable to sign in |
| Public business footer                              | `NEXORA · DreEnt. LLC`                              | Incorrect relative to owner-confirmed sole proprietorship                        |

Twelve HTTP checks pass and two are blocked. The first Paddle harness expectation was incorrectly set to 400; source inspection confirmed 401 is correct, and both the saved result and reproduction script record the correction. No failed product assertion is hidden by that classification.

The browser loaded the public app and sign-in UI. Credential values were handled by secure browser authentication and were not captured. No authenticated protected screen was reached. No screenshot containing credentials was retained.

## Production database inspection

Successful read-only queries at `2026-10-18T03:12:29Z` showed:

- All 36 public tables have RLS enabled; no inspected public SECURITY DEFINER function is executable by anon/authenticated.
- Nine request rows: eight `provider_error`, one `pending_approval`. These persisted historical outcomes are not fresh provider invocations.
- Three intents, three governed executions, zero tool invocations, zero Paddle webhook events.
- One registered MCP server and one tool; registration is not execution proof.
- Twenty migration-history versions. `20260920000100`, `20260925000100` and `20260929000200` remain missing from history despite related objects existing. Do not replay non-idempotent migrations solely because history is missing.
- Two previously created, confirmed verification users have separate organization memberships. Their existence does not prove current isolation.

The subsequent authenticated-role isolation query was **not executed**: Lovable returned its free-plan MCP database-action limit, with retry in 55 minutes. No RLS assertions or agent fixture creation completed in this run. The direct disposable signup harness also stopped on a non-JSON backend rejection; no newly created account was confirmed.

## Capability disposition

| Capability                                           | Current run                     | Missing proof                                                                                    |
| ---------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Existing-user protected access; execution outcome UI | NOT_VERIFIED                    | Valid current browser session; older successful evidence remains historical                      |
| Signup/email lifecycle                               | NOT_VERIFIED                    | Public signup, delivered confirmation and verified session                                       |
| Two-user/two-tenant isolation                        | NOT_VERIFIED                    | A→A and B→B allowed; A→B and B→A denied under valid sessions                                     |
| Governed provider ALLOW/routing/usage                | BLOCKED; prior failure retained | Harmless successful invocation, response, tokens/cost and full identity/intent/execution linkage |
| Policy DENY, hard budget                             | NOT_VERIFIED                    | Live denial plus independent downstream zero-invocation evidence                                 |
| Immediate pre-forward PII masking                    | NOT_VERIFIED                    | Sanitized payload evidence immediately before actual forwarding                                  |
| Injection before privileged action                   | NOT_VERIFIED                    | Real bounded privileged operation stopped before invocation                                      |
| MCP and tools                                        | NOT_VERIFIED                    | Live authorized and denied calls with receiver-side evidence                                     |
| Persistent multi-step intent / audit reconstruction  | NOT_VERIFIED                    | Successful multi-step live trace and hash/link reconstruction                                    |
| Paddle / server entitlements                         | NOT_VERIFIED                    | Sandbox checkout, renewal/failure/cancellation, replay and server enforcement                    |

## Next execution order

1. Obtain a valid protected browser session through secure sign-in; retain the current invalid-login evidence.
2. Once the database-action quota resets, run the four tenant assertions using two disposable confirmed sessions. Do not disable email confirmation or treat role impersonation as JWT validation.
3. Update affected dependencies on a separate branch, retain compatible lockfile pins, run the complete suite and audit, then deploy and attest the exact new build.
4. Execute one harmless governed provider request. If it fails ambiguously, reconcile upstream request ID before any retry. Then complete DENY/zero-call, PII, budget, tools, multi-step and billing proofs.
5. Reconcile migration definitions/history, enable main protection with administrator access, and correct the sole-proprietor designation before customer-facing launch.

No production configuration, schema, policy, credential or billing changes were made by this verification run. Application source remains unchanged; this evidence update does not make Nexora production-ready.
