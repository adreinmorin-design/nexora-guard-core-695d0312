-- Security hardening: make tenant and billing invariants database-enforced.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "bootstrap or admin add member" ON public.org_members;
CREATE POLICY "bootstrap or admin add member" ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    (
      role = 'org_admin'
      AND NOT EXISTS (
        SELECT 1 FROM public.org_members existing WHERE existing.org_id = org_members.org_id
      )
      AND EXISTS (
        SELECT 1 FROM public.organizations organization
        WHERE organization.id = org_members.org_id
          AND organization.created_by = auth.uid()
      )
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

-- A model, capability, tool, grant, invocation, finding or approval may never
-- point across organization boundaries, even when service_role is used.
ALTER TABLE public.providers ADD CONSTRAINT providers_org_id_id_unique UNIQUE (org_id, id);
ALTER TABLE public.requests ADD CONSTRAINT requests_org_id_id_unique UNIQUE (org_id, id);
ALTER TABLE public.agents ADD CONSTRAINT agents_org_id_id_unique UNIQUE (org_id, id);
ALTER TABLE public.mcp_servers ADD CONSTRAINT mcp_servers_org_id_id_unique UNIQUE (org_id, id);
ALTER TABLE public.mcp_tools ADD CONSTRAINT mcp_tools_org_id_id_unique UNIQUE (org_id, id);

ALTER TABLE public.models
  ADD CONSTRAINT models_org_provider_fk
  FOREIGN KEY (org_id, provider_id) REFERENCES public.providers(org_id, id);
ALTER TABLE public.agent_capabilities
  ADD CONSTRAINT agent_capabilities_org_agent_fk
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);
ALTER TABLE public.mcp_tools
  ADD CONSTRAINT mcp_tools_org_server_fk
  FOREIGN KEY (org_id, server_id) REFERENCES public.mcp_servers(org_id, id);
ALTER TABLE public.mcp_tool_grants
  ADD CONSTRAINT mcp_tool_grants_org_agent_fk
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);
ALTER TABLE public.mcp_tool_grants
  ADD CONSTRAINT mcp_tool_grants_org_tool_fk
  FOREIGN KEY (org_id, tool_id) REFERENCES public.mcp_tools(org_id, id);
ALTER TABLE public.tool_invocations
  ADD CONSTRAINT tool_invocations_org_agent_fk
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id);
ALTER TABLE public.tool_invocations
  ADD CONSTRAINT tool_invocations_org_tool_fk
  FOREIGN KEY (org_id, tool_id) REFERENCES public.mcp_tools(org_id, id);
ALTER TABLE public.security_findings
  ADD CONSTRAINT security_findings_org_request_fk
  FOREIGN KEY (org_id, request_id) REFERENCES public.requests(org_id, id);
ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_org_request_fk
  FOREIGN KEY (org_id, request_id) REFERENCES public.requests(org_id, id);

ALTER TABLE public.billing_subscriptions
  ADD COLUMN last_event_at timestamptz,
  ADD COLUMN last_event_id text;

CREATE TABLE public.paddle_webhook_events (
  event_id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_subscription_id text NOT NULL,
  result text NOT NULL CHECK (result IN ('processed', 'stale')),
  processed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(event_id) BETWEEN 1 AND 200),
  CHECK (length(event_type) BETWEEN 1 AND 100)
);
ALTER TABLE public.paddle_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paddle_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paddle_webhook_events TO service_role;

CREATE FUNCTION public.nexora_apply_paddle_event(
  p_event_id text,
  p_occurred_at timestamptz,
  p_event_type text,
  p_org uuid,
  p_signed_identity boolean,
  p_plan_key text,
  p_status text,
  p_customer text,
  p_subscription text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE current public.billing_subscriptions;
DECLARE result_value text := 'processed';
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200
    OR p_event_type IS NULL OR length(p_event_type) NOT BETWEEN 1 AND 100
    OR p_occurred_at IS NULL
    OR p_subscription IS NULL OR length(p_subscription) NOT BETWEEN 1 AND 255
    OR p_status NOT IN ('trialing','active','past_due','canceled','incomplete')
    OR (p_plan_key IS NOT NULL AND p_plan_key NOT IN ('solo','team')) THEN
    RAISE EXCEPTION 'Invalid Paddle event';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id, 0));
  IF EXISTS (SELECT 1 FROM public.paddle_webhook_events WHERE event_id = p_event_id) THEN
    RETURN jsonb_build_object('result', 'duplicate');
  END IF;

  SELECT * INTO current
  FROM public.billing_subscriptions
  WHERE provider_subscription_id = p_subscription
  FOR UPDATE;

  IF NOT FOUND AND p_signed_identity AND p_org IS NOT NULL THEN
    SELECT * INTO current
    FROM public.billing_subscriptions
    WHERE org_id = p_org
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signed organization identity required for first subscription event';
  END IF;
  IF p_org IS NOT NULL AND current.org_id <> p_org THEN
    RAISE EXCEPTION 'Subscription organization mismatch';
  END IF;
  IF current.provider_subscription_id IS NOT NULL
    AND current.provider_subscription_id <> p_subscription THEN
    RAISE EXCEPTION 'Organization already has another Paddle subscription';
  END IF;
  IF current.last_event_at IS NOT NULL AND p_occurred_at < current.last_event_at THEN
    result_value := 'stale';
  ELSE
    IF p_plan_key IS NULL AND current.plan_key IS NULL THEN
      RAISE EXCEPTION 'Subscription plan unavailable';
    END IF;
    UPDATE public.billing_subscriptions SET
      plan_key = coalesce(p_plan_key, current.plan_key),
      status = p_status,
      provider_customer_id = coalesce(p_customer, current.provider_customer_id),
      provider_subscription_id = p_subscription,
      current_period_start = p_period_start,
      current_period_end = p_period_end,
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      last_event_at = p_occurred_at,
      last_event_id = p_event_id,
      updated_at = now()
    WHERE org_id = current.org_id;
  END IF;

  INSERT INTO public.paddle_webhook_events(
    event_id, occurred_at, event_type, org_id, provider_subscription_id, result
  ) VALUES (
    p_event_id, p_occurred_at, p_event_type, current.org_id, p_subscription, result_value
  );
  RETURN jsonb_build_object('result', result_value);
END;
$$;
REVOKE ALL ON FUNCTION public.nexora_apply_paddle_event(
  text,timestamptz,text,uuid,boolean,text,text,text,text,timestamptz,timestamptz,boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_apply_paddle_event(
  text,timestamptz,text,uuid,boolean,text,text,text,text,timestamptz,timestamptz,boolean
) TO service_role;
