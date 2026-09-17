# Gateway hardening

The console and approval execution now use the same policy pipeline.

## Deploy

1. Run `npm run test:gateway`, `npm run test:database`, `npm run test:security`, `npx tsc --noEmit`, and `npm run build` (Node 24+ for tests).
2. Deploy the application and apply `20260917000100_gateway_admission.sql` in the same maintenance window. The migration revokes direct browser writes to requests, findings, approvals and audit; the previous application must not keep serving traffic afterward.
3. The server requires `SUPABASE_SERVICE_ROLE_KEY` plus the existing Supabase URL/publishable key. OpenAI requires `OPENAI_API_KEY` or `OPEN_AI_PLATFORM_API_KEY`. Never put these server secrets in VITE variables.
4. Verify a non-sensitive live request, a blocked request, and approval by a second authorized account. Existing pending approvals without an executable sanitized payload must be resubmitted.
5. Apply `20260917000200_control_plane_privileges.sql` with the control-plane update. It removes browser credential-hash reads, direct registry writes, and unnecessary TRUNCATE/REFERENCES/TRIGGER privileges.

## Control plane

- Security Tests and Attack Simulation execute fixed synthetic fixtures against the organization's current policies. Both request and response decisions are checked; persisted results include policy versions. These do not test a live model or imply a complete adversarial evaluation.
- Agent metadata, capability grants, draft MCP registration, finding resolution and organization renaming have role-checked server actions. Tenant identifiers are resolved from authenticated memberships; capability parents are checked within that tenant.
- Threats shows findings; Errors filters execution failures; Latency shows recent requests. These views are limited to the newest 200 records and are not complete historical aggregates.
- Provider readiness uses server environment availability, not seeded database labels. It does not verify key validity or model entitlement.
- Autonomous scheduling, external SIEM/Slack/Jira delivery, retention scheduling and regional routing remain unimplemented. Google and Anthropic execution adapters are not implemented.
- Overlapping sensitive spans are merged before redaction. Private-key masking covers the entire key block, including incomplete blocks. The provider timeout covers response body consumption as well as headers.

## Agent connections

- Agents may request a ten-minute connection code or be connected directly by a signed-in user. The consent page displays each requested scope before approval. Sensitive scopes are limited by the consenting user's current roles.
- Successful consent creates a tenant-bound agent identity and a one-time 256-bit credential. The raw credential is returned once, stored only as a SHA-256 digest, expires after 90 days, and can be revoked immediately by the owner or an administrator.
- The native `/api/mcp` endpoint exposes only tools covered by the connection's scopes. `/api/agent` accepts bounded JSON tasks. Both derive the organization from the credential and apply replay and rate-limit admission before work starts.
- Connected-agent usage displays request count, input and output tokens, provider cost, and last use from persisted gateway request records. New agents show zero usage immediately after consent.
- Model execution still passes through model authorization, content inspection, policies, budget reservation, approvals, response inspection, and audit. Agent owners must remain organization members with a role that can grant sensitive operations.
- Remote MCP servers require an administrator allowlist in `MCP_ALLOWED_ORIGINS`; bearer secrets use `MCP_TOKEN_<SERVER_UUID>`. Discovery stores a definition hash, leaves tools in draft, and requires explicit tool and agent grants before execution.

## Behavior

- Database errors prevent provider dispatch; dispatch intent is audited before the call.
- Provider readiness comes from the server environment, not a stored MANAGED label.
- Output is capped at 1,024 tokens. Reservations include a conservative UTF-8 byte input estimate plus framing allowance and the output cap. Pricing must be kept current in the model registry.
- Active organization budgets support UTC daily, weekly, monthly and yearly windows. Unsupported scopes fail closed. Atomic admission treats the configured limit as a hard ceiling, including for approved requests; approval does not raise a budget.
- Request identifiers are unique within an organization. Reservations and approval decisions prevent duplicate dispatch. Ambiguous provider failures retain reserved funds and require operator reconciliation; do not blindly retry.
- Approvals execute the displayed sanitized prompt, never the original raw sensitive values. Changed policies are evaluated again. An unchanged request approval policy may be satisfied, but response approval is fail-closed withholding, not a response-release queue.
- Detection is heuristic; redaction does not guarantee removal of every possible secret or personal identifier.

## Validation boundaries

The database test runs all repository migrations in PGlite and verifies admission, settlement, isolation and privileges. It is not a multi-process PostgreSQL load test. Production authentication, provider billing and deployment-secret availability require live validation.
