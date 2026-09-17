CREATE TABLE public.agent_connections (
  device_hash text PRIMARY KEY,
  user_code text NOT NULL UNIQUE,
  client_name text NOT NULL,
  scopes text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','consumed')),
  org_id uuid REFERENCES public.organizations(id),
  agent_id uuid REFERENCES public.agents(id),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  last_polled_at timestamptz
);
ALTER TABLE public.agent_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_connections FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.agent_connections TO service_role;

CREATE FUNCTION public.nexora_start_connection(p_hash text,p_code text,p_name text,p_scopes text[])
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nexora-device-connect',0));
  IF (SELECT count(*) FROM public.agent_connections WHERE created_at>now()-interval '1 minute')>=100 THEN RAISE EXCEPTION 'Connection rate limit'; END IF;
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_code !~ '^[A-F0-9]{10}$'
    OR length(p_name) NOT BETWEEN 1 AND 80 OR cardinality(p_scopes) NOT BETWEEN 1 AND 5
    OR NOT p_scopes <@ ARRAY['requests:read','findings:read','policies:read','model:invoke','findings:resolve'] THEN RAISE EXCEPTION 'Invalid connection'; END IF;
  DELETE FROM public.agent_connections WHERE expires_at<now()-interval '1 day';
  INSERT INTO public.agent_connections(device_hash,user_code,client_name,scopes) VALUES(p_hash,p_code,p_name,p_scopes);
END; $$;

CREATE FUNCTION public.nexora_consent_connection(p_code text,p_org uuid,p_actor uuid,p_allow boolean,p_scopes text[])
RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.agent_connections; aid uuid; roles public.app_role[];
BEGIN
  SELECT array_agg(role) INTO roles FROM public.org_members WHERE org_id=p_org AND user_id=p_actor;
  IF roles IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO c FROM public.agent_connections WHERE user_code=p_code FOR UPDATE;
  IF NOT FOUND OR c.status<>'pending' OR c.expires_at<=now() THEN RAISE EXCEPTION 'Connection unavailable'; END IF;
  IF NOT p_allow THEN
    UPDATE public.agent_connections SET status='denied',org_id=p_org,approved_by=p_actor WHERE device_hash=c.device_hash;
    RETURN NULL;
  END IF;
  IF p_scopes IS NULL OR cardinality(p_scopes)<1 OR NOT p_scopes <@ c.scopes THEN RAISE EXCEPTION 'Invalid scope selection'; END IF;
  IF 'model:invoke'=ANY(p_scopes) AND NOT (roles && ARRAY['platform_admin','org_admin','security_admin','governance_admin','agent_admin','developer']::public.app_role[]) THEN RAISE EXCEPTION 'Role cannot grant model execution'; END IF;
  IF 'findings:resolve'=ANY(p_scopes) AND NOT (roles && ARRAY['platform_admin','org_admin','security_admin']::public.app_role[]) THEN RAISE EXCEPTION 'Role cannot grant finding updates'; END IF;
  INSERT INTO public.agents(org_id,name,slug,owner_id,status,description) VALUES(p_org,c.client_name,'connected-'||gen_random_uuid()::text,p_actor,'draft','Connected with explicit user consent') RETURNING id INTO aid;
  INSERT INTO public.agent_capabilities(org_id,agent_id,capability,granted_by) SELECT p_org,aid,s,p_actor FROM unnest(p_scopes) s ON CONFLICT DO NOTHING;
  UPDATE public.agent_connections SET status='approved',org_id=p_org,agent_id=aid,approved_by=p_actor,scopes=p_scopes WHERE device_hash=c.device_hash;
  INSERT INTO public.audit_events(org_id,actor_id,action,resource,resource_id,result,metadata)
    VALUES(p_org,p_actor,'agent.connection_approved','agent',aid::text,'approved',jsonb_build_object('scopes',p_scopes));
  RETURN aid;
END; $$;

CREATE FUNCTION public.nexora_exchange_connection(p_hash text,p_token_hash text,p_prefix text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.agent_connections;
BEGIN
  SELECT * INTO c FROM public.agent_connections WHERE device_hash=p_hash FOR UPDATE;
  IF NOT FOUND OR c.expires_at<=now() THEN RETURN jsonb_build_object('error','expired_token'); END IF;
  IF c.status='denied' THEN RETURN jsonb_build_object('error','access_denied'); END IF;
  IF c.status='consumed' THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
  IF c.last_polled_at>now()-interval '5 seconds' THEN RETURN jsonb_build_object('error','slow_down'); END IF;
  UPDATE public.agent_connections SET last_polled_at=now() WHERE device_hash=p_hash;
  IF c.status='pending' THEN RETURN jsonb_build_object('error','authorization_pending'); END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_prefix IS NULL THEN RAISE EXCEPTION 'Invalid credential'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id=c.org_id AND user_id=c.approved_by) THEN RETURN jsonb_build_object('error','access_denied'); END IF;
  UPDATE public.agents SET token_hash=p_token_hash,token_prefix=p_prefix,credential_expires_at=now()+interval '90 days',status='active'
    WHERE id=c.agent_id AND org_id=c.org_id AND status='draft';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','access_denied'); END IF;
  UPDATE public.agent_connections SET status='consumed' WHERE device_hash=p_hash;
  INSERT INTO public.audit_events(org_id,actor_id,action,resource,resource_id,result)
    VALUES(c.org_id,c.approved_by,'agent.connected','agent',c.agent_id::text,'active');
  RETURN jsonb_build_object('agent_id',c.agent_id,'scope',array_to_string(c.scopes,' '));
END; $$;

CREATE FUNCTION public.nexora_revoke_connection(p_org uuid,p_agent uuid,p_actor uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_members m JOIN public.agents a ON a.org_id=m.org_id
    WHERE m.org_id=p_org AND a.id=p_agent AND m.user_id=p_actor AND (a.owner_id=p_actor OR m.role IN ('platform_admin','org_admin','security_admin','agent_admin'))) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.agents SET status='suspended',token_hash=NULL,token_prefix=NULL,credential_expires_at=NULL WHERE org_id=p_org AND id=p_agent;
  UPDATE public.agent_connections SET status='denied' WHERE org_id=p_org AND agent_id=p_agent AND status IN ('approved','pending');
  INSERT INTO public.audit_events(org_id,actor_id,action,resource,resource_id,result) VALUES(p_org,p_actor,'agent.disconnected','agent',p_agent::text,'revoked');
END; $$;

REVOKE ALL ON FUNCTION public.nexora_start_connection(text,text,text,text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nexora_consent_connection(text,uuid,uuid,boolean,text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nexora_exchange_connection(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nexora_revoke_connection(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_start_connection(text,text,text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_consent_connection(text,uuid,uuid,boolean,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_exchange_connection(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_revoke_connection(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.nexora_agent_finding(p_org uuid,p_agent uuid,p_finding uuid,p_status text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF p_status NOT IN ('open','resolved') OR p_status IS NULL THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents a JOIN public.agent_capabilities c ON c.agent_id=a.id AND c.org_id=a.org_id
    JOIN public.org_members m ON m.org_id=a.org_id AND m.user_id=a.owner_id
    WHERE a.org_id=p_org AND a.id=p_agent AND a.status='active' AND a.credential_expires_at>now()
    AND c.capability='findings:resolve' AND m.role IN ('platform_admin','org_admin','security_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.security_findings SET status=p_status WHERE id=p_finding AND org_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finding unavailable'; END IF;
  INSERT INTO public.audit_events(org_id,actor_type,action,resource,resource_id,result,metadata)
    VALUES(p_org,'agent','finding.updated','finding',p_finding::text,p_status,jsonb_build_object('agentId',p_agent));
END; $$;
REVOKE ALL ON FUNCTION public.nexora_agent_finding(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_agent_finding(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.nexora_agent_usage(p_org uuid)
RETURNS TABLE(agent_id uuid,request_count bigint,cost_usd numeric,input_tokens bigint,output_tokens bigint,last_used_at timestamptz)
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT r.agent_id,count(*),coalesce(sum(r.cost_usd),0),coalesce(sum(r.input_tokens),0),
    coalesce(sum(r.output_tokens),0),max(r.created_at)
  FROM public.requests r WHERE r.org_id=p_org AND r.agent_id IS NOT NULL GROUP BY r.agent_id;
$$;
REVOKE ALL ON FUNCTION public.nexora_agent_usage(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_agent_usage(uuid) TO service_role;
