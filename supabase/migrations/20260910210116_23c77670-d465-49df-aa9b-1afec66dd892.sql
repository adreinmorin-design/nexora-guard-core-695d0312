-- ENUMS
CREATE TYPE public.app_role AS ENUM ('platform_admin','org_admin','security_admin','governance_admin','agent_admin','security_analyst','auditor','developer','viewer');
CREATE TYPE public.gov_action AS ENUM ('ALLOW','LOG','REDACT','REQUIRE_APPROVAL','BLOCK');
CREATE TYPE public.severity AS ENUM ('critical','high','medium','low','info');
CREATE TYPE public.lifecycle_status AS ENUM ('draft','active','suspended','archived');

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ORGANIZATIONS
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- MEMBERSHIPS / ROLES (roles are NEVER stored on profiles)
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, role)
);
GRANT SELECT, INSERT, DELETE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER HELPERS (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = _org AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.role = ANY(_roles)
  );
$$;

CREATE POLICY "members read org" ON public.organizations FOR SELECT TO authenticated USING (public.is_org_member(id));
CREATE POLICY "anyone create org" ON public.organizations FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "admins update org" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(id, ARRAY['platform_admin','org_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(id, ARRAY['platform_admin','org_admin']::public.app_role[]));

CREATE POLICY "members read members" ON public.org_members FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "bootstrap or admin add member" ON public.org_members FOR INSERT TO authenticated WITH CHECK (
  public.has_org_role(org_id, ARRAY['platform_admin','org_admin']::public.app_role[])
  OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = org_members.org_id)
);
CREATE POLICY "admins remove member" ON public.org_members FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['platform_admin','org_admin']::public.app_role[]));

-- PROVIDERS
CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  vendor text NOT NULL,
  status public.lifecycle_status NOT NULL DEFAULT 'active',
  credential_state text NOT NULL DEFAULT 'MANAGED',
  region text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.providers TO authenticated;
GRANT ALL ON public.providers TO service_role;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read providers" ON public.providers FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "govern providers" ON public.providers FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]));

-- MODELS
CREATE TABLE public.models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  model_key text NOT NULL,
  display_name text NOT NULL,
  context_window integer,
  input_cost_per_1k numeric(10,6) NOT NULL DEFAULT 0,
  output_cost_per_1k numeric(10,6) NOT NULL DEFAULT 0,
  classification text NOT NULL DEFAULT 'general',
  status public.lifecycle_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, model_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.models TO authenticated;
GRANT ALL ON public.models TO service_role;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read models" ON public.models FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "govern models" ON public.models FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]));

-- POLICIES
CREATE TABLE public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  scope text NOT NULL DEFAULT 'organization',
  priority integer NOT NULL DEFAULT 100,
  action public.gov_action NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.lifecycle_status NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policies TO authenticated;
GRANT ALL ON public.policies TO service_role;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read policies" ON public.policies FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "govern policies" ON public.policies FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin','security_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin','security_admin']::public.app_role[]));

CREATE TABLE public.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);
GRANT SELECT, INSERT ON public.policy_versions TO authenticated;
GRANT ALL ON public.policy_versions TO service_role;
ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read policy versions" ON public.policy_versions FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "govern policy versions" ON public.policy_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin','security_admin']::public.app_role[]));

-- REQUESTS
CREATE TABLE public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  actor_type text NOT NULL DEFAULT 'user',
  source text NOT NULL DEFAULT 'console',
  provider text,
  model text,
  decision public.gov_action NOT NULL,
  reason text,
  policy_id uuid,
  policy_version integer,
  matched_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  redacted boolean NOT NULL DEFAULT false,
  prompt_preview text,
  response_preview text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.requests TO authenticated;
GRANT ALL ON public.requests TO service_role;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read requests" ON public.requests FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "members insert requests" ON public.requests FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id) AND user_id = auth.uid());
CREATE INDEX requests_org_created_idx ON public.requests (org_id, created_at DESC);

-- SECURITY FINDINGS
CREATE TABLE public.security_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.requests(id) ON DELETE SET NULL,
  severity public.severity NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  detection_source text NOT NULL DEFAULT 'deterministic',
  confidence numeric(4,3),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_resource text,
  remediation text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.security_findings TO authenticated;
GRANT ALL ON public.security_findings TO service_role;
ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read findings" ON public.security_findings FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "members insert findings" ON public.security_findings FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "security updates findings" ON public.security_findings FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','security_analyst']::public.app_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','security_analyst']::public.app_role[]));

-- AUDIT (append only)
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'user',
  action text NOT NULL,
  resource text NOT NULL,
  resource_id text,
  decision public.gov_action,
  policy_id uuid,
  policy_version integer,
  request_id uuid,
  source text NOT NULL DEFAULT 'console',
  risk public.severity NOT NULL DEFAULT 'info',
  result text NOT NULL DEFAULT 'success',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read audit" ON public.audit_events FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "members insert audit" ON public.audit_events FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE INDEX audit_org_created_idx ON public.audit_events (org_id, created_at DESC);

-- BUDGETS
CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  scope text NOT NULL DEFAULT 'organization',
  scope_ref text,
  period text NOT NULL DEFAULT 'monthly',
  limit_usd numeric(12,2) NOT NULL,
  action_on_exceed public.gov_action NOT NULL DEFAULT 'BLOCK',
  status public.lifecycle_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read budgets" ON public.budgets FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "govern budgets" ON public.budgets FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','governance_admin']::public.app_role[]));

-- APPROVALS
CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.requests(id) ON DELETE SET NULL,
  requester_id uuid NOT NULL,
  action text NOT NULL,
  target text,
  risk public.severity NOT NULL DEFAULT 'medium',
  reason text,
  policy_id uuid,
  policy_version integer,
  status text NOT NULL DEFAULT 'pending',
  approver_id uuid,
  decided_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  execution_result text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read approvals" ON public.approvals FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "members create approvals" ON public.approvals FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id) AND requester_id = auth.uid());
CREATE POLICY "approvers decide" ON public.approvals FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','governance_admin']::public.app_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['platform_admin','org_admin','security_admin','governance_admin']::public.app_role[]));