DROP POLICY IF EXISTS "creator reads own org" ON public.organizations;
CREATE POLICY "creator reads own org" ON public.organizations
FOR SELECT TO authenticated
USING (created_by = auth.uid());