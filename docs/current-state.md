# Nexora Current State

> Evidence-backed snapshot. Do not promote capabilities based on code existence alone.

## Snapshot

- Repository: `adreinmorin-design/nexora-guard-core-695d0312`
- Branch: `main`
- Current verified main commit: `1d76d80f656ced8f716d8d3937fe0c936f2e918b`
- Snapshot time: 2026-09-26T13:10:00Z
- Current CI evidence: GitHub Actions run `36244263497`

## Repository Verification

### CI — RUNTIME_VERIFIED

GitHub Actions run `36244263497` completed successfully on commit
`1d76d80f656ced8f716d8d3937fe0c936f2e918b`.

The repository verification runner covers:

- Bun dependency audit at high severity
- Prettier
- ESLint
- TypeScript
- production build
- security tests
- agent integration tests
- provider tests
- Paddle tests
- billing tests
- gateway tests
- database migration tests
- hardening/auth runtime tests
- monitoring tests
- email tests

Earlier evidence artifact:
`nexora-verification-da453f322617c18be7f6c7a7cf4b5b7292df55ef`
(artifact id `10906508254`, SHA-256
`af70ac90d24fae468c9c69511178e0d8b29df2326daa6fb0ea9604b0868e2b45`).

### Main branch protection — FAILED / BLOCKED BY GITHUB ADMINISTRATION PERMISSION

A direct GitHub readback after the attempted fix still reports:

- branch: `main`
- protected: `false`
- required status-check enforcement: off

A GitHub Actions-based protection attempt was executed in run `36244033661`.
The REST call to update branch protection returned:

- HTTP 403
- `Resource not accessible by integration`

This establishes that the built-in GitHub Actions token cannot administer repository
branch protection. The repository now contains
`.github/workflows/configure-main-protection.yml`, which is manual-only and expects
an admin-scoped repository secret named `BRANCH_PROTECTION_TOKEN`. It is not treated
as fixed until GitHub branch readback reports protection enabled.

### Codespace bootstrap — IMPLEMENTED

The repository now includes a deterministic devcontainer using Node.js 24 and Bun
1.4.2. New or rebuilt Codespaces install from `bun.lock` with a frozen lockfile.
The currently existing mobile Codespace has not been directly rebuilt and observed
through a Codespaces lifecycle API, so the Codespace instance itself is not promoted
to runtime-verified.

## Live Lovable / Database Verification

### Lovable project — DEPLOYED, HTTP RESPONSE NOT YET VERIFIED

Direct Lovable project readback reports:

- project id: `f46c7dc2-f8c6-4710-96bb-07ffc11e5270`
- project name: Nexora
- published: true
- project build status: ready
- production URL: `https://nexora-guard-core.lovable.app`
- deployment id from publish request: `04d13706-af38-47bb-b102-521ab2783f79`

The available external HTTP tools could not resolve/access the Lovable production
hostname, so a successful public HTTP response is not claimed from this environment.

### Production database connectivity — RUNTIME_VERIFIED

Direct queries through the connected Lovable production database succeeded. The
database reports Supabase enabled.

Observed production facts:

- one authenticated user currently exists
- one organization currently exists
- four organization-membership rows currently exist
- all application tables in the `public` schema report row-level security enabled

### Anonymous data boundary — RUNTIME_VERIFIED

Direct privilege and RLS inspection found:

- the `anon` role has table-level SELECT only on `billing_plans`
- an anonymous attempt to read `organizations` was rejected with
  `permission denied for table organizations`
- no inspected SECURITY DEFINER function is executable by `anon` or `public`
- authenticated access to SECURITY DEFINER helpers is limited to the intended
  private membership/role/entitlement helper functions; trigger helpers remain
  non-executable by authenticated clients

### Authenticated non-member isolation — RUNTIME_VERIFIED

A read-only synthetic authenticated identity with no organization membership was
evaluated against the live production database under the `authenticated` role.
It observed zero rows from:

- organizations
- org_members
- policies
- audit_events
- requests
- providers
- models

This verifies the negative-path RLS boundary for a non-member identity.

### Cross-tenant isolation — NOT_VERIFIED

A real member identity can read its organization's currently populated governed data,
which is consistent with the intended policies. However, production currently contains
only one organization, so a true tenant-A-versus-tenant-B isolation test cannot yet be
performed without creating a second test tenant. Do not promote full tenant isolation
to runtime-verified based only on the non-member negative-path test.

## Product Runtime Capabilities Still Requiring Direct Evidence

The successful CI and database-boundary checks do not by themselves prove end-to-end
governed execution. The following remain unpromoted until direct runtime evidence is
captured:

- interactive authentication through the deployed application
- two-tenant isolation
- policy allow path with downstream provider execution
- policy deny path proving downstream dispatch does not occur
- PII redaction before provider forwarding
- prompt-injection enforcement before privileged action
- budget/quota hard-stop before provider invocation
- provider routing to a live provider
- MCP/tool authorization with both allow and deny cases
- persistent intent across multi-step agent execution
- audit reconstruction from intent/execution/request identifiers
- billing entitlement lifecycle against Paddle

## Rule

No capability moves to `RUNTIME_VERIFIED` without a concrete evidence reference.
