# Portable production server

This is an additive deployment path. `bun run build` and `vite.config.ts` retain
the Lovable reference build. Do not merge, redeploy Lovable, or move its domain
merely to test portability. Use the portability branch on a temporary hostname.

## Reproducible build and start

Use Node 24.19.0 and Bun 1.4.2. `bun.lock` remains authoritative. Three targeted transitive overrides patch
newly reported seroval, shell-quote and source-map-js advisories; no framework
upgrade or package-manager change was made.
Nitro, TanStack and all other dependencies resolve from that frozen lock.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run test:portability
bun run build:portable
bun run start:portable
```

Supply `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` explicitly at build time.
The build derives its full Git SHA from the checkout or accepts
`NEXORA_BUILD_SHA` from trusted CI. Never stamp a dirty checkout as an immutable
production commit. Runtime also requires `SUPABASE_SERVICE_ROLE_KEY`. Provider
credentials belong only in runtime secrets, not build arguments, Git or Vite.
The start script refuses missing/invalid config, public/privileged key swaps,
unexpected `VITE_` variables and disagreement between built client and runtime
Supabase URL/key. Public configuration changes require rebuilding.

The runtime supplies `PORT` and `HOST` (default host `0.0.0.0`). Nitro provides
signal-based graceful shutdown. Put TLS termination at the hosting proxy. The
portable build emits standalone `.output/server/index.mjs` plus client assets;
the checked start wrapper validates settings before importing that server.

## Container

`Dockerfile.portable` separates dependency/build and runtime stages, runs as the
non-root `node` user, and excludes local secrets from its build context.

```sh
docker build -f Dockerfile.portable -t nexora-portable \
  --build-arg SUPABASE_URL \
  --build-arg SUPABASE_PUBLISHABLE_KEY \
  --build-arg NEXORA_BUILD_SHA .
```

Only these public/identity build arguments are permitted. Supply privileged
credentials to the runtime through the hosting secret manager. The image carries
only `.output` and start/config-validation scripts. Base images use explicit
version tags; registry digests should be recorded/pinned when the destination
build is verified. Do not claim immutable base-image provenance from a tag alone.

Docker is unavailable in the local workspace. The portability CI job builds and
starts the container with synthetic credentials, checks its served SHA, and
preserves smoke evidence. It does not create a production database or provider
call. Local built-server smoke testing uses the same start command but is not
container or hosted-runtime proof.

## Health, revision and logs

- `GET /api/live`: process liveness, `status`, compiled commit SHA, runtime; no
  database/provider dependency. Docker liveness uses this endpoint.
- `GET /api/health`: existing privileged database-readiness check remains
  unchanged. Use this for deployment admission after real backend credentials
  and connectivity have been configured; 503 means stop rollout.
- Portable server responses carry `X-Nexora-Commit` and a generated
  `X-Nexora-Correlation-Id`. These describe the application response; a proxy or
  static-file response may bypass the wrapper. Use `/api/live` for attestation.
- Structured HTTP logs contain correlation ID, SHA, method, status and duration.
  No query string, path identifiers, bodies, tenant/user IDs or tokens are logged.
  Arbitrary server error messages/stacks are suppressed and replaced with an
  error event correlated via AsyncLocalStorage. This deliberately reduces error
  detail; use governed execution IDs/audit events for restricted diagnostics.
- HTTP correlation is transport metadata, not a new governance execution ID.
  Preserve the existing returned request/intent/execution/provider IDs in the
  runtime proof harness and link them to the transport correlation ID.

## Temporary deployment configuration

The evaluated target is a paid Render Node or Docker web service. No account was
provisioned. Connect the existing GitHub repository and select the portability
branch/CI-green exact revision; keep automatic deployment disabled until the
verification process controls it. No custom domain initially.

For a Node service:

- Node version: 24.19.0; Bun version: 1.4.2.
- Build: `bun install --frozen-lockfile --ignore-scripts && bun run build:portable`.
- Start: `bun run start:portable`.
- Set the explicit public backend configuration for both build and runtime.
- Put service-role/provider credentials only in the server secret manager.
- Health check: `/api/health` once backend access works. `/api/live` alone is not
  sufficient to declare the governance service ready for traffic.
- Choose a region near the database after identifying its actual region.

For Docker, select `Dockerfile.portable` explicitly. Publishable configuration
and exact source revision must be supplied as the documented build arguments.
Verify `/api/live` SHA against the deployment's source SHA and record image digest.

Start with OpenAI only if its credential is securely available. Configure an
active tenant model/provider through authorized control-plane access. Do not
seed a CONFIGURED label or enable extra vendors to simulate execution readiness.

## Backend gate and rollback

See `portability-assessment.md`: delegated Lovable SQL access is working, but an
independent service-role secret and auth redirect/origin control are not exposed.
Do not substitute an anonymous key or bypass server-side admission/audit writes.
If the backend cannot be reused, rehearse an independently owned Supabase
destination with synthetic users/data first. Production export/import is a
separate gated action with consistent snapshots and rollback.

Keep the old deployment and database intact. No schema changes are needed for
the portable build. Old production evidence retains its old host/SHA. Source
rollback is the old runtime plus original database; destination-only writes need
an explicit reconciliation plan before any cutover.

## Runtime acceptance sequence

1. Establish a real authenticated disposable identity and correct tenant.
2. Correlate transport ID with persisted intent, execution, policy version,
   DLP result, budget/quota admission, one allowed provider response, token/cost
   attribution and audit/evidence chain.
3. Deny a policy request and a hard-budget/quota request; prove zero downstream
   calls using dispatch/billing evidence, not merely zero recorded usage.
4. Prove both own-tenant access paths and both cross-tenant denials.
5. Capture only synthetic transformed DLP payload immediately before forwarding;
   never record a real sensitive prompt or secret in evidence.
6. Resume MCP tools and administration/RBAC proof through the same gateway.

No RUNTIME_VERIFIED transition follows from build, tests, schema or deployment.
Production domain cutover additionally requires exact served revision, all data
accounted for, proven rollback and explicit owner approval for DNS changes.
