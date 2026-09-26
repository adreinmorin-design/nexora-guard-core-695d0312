<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# Nexora Codex Engineering Rules

## Mission

Nexora is an AI runtime governance, execution-control, and audit platform.

Canonical execution model:

**Identity → Intent → Governed Execution → Policy → Action → Model/Tool Invocation → Result → Evidence**

Nexora must sit in the execution path. It must not merely observe activity after execution.

## Source of truth

Before making changes, read the repository implementation and the relevant docs:

- `README.md`
- `docs/gateway-hardening.md`
- `docs/live-execution-control.md`
- `docs/providers.md`
- `docs/billing.md`
- `docs/verification-ledger.yaml`
- `docs/current-state.md`

When documentation and runtime behavior disagree, treat runtime evidence as the current state and update documentation as part of the change.

## Completion standard

Never equate "code exists" with "feature complete".

Valid states:

- NOT_IMPLEMENTED
- IMPLEMENTED
- DEPLOYED
- RUNTIME_VERIFIED
- FAILED
- NOT_VERIFIED

A capability may be marked `RUNTIME_VERIFIED` only when direct evidence proves the actual runtime behavior.

For security-sensitive controls, verify both positive and negative paths. A deny test must prove the downstream provider, model, tool, MCP server, API, or protected resource was not invoked.

## Security invariants

These must remain true:

1. No cross-tenant access without explicitly authorized cross-tenant design.
2. No downstream execution after a DENY decision.
3. No privileged provider/service secrets in client-side code.
4. Every governed privileged operation has an attributable identity.
5. Every governed execution has an `intent_id` and `execution_id`.
6. Every policy decision records the applicable policy version.
7. Child actions remain traceable to their parent execution and originating intent.
8. MCP/tool authorization happens before invocation.
9. Hard budget limits block before billable provider execution.
10. Frontend state alone never grants authorization.
11. Critical audit-link failures are release blockers.
12. Privileged database functions are not anonymously callable unless explicitly designed, reviewed, and proven safe.
13. Do not weaken tests, bypass checks, disable functionality, or reduce security merely to make CI green.

## Working method

For each engineering task:

1. Inspect the existing implementation before proposing replacement code.
2. Reproduce or establish the current state with evidence.
3. Identify the smallest production-grade fix.
4. Preserve intended behavior and avoid parallel/duplicate implementations.
5. Implement the change.
6. Run the narrowest relevant tests first.
7. Run the broader validation suite for affected critical paths.
8. Verify positive and negative runtime behavior when feasible.
9. Record evidence in `docs/verification-ledger.yaml` and update `docs/current-state.md`.
10. Do not claim deployment or runtime verification without direct evidence.

If a required external service, credential, permission, or deployment target is unavailable, record the exact blocker instead of simulating success.

## Repository safety

- Preserve Lovable history. Never force-push, rewrite published history, rebase/amend/squash pushed commits, or reset shared branches.
- Do not delete or disable tests to obtain a green build.
- Do not replace working functionality with mocks in production paths.
- Do not expose or commit secrets.
- Treat `.env.example` as documentation only.
- Server secrets must not use `VITE_` prefixes.
- Prefer minimal diffs and preserve backward compatibility unless the requirement explicitly demands a breaking change.

## Toolchain

The repository declares:

- Bun `1.4.2`
- Node.js `24+`
- TypeScript
- Vite / TanStack Start
- Supabase
- GitHub Actions

Use the committed `bun.lock` as the dependency lock source.

Typical bootstrap:

```bash
bun install --frozen-lockfile
```

## Validation commands

Run the relevant subset during development, then the complete applicable suite before claiming a critical path is verified:

```bash
bun run test:gateway
bun run test:security
bun run test:hardening
bun run test:agents
bun run test:providers
bun run test:paddle
bun run test:billing
bun run test:database
bun run test:monitoring
bun run test:email
bun run lint
bun run format:check
bunx tsc --noEmit
bun run build
```

The database test validates migrations in PGlite. It does **not** replace live Supabase authentication, RLS, concurrency, provider, billing sandbox, deployment, or browser end-to-end verification.

## Runtime governance checks

When changing the governed execution path, explicitly verify where relevant:

- tenant and identity binding
- intent persistence/linking
- request DLP
- prompt-injection checks
- deterministic policy decision
- approval gating
- quota/budget admission
- provider/model routing
- MCP/tool authorization
- pre-execution audit event
- pre-invocation audit event
- downstream dispatch
- response inspection
- usage/cost attribution
- result/evidence linkage

## Release blockers

Treat these as release blockers until resolved and verified:

- authentication failure
- cross-tenant access
- authorization bypass
- policy bypass
- uncontrolled provider invocation
- uncontrolled MCP/tool execution
- exposed secrets
- broken deployment
- failed required CI
- missing critical audit linkage
- production migration inconsistency
- billing/entitlement bypass
- evidence-free claims of completion
