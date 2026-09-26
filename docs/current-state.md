# Nexora Current State

> Evidence-backed snapshot. Do not promote capabilities based on code existence alone.

## Snapshot

- Repository: `adreinmorin-design/nexora-guard-core-695d0312`
- Branch: `main`
- Baseline main commit before Codex bootstrap documentation: `1a9cc0e388839b60ee45eb3607fcca2ed29b6008`
- Snapshot time: 2026-09-26T12:05:53Z
- Note: later documentation-only commits add Codex instructions and these state files. Read GitHub HEAD for the latest branch commit.

## Verified Repository Facts

- The repository contains a Bun lockfile and declares Bun 1.4.2.
- A GitHub Actions CI workflow exists at `.github/workflows/ci.yml`.
- The repository contains tests for gateway, security, hardening, agents, providers, Paddle, billing, database, monitoring, and email.
- Supabase migrations are present under `supabase/`.
- Nexora documentation exists under `docs/`, including gateway hardening, provider, billing, and live execution control documentation.
- `AGENTS.md` contains Nexora-specific Codex engineering rules and preserves the Lovable history-safety warning.

## Release Blockers / Unverified Controls

### Main branch protection — FAILED

Direct GitHub branch readback during this bootstrap reported:

- branch: `main`
- protected: `false`
- required status-check enforcement: off

This remains a release blocker until verified fixed.

### CI — NOT VERIFIED FOR BOOTSTRAP HEAD

At the time checked, no GitHub Actions workflow run was observed for the initial Codex bootstrap documentation commit.

Re-check CI on the latest HEAD before treating CI as passing.

## Runtime Verification

No production capability is promoted to RUNTIME_VERIFIED by this bootstrap.

The following require direct live evidence before promotion:

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

When new evidence is obtained, update both this file and the verification ledger in the same engineering task.
