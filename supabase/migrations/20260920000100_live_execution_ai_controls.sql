-- Live execution tracing and organization-level AI controls.

CREATE TABLE public.org_ai_controls (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  execution_enabled boolean NOT NULL DEFAULT true,
  console_enabled boolean NOT NULL DEFAULT true,
  agents_enabled boolean NOT NULL DEFAULT true,
  max_request_cost_usd numeric(12,6),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_request_cost_usd IS NULL OR max_request_cost_usd >= 0)
);

ALTER TABLE public.org_ai_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_ai_controls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_ai_controls TO authenticated;
GRANT ALL ON public.org_ai_controls TO service_role;

CREATE POLICY "members read AI controls"
  ON public.org_ai_controls
  FOR SELECT
  TO authenticated
  USING (private.is_org_member(org_id));

INSERT INTO public.org_ai_controls(org_id)
SELECT id FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nexora_seed_ai_controls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.org_ai_controls(org_id)
  VALUES (NEW.id)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_seed_ai_controls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_seed_ai_controls() TO service_role;

DROP TRIGGER IF EXISTS organizations_ai_controls_seed ON public.organizations;
CREATE TRIGGER organizations_ai_controls_seed
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.nexora_seed_ai_controls();

CREATE TABLE public.execution_events (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL,
  request_id uuid,
  agent_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('agent','user')),
  stage text NOT NULL CHECK (
    stage IN (
      'identity',
      'permissions',
      'pii',
      'injection',
      'budget',
      'provider_selection',
      'tool_authorization',
      'execution',
      'audit'
    )
  ),
  status text NOT NULL CHECK (
    status IN ('pending','running','passed','blocked','redacted','not_applicable','failed','completed')
  ),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.execution_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.execution_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.execution_events TO authenticated;
GRANT ALL ON public.execution_events TO service_role;

CREATE POLICY "members read execution events"
  ON public.execution_events
  FOR SELECT
  TO authenticated
  USING (private.is_org_member(org_id));

CREATE INDEX execution_events_org_created_idx
  ON public.execution_events(org_id, created_at DESC);
CREATE INDEX execution_events_execution_idx
  ON public.execution_events(org_id, execution_id, id);

ALTER TABLE public.execution_events
  ADD CONSTRAINT execution_events_request_fk
  FOREIGN KEY (org_id,request_id) REFERENCES public.requests(org_id,id) ON DELETE SET NULL;

ALTER TABLE public.execution_events
  ADD CONSTRAINT execution_events_agent_fk
  FOREIGN KEY (org_id,agent_id) REFERENCES public.agents(org_id,id) ON DELETE SET NULL;
