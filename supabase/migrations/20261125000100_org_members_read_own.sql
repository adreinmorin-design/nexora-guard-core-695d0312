-- Let an authenticated user read their own membership rows.
--
-- "members read members" uses private.is_org_member(org_id), which cannot see a
-- row inserted by the same statement. INSERT ... RETURNING (PostgREST
-- Prefer: return=representation) therefore failed the first-member bootstrap
-- with 42501 even though the INSERT policy passed. This additive permissive
-- policy exposes only rows whose user_id is the caller; it grants no access to
-- other members or other tenants.

DROP POLICY IF EXISTS "members read own membership" ON public.org_members;
CREATE POLICY "members read own membership"
  ON public.org_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
