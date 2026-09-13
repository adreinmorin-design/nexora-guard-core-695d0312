-- 1. Private schema for internal security-definer helpers (not exposed to the API)
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_org_member(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = _org AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.has_org_role(_org uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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

-- 2. Repoint every policy at the private helpers
-- organizations
DROP POLICY IF EXISTS "members read org" ON public.organizations;
CREATE POLICY "members read org" ON public.organizations FOR SELECT TO authenticated USING (private.is_org_member(id));
DROP POLICY IF EXISTS "admins update org" ON public.organizations;
CREATE POLICY "admins update org" ON public.organizations FOR UPDATE TO authenticated
  USING (private.has_org_role(id, ARRAY['platform_admin','org_admin']::public.app_role[]))
  WITH CHECK (private.has_org_role(id, ARRAY['platform_admin','org_admin']::public.app_role[]));

-- org_members
DROP POLICY IF EXISTS "members read members" ON public.org_members;
CREATE POLICY "members read members" ON public.org_members FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "admins remove member" ON public.org_members;
CREATE POLICY "admins remove member" ON public.org_members FOR DELETE TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin']::public.app_role[]));
DROP POLICY IF EXISTS "bootstrap or admin add member" ON public.org_members;
CREATE POLICY "bootstrap or admin add member" ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    private.has_org_role(org_id, ARRAY['platform_admin','org_admin']::public.app_role[])
    OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = org_members.org_id)
  );

-- providers
DROP POLICY IF EXISTS "members read providers" ON public.providers;
CREATE POLICY "members read providers" ON public.providers FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "govern providers" ON public.providers;
CREATE POLICY "govern providers" ON public.providers FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]));

-- models
DROP POLICY IF EXISTS "members read models" ON public.models;
CREATE POLICY "members read models" ON public.models FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "govern models" ON public.models;
CREATE POLICY "govern models" ON public.models FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]));

-- budgets
DROP POLICY IF EXISTS "members read budgets" ON public.budgets;
CREATE POLICY "members read budgets" ON public.budgets FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "govern budgets" ON public.budgets;
CREATE POLICY "govern budgets" ON public.budgets FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]));

-- policies
DROP POLICY IF EXISTS "members read policies" ON public.policies;
CREATE POLICY "members read policies" ON public.policies FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "govern policies" ON public.policies;
CREATE POLICY "govern policies" ON public.policies FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin','security_admin']::public.app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin','security_admin']::public.app_role[]));

-- policy_versions
DROP POLICY IF EXISTS "members read policy versions" ON public.policy_versions;
CREATE POLICY "members read policy versions" ON public.policy_versions FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "govern policy versions" ON public.policy_versions;
CREATE POLICY "govern policy versions" ON public.policy_versions FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin','security_admin']::public.app_role[]));

-- requests
DROP POLICY IF EXISTS "members read requests" ON public.requests;
CREATE POLICY "members read requests" ON public.requests FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "members insert requests" ON public.requests;
CREATE POLICY "members insert requests" ON public.requests FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(org_id) AND user_id = auth.uid());

-- security_findings
DROP POLICY IF EXISTS "members read findings" ON public.security_findings;
CREATE POLICY "members read findings" ON public.security_findings FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "members insert findings" ON public.security_findings;
CREATE POLICY "members insert findings" ON public.security_findings FOR INSERT TO authenticated WITH CHECK (private.is_org_member(org_id));
DROP POLICY IF EXISTS "security updates findings" ON public.security_findings;
CREATE POLICY "security updates findings" ON public.security_findings FOR UPDATE TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','security_analyst']::public.app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','security_analyst']::public.app_role[]));

-- audit_events
DROP POLICY IF EXISTS "members read audit" ON public.audit_events;
CREATE POLICY "members read audit" ON public.audit_events FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "members insert audit" ON public.audit_events;
CREATE POLICY "members insert audit" ON public.audit_events FOR INSERT TO authenticated WITH CHECK (private.is_org_member(org_id));

-- approvals
DROP POLICY IF EXISTS "members read approvals" ON public.approvals;
CREATE POLICY "members read approvals" ON public.approvals FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "members create approvals" ON public.approvals;
CREATE POLICY "members create approvals" ON public.approvals FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(org_id) AND requester_id = auth.uid());
DROP POLICY IF EXISTS "approvers decide" ON public.approvals;
CREATE POLICY "approvers decide" ON public.approvals FOR UPDATE TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','governance_admin']::public.app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','governance_admin']::public.app_role[]));

-- 3. Remove the now-unused public helpers from the exposed API schema
DROP FUNCTION IF EXISTS public.is_org_member(uuid);
DROP FUNCTION IF EXISTS public.has_org_role(uuid, public.app_role[]);

-- 4. Make the append-only intent of request logs explicit
REVOKE UPDATE, DELETE ON public.requests FROM authenticated;
CREATE POLICY "request logs are immutable (no updates)" ON public.requests FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "request logs are immutable (no deletes)" ON public.requests FOR DELETE TO authenticated USING (false);
COMMENT ON TABLE public.requests IS 'Append-only AI request ledger. Updates and deletes are intentionally denied for every role to preserve the governance record.';