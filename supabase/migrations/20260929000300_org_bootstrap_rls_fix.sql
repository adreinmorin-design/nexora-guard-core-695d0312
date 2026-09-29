-- Fix first-member organization bootstrap under RLS.
-- The prior policy selected organizations through RLS before membership existed,
-- making legitimate creator bootstrap fail. It also did not require the first
-- org_admin row to belong to auth.uid().

CREATE OR REPLACE FUNCTION private.nexora_can_bootstrap_org(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = p_org
        AND o.created_by = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.org_members m
      WHERE m.org_id = p_org
    );
$$;

REVOKE ALL ON FUNCTION private.nexora_can_bootstrap_org(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.nexora_can_bootstrap_org(uuid)
  TO authenticated;

DROP POLICY IF EXISTS "bootstrap or admin add member" ON public.org_members;
CREATE POLICY "bootstrap or admin add member"
  ON public.org_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      role = 'org_admin'
      AND user_id = auth.uid()
      AND private.nexora_can_bootstrap_org(org_id)
    )
    OR private.has_org_role(
      org_id,
      ARRAY['platform_admin']::public.app_role[]
    )
    OR (
      role <> 'platform_admin'
      AND private.has_org_role(
        org_id,
        ARRAY['org_admin']::public.app_role[]
      )
    )
  );
