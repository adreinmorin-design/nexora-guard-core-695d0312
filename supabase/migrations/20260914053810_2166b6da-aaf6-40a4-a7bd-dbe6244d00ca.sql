CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- AGENTS -------------------------------------------------------------
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  owner_id uuid NOT NULL,
  status lifecycle_status NOT NULL DEFAULT 'active',
  token_prefix text,
  token_hash text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read agents" ON public.agents FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "admins manage agents" ON public.agents FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]));

CREATE TABLE public.agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  capability text NOT NULL,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, capability)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_capabilities TO authenticated;
GRANT ALL ON public.agent_capabilities TO service_role;
ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read agent capabilities" ON public.agent_capabilities FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "admins manage agent capabilities" ON public.agent_capabilities FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]));

-- MCP ----------------------------------------------------------------
CREATE TABLE public.mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  transport text NOT NULL DEFAULT 'http',
  auth_mode text NOT NULL DEFAULT 'bearer',
  status lifecycle_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_servers TO authenticated;
GRANT ALL ON public.mcp_servers TO service_role;
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read mcp servers" ON public.mcp_servers FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "admins manage mcp servers" ON public.mcp_servers FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]));

CREATE TABLE public.mcp_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  server_id uuid REFERENCES public.mcp_servers(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  description text,
  risk severity NOT NULL DEFAULT 'medium',
  required_capability text NOT NULL,
  status lifecycle_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, tool_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_tools TO authenticated;
GRANT ALL ON public.mcp_tools TO service_role;
ALTER TABLE public.mcp_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read mcp tools" ON public.mcp_tools FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "admins manage mcp tools" ON public.mcp_tools FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]));

CREATE TABLE public.mcp_tool_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES public.mcp_tools(id) ON DELETE CASCADE,
  requires_approval boolean NOT NULL DEFAULT false,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, tool_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_tool_grants TO authenticated;
GRANT ALL ON public.mcp_tool_grants TO service_role;
ALTER TABLE public.mcp_tool_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read mcp grants" ON public.mcp_tool_grants FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "admins manage mcp grants" ON public.mcp_tool_grants FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','agent_admin']::app_role[]));

-- INVITES ------------------------------------------------------------
CREATE TABLE public.org_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role app_role NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_invites_pending_unique
  ON public.org_invites (org_id, lower(email), role)
  WHERE status = 'pending';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_invites TO authenticated;
GRANT ALL ON public.org_invites TO service_role;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read invites" ON public.org_invites FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));
CREATE POLICY "invitee reads own invite" ON public.org_invites FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));
CREATE POLICY "admins manage invites" ON public.org_invites FOR ALL TO authenticated
  USING (private.has_org_role(org_id, ARRAY['platform_admin','org_admin']::app_role[]))
  WITH CHECK (private.has_org_role(org_id, ARRAY['platform_admin','org_admin']::app_role[]));

-- APPROVAL REPLAY SAFETY ---------------------------------------------
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS decision_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS policy_revalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS approvals_idempotency_unique
  ON public.approvals (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS requests_idempotency_unique
  ON public.requests (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- requests may now be written by agents (user_id null) via service role
DROP POLICY IF EXISTS "members insert requests" ON public.requests;
CREATE POLICY "members insert requests" ON public.requests FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(org_id) AND (user_id = auth.uid() OR user_id IS NULL));

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_mcp_servers_updated_at BEFORE UPDATE ON public.mcp_servers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();