CREATE TABLE public.billing_plans (
  plan_key text PRIMARY KEY CHECK (plan_key IN ('solo','team','enterprise')),
  name text NOT NULL,
  monthly_price_usd numeric(12,2),
  annual_price_usd numeric(12,2),
  seat_limit integer,
  agent_limit integer,
  monthly_request_limit integer,
  mcp_server_limit integer,
  audit_retention_days integer,
  active boolean NOT NULL DEFAULT true,
  CHECK (monthly_price_usd IS NULL OR monthly_price_usd >= 0),
  CHECK (annual_price_usd IS NULL OR annual_price_usd >= 0)
);

INSERT INTO public.billing_plans
  (plan_key,name,monthly_price_usd,annual_price_usd,seat_limit,agent_limit,monthly_request_limit,mcp_server_limit,audit_retention_days)
VALUES
  ('solo','Solo',49,490,1,3,25000,1,30),
  ('team','Team',249,2490,10,25,250000,10,180),
  ('enterprise','Enterprise',1500,NULL,NULL,NULL,NULL,NULL,NULL);

CREATE TABLE public.billing_subscriptions (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_key text NOT NULL REFERENCES public.billing_plans(plan_key),
  status text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  provider_customer_id text UNIQUE,
  provider_subscription_id text UNIQUE,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.billing_plans TO anon, authenticated;
GRANT SELECT ON public.billing_subscriptions TO authenticated;
GRANT ALL ON public.billing_plans, public.billing_subscriptions TO service_role;
CREATE POLICY "active plans are readable" ON public.billing_plans FOR SELECT USING (active);
CREATE POLICY "members read subscription" ON public.billing_subscriptions FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

CREATE FUNCTION public.nexora_provision_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.billing_subscriptions(org_id,plan_key,status,trial_ends_at)
    VALUES(NEW.id,'team','trialing',now()+interval '14 days') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER organizations_billing_trial AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.nexora_provision_trial();

INSERT INTO public.billing_subscriptions(org_id,plan_key,status,trial_ends_at)
  SELECT id,'team','trialing',now()+interval '14 days' FROM public.organizations
  ON CONFLICT DO NOTHING;

CREATE FUNCTION public.nexora_billing_usage(p_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'seats',(SELECT count(DISTINCT user_id) FROM public.org_members WHERE org_id=p_org),
    'agents',(SELECT count(*) FROM public.agents WHERE org_id=p_org AND status<>'archived'),
    'mcp_servers',(SELECT count(*) FROM public.mcp_servers WHERE org_id=p_org),
    'requests',(SELECT count(*) FROM public.requests WHERE org_id=p_org
      AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  );
$$;
REVOKE ALL ON FUNCTION public.nexora_billing_usage(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_billing_usage(uuid) TO service_role;

-- Subscription request quotas are admitted under the same organization lock as
-- budget reservations, so concurrent calls cannot race past either ceiling.
CREATE OR REPLACE FUNCTION public.nexora_reserve(p_org uuid, p_key text, p_cost numeric)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE b record; spent numeric; held numeric; cutoff timestamptz;
  max_requests integer; used_requests bigint;
BEGIN
  IF p_cost IS NULL OR p_cost <= 0 OR p_cost::text IN ('NaN','Infinity','-Infinity')
    OR p_key IS NULL OR length(p_key) = 0 THEN RAISE EXCEPTION 'Invalid admission request'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text, 0));
  IF EXISTS (SELECT 1 FROM public.gateway_reservations WHERE org_id=p_org AND idempotency_key=p_key)
    OR EXISTS (SELECT 1 FROM public.requests WHERE org_id=p_org AND idempotency_key=p_key) THEN
    RETURN jsonb_build_object('admitted',false,'reason','Duplicate or in-flight request.');
  END IF;
  SELECT p.monthly_request_limit INTO max_requests
    FROM public.billing_subscriptions s JOIN public.billing_plans p ON p.plan_key=s.plan_key
    WHERE s.org_id=p_org AND (s.status='active' OR (s.status='trialing' AND s.trial_ends_at>now()));
  IF NOT FOUND THEN RETURN jsonb_build_object('admitted',false,'reason','An active subscription is required.'); END IF;
  IF max_requests IS NOT NULL THEN
    cutoff := date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    SELECT
      (SELECT count(*) FROM public.requests r WHERE r.org_id=p_org AND r.created_at>=cutoff)
      +
      (SELECT count(*) FROM public.gateway_reservations g WHERE g.org_id=p_org AND g.created_at>=cutoff
        AND NOT EXISTS (SELECT 1 FROM public.requests r WHERE r.org_id=g.org_id AND r.idempotency_key=g.idempotency_key))
      INTO used_requests;
    IF used_requests>=max_requests THEN
      RETURN jsonb_build_object('admitted',false,'reason','Monthly plan request limit reached.');
    END IF;
  END IF;
  FOR b IN SELECT * FROM public.budgets WHERE org_id=p_org AND status='active' LOOP
    IF b.scope<>'organization' OR b.period NOT IN ('daily','weekly','monthly','yearly')
      OR b.limit_usd IS NULL OR b.limit_usd<0 THEN
      RETURN jsonb_build_object('admitted',false,'reason','Unsupported or invalid budget configuration.');
    END IF;
    cutoff := date_trunc(CASE b.period WHEN 'daily' THEN 'day' WHEN 'weekly' THEN 'week'
      WHEN 'yearly' THEN 'year' ELSE 'month' END,now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    SELECT coalesce(sum(cost_usd),0) INTO spent FROM public.requests WHERE org_id=p_org AND created_at>=cutoff;
    SELECT coalesce(sum(reserved_usd),0) INTO held FROM public.gateway_reservations WHERE org_id=p_org AND NOT settled;
    IF spent+held+p_cost>b.limit_usd THEN
      RETURN jsonb_build_object('admitted',false,'reason','Budget has insufficient unreserved funds.');
    END IF;
  END LOOP;
  INSERT INTO public.gateway_reservations(org_id,idempotency_key,reserved_usd) VALUES(p_org,p_key,p_cost);
  RETURN jsonb_build_object('admitted',true,'reason','Reserved');
END; $$;

CREATE FUNCTION public.nexora_enforce_plan_resource_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE limit_value integer; used integer; subscription_status text;
BEGIN
  SELECT s.status,
    CASE TG_TABLE_NAME WHEN 'agents' THEN p.agent_limit WHEN 'mcp_servers' THEN p.mcp_server_limit END
    INTO subscription_status,limit_value
  FROM public.billing_subscriptions s JOIN public.billing_plans p ON p.plan_key=s.plan_key
  WHERE s.org_id=NEW.org_id AND (s.status='active' OR (s.status='trialing' AND s.trial_ends_at>now()));
  IF subscription_status IS NULL THEN RAISE EXCEPTION 'An active subscription is required'; END IF;
  IF limit_value IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='agents' THEN SELECT count(*) INTO used FROM public.agents WHERE org_id=NEW.org_id AND status<>'archived';
  ELSE SELECT count(*) INTO used FROM public.mcp_servers WHERE org_id=NEW.org_id; END IF;
  IF used>=limit_value THEN RAISE EXCEPTION 'Plan resource limit reached'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER agents_plan_limit BEFORE INSERT ON public.agents FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_plan_resource_limit();
CREATE TRIGGER mcp_servers_plan_limit BEFORE INSERT ON public.mcp_servers FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_plan_resource_limit();

CREATE FUNCTION public.nexora_enforce_seat_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE max_seats integer; used integer; valid_subscription boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.org_members WHERE org_id=NEW.org_id AND user_id=NEW.user_id) THEN RETURN NEW; END IF;
  SELECT p.seat_limit,(s.status='active' OR (s.status='trialing' AND s.trial_ends_at>now()))
    INTO max_seats,valid_subscription FROM public.billing_subscriptions s
    JOIN public.billing_plans p ON p.plan_key=s.plan_key WHERE s.org_id=NEW.org_id;
  IF NOT coalesce(valid_subscription,false) THEN RAISE EXCEPTION 'An active subscription is required'; END IF;
  IF max_seats IS NULL THEN RETURN NEW; END IF;
  SELECT count(DISTINCT user_id) INTO used FROM public.org_members WHERE org_id=NEW.org_id;
  IF used>=max_seats THEN RAISE EXCEPTION 'Plan seat limit reached'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER org_members_plan_limit BEFORE INSERT ON public.org_members FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_seat_limit();
