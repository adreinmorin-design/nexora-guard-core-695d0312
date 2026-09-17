ALTER TABLE public.agents ADD COLUMN credential_expires_at timestamptz;
GRANT SELECT (credential_expires_at) ON public.agents TO authenticated;
CREATE UNIQUE INDEX agents_token_hash_unique ON public.agents(token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE public.agent_calls (
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,idempotency_key)
);
CREATE INDEX agent_calls_rate ON public.agent_calls(agent_id,created_at);
ALTER TABLE public.agent_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_calls FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.agent_calls TO service_role;

ALTER TABLE public.mcp_tools ADD COLUMN input_schema jsonb NOT NULL DEFAULT '{"type":"object"}'::jsonb;
ALTER TABLE public.mcp_tools ADD COLUMN remote_name text;
ALTER TABLE public.mcp_tools ADD COLUMN definition_hash text;

CREATE TABLE public.tool_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  tool_id uuid NOT NULL REFERENCES public.mcp_tools(id),
  idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'evaluating',
  decision text NOT NULL DEFAULT 'BLOCK',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,idempotency_key)
);
ALTER TABLE public.tool_invocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_invocations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.tool_invocations TO authenticated;
GRANT ALL ON public.tool_invocations TO service_role;
CREATE POLICY "members read tool invocations" ON public.tool_invocations FOR SELECT TO authenticated USING (private.is_org_member(org_id));

-- Credential rotation and its audit record commit together.
CREATE FUNCTION public.nexora_rotate_agent(p_org uuid,p_agent uuid,p_actor uuid,p_hash text,p_prefix text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id=p_org AND user_id=p_actor
    AND role IN ('platform_admin','org_admin','agent_admin','security_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_prefix IS NULL THEN RAISE EXCEPTION 'Invalid credential'; END IF;
  UPDATE public.agents SET token_hash=p_hash,token_prefix=p_prefix,status='active',credential_expires_at=now()+interval '90 days'
    WHERE org_id=p_org AND id=p_agent AND status<>'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent unavailable'; END IF;
  INSERT INTO public.audit_events(org_id,actor_id,action,resource,resource_id,result)
    VALUES(p_org,p_actor,'agent.credential_rotated','agent',p_agent::text,'active');
END; $$;

-- Shared admission for API and console execution; duplicate keys never retry.
CREATE FUNCTION public.nexora_claim_agent(p_agent uuid,p_key uuid,p_hash text DEFAULT NULL,p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.agents;
BEGIN
  SELECT * INTO a FROM public.agents WHERE id=p_agent FOR UPDATE;
  IF NOT FOUND OR a.status<>'active' OR a.credential_expires_at IS NULL OR a.credential_expires_at<=now() THEN RAISE EXCEPTION 'Agent unavailable'; END IF;
  IF p_actor IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id=a.org_id AND user_id=p_actor
      AND role IN ('platform_admin','org_admin','agent_admin','security_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  ELSIF p_hash IS NULL OR a.token_hash IS NULL OR a.token_hash<>p_hash THEN RAISE EXCEPTION 'Invalid agent credential';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id=a.org_id AND user_id=a.owner_id) THEN RAISE EXCEPTION 'Agent owner unavailable'; END IF;
  IF (SELECT count(*) FROM public.agent_calls WHERE agent_id=a.id AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'Agent rate limit exceeded'; END IF;
  INSERT INTO public.agent_calls(org_id,agent_id,idempotency_key) VALUES(a.org_id,a.id,p_key);
  UPDATE public.agents SET last_used_at=now() WHERE id=a.id;
  RETURN jsonb_build_object('id',a.id,'org_id',a.org_id,'owner_id',a.owner_id,'name',a.name);
END; $$;

REVOKE ALL ON FUNCTION public.nexora_rotate_agent(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nexora_claim_agent(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_rotate_agent(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_claim_agent(uuid,uuid,text,uuid) TO service_role;
