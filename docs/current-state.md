# Nexora Current State

> Evidence-backed snapshot. Do not promote capabilities based on code existence alone.

## Snapshot

- Repository: `adreinmorin-design/nexora-guard-core-695d0312`
- Branch: `main`
- Verified engineering commit: `6ffe3739a59358c75e9cc64f4e7fab48339d125c`
- Snapshot time: 2026-09-26T12:49:10Z
- CI evidence: GitHub Actions run `36243085212`

## Verified Repository Facts

- The repository declares Bun 1.4.2 and uses `bun.lock` as the dependency lockfile.
- A reproducible Codespaces configuration now exists under `.devcontainer/` using Node.js 24 and Bun 1.4.2.
- Codespace bootstrap removes only an untracked accidental `package-lock.json` and installs from `bun.lock` with `--frozen-lockfile --ignore-scripts`.
- GitHub Actions CI installs Node.js 24 and Bun 1.4.2, executes the complete verification runner, and uploads verification evidence.
- CI run `36243085212` completed successfully for commit `6ffe3739a59358c75e9cc64f4e7fab48339d125c`.
- The CI verification summary reported 15 passed checks and 0 failed checks.
- The verification artifact is `nexora-verification-6ffe3739a59358c75e9cc64f4e7fab48339d125c` (artifact id `10906398211`, SHA-256 digest `de51b20ca64999b1af5006b8e0799aec59ff74b683cf2343e115deb89f7bbefe`).

## Repository Control Findings

### CI — RUNTIME_VERIFIED

Evidence: GitHub Actions run `36243085212`.

Verified checks:

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

### Main branch protection — FAILED

Direct GitHub branch readback after the CI pass reports:

- branch: `main`
- protected: `false`
- required status-check enforcement: off

This remains a release blocker.

### Codespace bootstrap — IMPLEMENTED, NOT RUNTIME_VERIFIED

The repository configuration is now deterministic, but the currently running user Codespace has not been rebuilt from the new `.devcontainer` configuration through an observable Codespaces lifecycle API. Do not claim the existing Codespace instance is runtime-verified until a rebuild/new Codespace completes and Bun 1.4.2 is observed there.

## Product Runtime Verification

The successful CI run verifies repository-level build/test behavior. It does **not** prove production runtime behavior against live Supabase, model providers, MCP servers, Paddle, or deployed infrastructure.

The following therefore remain unpromoted pending direct live evidence:

- authentication
- tenant isolation
- policy allow/deny
- PII redaction
- prompt-injection controls
- budget/quota enforcement
- provider routing
- MCP/tool authorization
- intent persistence
- audit reconstruction
- billing/entitlements

See `docs/verification-ledger.yaml` for machine-readable status.

## Rule

No capability moves to `RUNTIME_VERIFIED` without a concrete evidence reference.
