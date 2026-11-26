-- RLS hardening from the read-only production audit (M1, L2, L4, L5 and the
-- auth_rls_initplan performance advisories). Forward-only and idempotent; the
-- migration applier provides the surrounding transaction.
--
-- L3 (column SELECT on approvals.decision_token) is intentionally NOT handled
-- here: listApprovals in src/lib/nexora.functions.ts reads approvals with
-- select("*") through the authenticated client, which would fail with 42501
-- once any column is withheld. That server function must select explicit
-- columns before the column grant can be narrowed.

-- M1: SECURITY DEFINER tenancy helpers must not resolve names through a
-- mutable search_path. Bodies are already fully qualified. CREATE OR REPLACE
-- keeps the owner and ACL; the grants are reasserted unchanged.
CREATE OR REPLACE FUNCTION private.is_org_member(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = _org AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.has_org_role(_org uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.role = ANY(_roles)
  );
$$;

REVOKE ALL ON FUNCTION private.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_org_role(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_org_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_org_role(uuid, public.app_role[]) TO authenticated, service_role;

-- L2: only a platform_admin may invite (or re-role an invite to) platform_admin,
-- mirroring "bootstrap or admin add member" on org_members.
DROP POLICY IF EXISTS "admins manage invites" ON public.org_invites;
CREATE POLICY "admins manage invites" ON public.org_invites FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin']::public.app_role[]))
  WITH CHECK (
    private.has_org_role(org_id, ARRAY['platform_admin']::public.app_role[])
    OR (
      role <> 'platform_admin'::public.app_role
      AND private.has_org_role(org_id, ARRAY['org_admin']::public.app_role[])
    )
  );

-- L4: browser-role privileges that no policy permits. No client code performs
-- these writes through the authenticated client; RLS already denied them.
REVOKE UPDATE ON public.org_members FROM authenticated;
REVOKE DELETE ON public.organizations FROM authenticated;
REVOKE DELETE ON public.profiles FROM authenticated;
REVOKE DELETE ON public.policy_versions FROM authenticated;

-- L4/L5: write policies whose privilege was revoked in 20260917000100. They
-- are dead code today and would silently re-open forged approvals, spend
-- records, audit events and findings if a grant ever came back. All writes go
-- through service_role server paths, which bypass RLS.
DROP POLICY IF EXISTS "members create approvals" ON public.approvals;
DROP POLICY IF EXISTS "approvers decide" ON public.approvals;
DROP POLICY IF EXISTS "members insert audit" ON public.audit_events;
DROP POLICY IF EXISTS "members insert requests" ON public.requests;
DROP POLICY IF EXISTS "members insert findings" ON public.security_findings;
DROP POLICY IF EXISTS "security updates findings" ON public.security_findings;

-- auth_rls_initplan: evaluate auth.uid()/auth.jwt() once per statement.
-- Semantics are unchanged.
DROP POLICY IF EXISTS "own profile read" ON public.profiles;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "own profile insert" ON public.profiles;
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "anyone create org" ON public.organizations;
CREATE POLICY "anyone create org" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "creator reads own org" ON public.organizations;
CREATE POLICY "creator reads own org" ON public.organizations FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "invitee reads own invite" ON public.org_invites;
CREATE POLICY "invitee reads own invite" ON public.org_invites FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(((SELECT auth.jwt()) ->> 'email'), '')));

DROP POLICY IF EXISTS "bootstrap or admin add member" ON public.org_members;
CREATE POLICY "bootstrap or admin add member" ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    (
      role = 'org_admin'::public.app_role
      AND user_id = (SELECT auth.uid())
      AND private.nexora_can_bootstrap_org(org_id)
    )
    OR private.has_org_role(org_id, ARRAY['platform_admin']::public.app_role[])
    OR (
      role <> 'platform_admin'::public.app_role
      AND private.has_org_role(org_id, ARRAY['org_admin']::public.app_role[])
    )
  );
DROP POLICY IF EXISTS "members read own membership" ON public.org_members;
CREATE POLICY "members read own membership" ON public.org_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
