# Independent runtime dependency assessment

Inspected 2026-10-06. Source baseline: `ef9bf7aa391dba7c82a6f1bc7fdbc6133bb15e67`.
Lovable project: `f46c7dc2-f8c6-4710-96bb-07ffc11e5270`. No production write,
migration, credential change, publication, or DNS change was performed.

## Evidence and boundaries

- Live main and Lovable `latest_commit_sha` agree on the source baseline.
  Lovable reports published and ready. This is control-plane readback, not a
  served-build attestation. Main CI run `36798448209` completed successfully.
- Main is reported unprotected. Branch protection is still a release blocker.
- Lovable database status reports enabled, stack Supabase. Read-only SQL works
  as `postgres`, engine PostgreSQL 17.6. This is delegated SQL access through
  Lovable, not independent possession of a database connection credential.
- Connected Supabase inventory contains only Desert Web Sprint Tracker, ref
  `sspntpbnpsdmldqotjqp`; it is a different application and is not a destination
  for Nexora. Nexora is absent from that inventory.
- Application public configuration points to
  `https://c--f46c7dc2-f8c6-4710-96bb-07ffc11e5270-prod.lovable.cloud`.
  Together these facts strongly support a Lovable-managed backend. The
  underlying Supabase organization owner and project ref are not independently
  exposed by the available APIs. `supabase/config.toml` contains the historical
  ref `yfkgobpedsmkmpzdabsq`; it does not prove ownership of the current backend.
- No available connector returns deployment secrets, service-role credentials,
  direct PostgreSQL URLs, auth redirect configuration, or edge-function inventory
  for this Lovable Cloud backend. Server code requires a service-role credential;
  successful historical writes demonstrate privileged execution, not access to
  the key from an independent deployment.

## Concrete dependency map

| Component               | Execution / dependency                                                                                        | Independent path / limitation                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Console                 | React 19 / TanStack Start SSR and browser assets                                                              | Same code, Node/Nitro output                                                                                    |
| Server functions        | `src/lib/nexora.functions.ts`, authenticated POST handlers                                                    | Execute inside the application server, not a separate Edge Function                                             |
| Gateway                 | `submitGatewayRequest` → workspace resolution → `runConsoleRequest` → `runGovernedRequest` → provider adapter | Preserve existing identity, intent, policy, DLP, admission, invocation and audit code                           |
| Agent/MCP               | `/api/agent`, `/api/mcp`, server modules                                                                      | Same application server; origin and credential enforcement stay intact                                          |
| Original build          | `@lovable.dev/vite-tanstack-config` injects plugins/env; Nitro defaults to Cloudflare                         | Preserve `vite.config.ts`; independent build uses explicit upstream plugins and `node_server`                   |
| SSR wrapper             | `src/server.ts`, TanStack server-entry fetch adapter                                                          | Reused by a portable entry; adds liveness, commit and correlation metadata                                      |
| Public backend config   | Vite defines plus hardcoded Lovable URL/publishable fallback                                                  | Portable build/start require explicit config and check build/runtime consistency, preventing fallback use       |
| Server secrets          | Existing `process.env` lookups, Lovable runtime supplies current values                                       | New host supplies runtime env; never use `VITE_` names for privileged values                                    |
| Database                | Supabase HTTP Data API, user bearer client plus service-role client/RPC                                       | No persistent direct PostgreSQL connection required by app; independent service-role access remains unavailable |
| Browser auth            | Supabase sessions; signup/recovery use `window.location.origin`                                               | Destination `/auth` must be explicitly allowlisted in backend auth settings; settings currently unobserved      |
| Agent connection URLs   | Current browser origin + `/api/agent` / `/api/mcp`                                                            | Reconfigure external clients after cutover; no hardcoded Lovable host here                                      |
| Email                   | `imapflow`, `nodemailer`, SMTP 465 / IMAP 993; database Vault credential storage                              | Requires Node sockets and permitted outbound networking; no mailbox credentials currently stored                |
| Paddle                  | Server signature secrets; webhook `/api/paddle/webhook`; legal/pricing links                                  | Preserve code; destination webhook/domain approval needs separate verification before changing                  |
| Error telemetry         | Optional browser Lovable hooks                                                                                | Calls are optional; independent server emits bounded metadata, suppresses arbitrary error bodies                |
| Cron helper             | `LOVABLE_CRON_SECRET` and previous key                                                                        | Helper exists but has no inspected route caller; no active schedule proved                                      |
| Git sync                | `.lovable/project.json`, connected main sync                                                                  | Work only on separate PR branch; do not merge portability work as a deployment shortcut                         |
| CI                      | GitHub Actions, Bun 1.4.2 / Node 24; original build                                                           | Existing CI retained; separate portability workflow pins Node 24.19.0 and tests built server/container          |
| Runtime proof workflows | Production smoke / isolation hardcode Lovable hosts                                                           | Historical/reference only; configure a separate temporary-host harness after destination exists                 |
| DNS/domain              | Documentation mentions `nexoraguard.shop`; Lovable host remains reference                                     | DNS control credentials and authoritative records unavailable; no cutover authorized by mere deployment         |

The application is stateless at the server filesystem boundary: durable tenant,
policy, intent, quota and evidence state is in Supabase. No local disk database,
long-lived background daemon or always-connected provider stream was found.
A continuously available Node web service preserves all present integrations.
Horizontal scaling additionally requires concurrency/admission testing against
real PostgreSQL; local tests do not establish it.

## Required configuration

| Scope                       | Names / purpose                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Control plane runtime       | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, **server-only** `SUPABASE_SERVICE_ROLE_KEY`                    |
| Portable build              | Explicit public Supabase URL/publishable key and exact `NEXORA_BUILD_SHA`; no privileged credential needed |
| One-provider proof          | Prefer `OPENAI_API_KEY` or existing alias `OPEN_AI_PLATFORM_API_KEY` only when securely available          |
| Existing optional providers | Anthropic / Google keys and compatible vendor names remain supported but are outside this task             |
| Destination restrictions    | `PROVIDER_ALLOWED_ORIGINS`, provider endpoint overrides, `MCP_ALLOWED_ORIGINS`                             |
| Remote MCP                  | `MCP_TOKEN_<SERVER_UUID_WITH_UNDERSCORES>`; no MCP expansion in this phase                                 |
| Billing                     | Paddle client token (public), environment/prices, server-only webhook and checkout-signing secrets         |
| Monitoring                  | Optional `SLACK_WEBHOOK_URL`, `NEXORA_ENVIRONMENT`, `NEXORA_ALERT_MAILBOX_ID`; no alert settings changed   |
| Dormant cron helper         | `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS`; no active schedule established                      |
| Email credentials           | Per-mailbox Vault secrets; not environment keys and not portable by copying ciphertext                     |

Readiness based on an env variable means only configuration exists. No provider
credential was supplied or extracted during this assessment.

## Database reproduction and existing-backend reuse

At inspection: 36 public tables, all RLS-enabled; 63 public policies; 23 public
functions; 17 public triggers; 27 auth users. Existing data counts: 11
organizations, 6 memberships, 9 requests, 3 intents, 3 governed executions,
18 audit events and 6 governance audit events. Storage: zero buckets and
objects. Mailboxes and Vault secrets: zero. These are snapshots, not exports.

Read-only catalog inspection captured column/default definitions, policies,
function definitions/privileges, trigger definitions, constraints, indexes and
extensions. No user records, passwords, private keys or secret values were read.
Repository migrations can reproduce a local database in PGlite, but production
history lacks `20260920000100`, `20260925000100`, `20260929000200` despite related
live objects. Compare actual definitions and dependencies before reconstructing
or recording history. Never blindly replay these migrations into production.

**Reuse verdict: NOT_VERIFIED / blocked on independent credential and origin
control.** The app's HTTP client is technically compatible with using the
existing backend from another host. A privileged runtime credential and auth
configuration access are necessary to prove that route. Delegated connector SQL
is not a safe application database transport and must not be exposed as one.
Unauthenticated HTTP probes from this workspace returned 403 from Cloudflare;
they do not establish whether a correctly configured independent host is allowed.

If secure independent access cannot be obtained, prepare a separate owned
Supabase destination. Do not create it, import production data, or modify the
source until the destination runtime and rollback have been proven.

| Migration area        | Required treatment and acceptance gate                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema                | Export tables/types/sequences/indexes/constraints/extensions; diff catalog against repository; preserve UUIDs and sequence state                                                                                                             |
| Migrations            | Reconcile missing history through definition comparison; rehearse a fresh destination and record the verified baseline                                                                                                                       |
| RLS                   | Export policy definitions, grants and role assumptions; prove A→A, B→B, A↛B, B↛A with separate users                                                                                                                                         |
| Functions/triggers    | Preserve signatures, ownership, security mode, search path, privileges and auth bootstrap triggers; never grant anonymous execution as a workaround                                                                                          |
| Auth users            | Separate managed Auth migration from application rows; preserve UUIDs where supported; password hashes/provider identities/MFA need supported export/import; sessions may need reauthentication; otherwise plan explicit reset/re-enrollment |
| Auth settings         | Recreate signup/email/SMTP/OAuth/redirect/MFA/rate-limit settings through supported management access; secrets entered separately; do not assume settings are in SQL migrations                                                              |
| Storage               | Current count is zero; recheck at export/cutover; migrate object bytes, metadata, buckets and access policies if anything appears                                                                                                            |
| Edge/server functions | Current app routes are in repository; managed Edge Function inventory is unavailable; inspect deployment inventory/schedules before claiming complete reproduction                                                                           |
| Application data      | Export all related tables in consistent snapshot order, preserve evidence/hash chains, memberships, billing/agent IDs, quotas and reservations; verify counts, referential integrity and chain hashes                                        |
| Secrets/configuration | Re-enter from a secure source; re-encrypt Vault secrets for destination if later present; never copy Vault ciphertext or export plaintext into repository/evidence                                                                           |

Rollback before any database switch: immutable old runtime revision, source
database retained, separate temporary hostname, no dual writes, documented
write-freeze/delta capture and explicit treatment of destination-only writes.
Repointing DNS alone cannot roll back divergent database writes. Do not delete
source users/data or revoke source credentials as a migration shortcut.

## Domain and authentication observations

Signup and password recovery derive their callback from the browser origin.
CSRF middleware and MCP origin checks use the request origin. Preserve same-origin
UI/server deployment and test reverse-proxy host/HTTPS behavior. Backend redirect
allowlists, OAuth provider callback registrations, Paddle notification URLs,
external agent endpoints and cookies require explicit inventory before cutover.

Workspace HTTP probes: Lovable `/api/health` returned 403; custom-domain
`/api/health` returned 404 with a LiteSpeed server header. These observations do
not prove authoritative DNS ownership or that the custom domain currently serves
Nexora. Native DNS queries were refused by the workspace resolver. Domain
ownership, records, TLS and current routing remain NOT_VERIFIED.

## Hosting comparison and selection

The actual requirement is a standard Node/Nitro HTTP server, outbound Supabase
and provider HTTPS, and preservation of the existing SMTP/IMAP feature. No new
database or local volume is required for the app server.

| Target                          | Compatibility / secrets                                                      | GitHub, rollback, health, logs, TLS                                      | Near-zero traffic cost / limits                                           | Decision                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Connected Sites                 | Worker runtime, secrets; raw TCP unavailable                                 | Native deploy/version/log/domain tooling; separate source hosting        | Account-specific cost not exposed                                         | Cannot preserve existing mail transport without redesign; not selected                                     |
| Connected Higgsfield websites   | Worker starter + optional containers; secret entry via settings              | Native repo/deploy tooling; production-only publish path                 | Account-specific cost not exposed                                         | No proven arbitrary existing Node-container hosting path; introduces new platform adaptation; not selected |
| Connected Supabase              | Owned project inventory is available; backend/Edge Functions                 | Suitable backend candidate, not full Node app hosting                    | Separate project cost confirmation required                               | Does not host this complete SSR/socket application directly                                                |
| Render paid Node/Docker service | Standard runtime, runtime secrets, SMTP restrictions removed on paid compute | GitHub deploy, previous revision rollback, health checks/logs/custom TLS | $7/month 0.5 CPU / 512 MB, plus applicable usage; capacity must be tested | Lowest-cost evaluated managed option preserving all current behavior                                       |
| Railway Hobby                   | Node/Docker/secrets                                                          | GitHub, rollback subject to retention, startup health/logs/TLS           | $5 minimum including $5 usage, but SMTP blocked                           | Does not preserve existing mail feature                                                                    |
| Railway Pro                     | Node/Docker/secrets and SMTP                                                 | Same capabilities; larger retention/scaling                              | $20 minimum including $20 usage                                           | Technically viable, higher starting cost                                                                   |
| Render free                     | Standard Node/secrets, SMTP blocked                                          | Logs/TLS/limited rollback; sleeps after 15 minutes                       | $0 within limits; provider discourages production                         | Could test basic SSR, does not satisfy complete production behavior                                        |

Selection is **Render paid** among evaluated managed targets, not a claim that
it is the cheapest host worldwide. Rendering capacity, provider latency, egress
and mail reachability still require measurement. Scaling can increase instance
size/replicas; preserve database atomic admission and do not assume in-memory
alert deduplication is shared. A VPS would add patching/TLS/process-supervision
work and is not a currently connected deployment surface.

No Render/Railway management connector or authorized hosting credential is
available in this turn. Provisioning a paid service requires the user's hosting
account/payment boundary. No service was purchased or created.

Sources checked 2026-10-06:

- https://tanstack.com/start/latest/docs/framework/react/guide/hosting
- https://nitro.build/deploy/runtimes/node
- https://render.com/pricing
- https://render.com/docs/free
- https://render.com/docs/configure-environment-variables
- https://render.com/docs/health-checks
- https://render.com/docs/rollbacks
- https://docs.railway.com/pricing/plans
- https://docs.railway.com/networking/outbound-networking
- https://supabase.com/docs/guides/troubleshooting/identify-lovable-cloud-or-supabase-backend

## Remaining gates

Independent cloud deployment, runtime database access, interactive authentication,
tenant isolation, one-provider ALLOW, policy DENY with independent zero-call
evidence, pre-forward DLP payload proof, quota/budget zero-call proof and complete
intent/execution/audit linkage all remain unverified. Only after these pass may
MCP/RBAC verification resume. Preserve all historical evidence with its original
environment/revision; it does not transfer automatically to the independent host.

The inspected baseline lockfile reports two critical and two high advisories
across seroval 1.5.6, shell-quote 1.10.0 and source-map-js 1.2.1. The portability
branch pins patched transitive versions 1.6.3, 1.11.0 and 1.2.2 respectively.
This does not remediate the untouched production deployment until a separately
verified revision is deployed. Audit and full regression checks remain required.

No production cutover until those gates, data accounting, exact served SHA,
rollback and repository protections are satisfied. DNS changes require the
owner's explicit approval at that final boundary.
