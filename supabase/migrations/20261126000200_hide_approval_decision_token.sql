-- L3: approvals.decision_token must not be readable by org members through the
-- authenticated (PostgREST) role. RLS scopes rows, not columns, so withhold the
-- column with column-level privileges: drop the table-wide SELECT grant and
-- grant SELECT on every other column explicitly. listApprovals selects these
-- columns explicitly (select("*") would now fail with 42501).
--
-- Forward-only and idempotent; the migration applier provides the surrounding
-- transaction. Only authenticated SELECT changes: service_role, anon and the
-- existing RLS policies are untouched. A column added to approvals later is NOT
-- readable by authenticated until it is granted here-style in a new migration.

-- Revoking the table privilege also revokes any column SELECT privileges, so a
-- replay starts from the same state.
REVOKE SELECT ON public.approvals FROM authenticated;

GRANT SELECT (
  id,
  org_id,
  request_id,
  requester_id,
  action,
  target,
  risk,
  reason,
  policy_id,
  policy_version,
  status,
  approver_id,
  decided_at,
  expires_at,
  execution_result,
  payload,
  created_at,
  idempotency_key,
  policy_revalidated_at,
  consumed_at,
  intent_id,
  original_execution_id,
  approval_scope,
  single_use,
  consumed_execution_id
) ON public.approvals TO authenticated;
