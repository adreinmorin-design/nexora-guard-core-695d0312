# Gateway hardening

The console and approval execution now use the same policy pipeline.

## Deploy

1. Run `npm run test:gateway`, `npm run test:database`, `npx tsc --noEmit`, and `npm run build` (Node 24+ for tests).
2. Deploy the application and apply `20260917000100_gateway_admission.sql` in the same maintenance window. The migration revokes direct browser writes to requests, findings, approvals and audit; the previous application must not keep serving traffic afterward.
3. The server requires `SUPABASE_SERVICE_ROLE_KEY` plus the existing Supabase URL/publishable key. OpenAI requires `OPENAI_API_KEY` or `OPEN_AI_PLATFORM_API_KEY`. Never put these server secrets in VITE variables.
4. Verify a non-sensitive live request, a blocked request, and approval by a second authorized account. Existing pending approvals without an executable sanitized payload must be resubmitted.

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
