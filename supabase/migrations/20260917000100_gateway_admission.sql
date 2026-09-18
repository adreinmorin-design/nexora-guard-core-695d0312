-- Server-only admission. No raw prompt or provider response is stored here.
CREATE TABLE public.gateway_reservations (
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  idempotency_key text NOT NULL,
  reserved_usd numeric NOT NULL CHECK (reserved_usd >= 0),
  settled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, idempotency_key)
);
ALTER TABLE public.gateway_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_reservations FROM anon, authenticated;
GRANT ALL ON public.gateway_reservations TO service_role;

-- Prevent browser clients from forging approvals, spend records or audit events.
REVOKE INSERT, UPDATE, DELETE ON public.approvals FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.security_findings FROM authenticated;

CREATE FUNCTION public.nexora_monthly_spend(p_org uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(sum(cost_usd), 0) FROM public.requests
  WHERE org_id = p_org AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
$$;

CREATE FUNCTION public.nexora_reserve(p_org uuid, p_key text, p_cost numeric)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE b record; spent numeric; held numeric; cutoff timestamptz;
BEGIN
  IF p_cost IS NULL OR p_cost <= 0 OR p_cost::text IN ('NaN','Infinity','-Infinity')
    OR p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'Invalid admission request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text, 0));
  IF EXISTS (SELECT 1 FROM public.gateway_reservations WHERE org_id=p_org AND idempotency_key=p_key)
    OR EXISTS (SELECT 1 FROM public.requests WHERE org_id=p_org AND idempotency_key=p_key) THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'Duplicate or in-flight request.');
  END IF;
  FOR b IN SELECT * FROM public.budgets WHERE org_id=p_org AND status='active' LOOP
    IF b.scope <> 'organization' OR b.period NOT IN ('daily','weekly','monthly','yearly')
      OR b.limit_usd IS NULL OR b.limit_usd < 0 THEN
      RETURN jsonb_build_object('admitted', false, 'reason', 'Unsupported or invalid budget configuration.');
    END IF;
    cutoff := date_trunc(CASE b.period WHEN 'daily' THEN 'day' WHEN 'weekly' THEN 'week'
      WHEN 'yearly' THEN 'year' ELSE 'month' END, now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    SELECT coalesce(sum(cost_usd),0) INTO spent FROM public.requests
      WHERE org_id=p_org AND created_at >= cutoff;
    -- Carry unresolved calls across period boundaries: a timeout is not proof
    -- of zero upstream cost. An operator must reconcile ambiguous reservations.
    SELECT coalesce(sum(reserved_usd),0) INTO held FROM public.gateway_reservations
      WHERE org_id=p_org AND NOT settled;
    IF spent + held + p_cost > b.limit_usd THEN
      RETURN jsonb_build_object('admitted', false, 'reason', 'Budget has insufficient unreserved funds.');
    END IF;
  END LOOP;
  INSERT INTO public.gateway_reservations(org_id,idempotency_key,reserved_usd)
    VALUES(p_org,p_key,p_cost);
  RETURN jsonb_build_object('admitted', true, 'reason', 'Reserved');
END;
$$;

CREATE FUNCTION public.nexora_settle(p_org uuid, p_key text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.requests WHERE org_id=p_org AND idempotency_key=p_key
    AND status <> 'provider_error') THEN
    RAISE EXCEPTION 'Request settlement requires a persisted terminal result';
  END IF;
  UPDATE public.gateway_reservations SET settled=true WHERE org_id=p_org AND idempotency_key=p_key;
END;
$$;

CREATE FUNCTION public.nexora_decide_approval(p_org uuid, p_id uuid, p_actor uuid, p_decision text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE a public.approvals;
BEGIN
  IF p_decision NOT IN ('approved','rejected') OR p_decision IS NULL THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id=p_org AND user_id=p_actor
    AND role IN ('platform_admin','org_admin','governance_admin','security_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO a FROM public.approvals WHERE id=p_id AND org_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status <> 'pending' OR a.requester_id=p_actor OR a.expires_at<=now()
    OR a.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Approval unavailable, expired, self-approved, or already decided';
  END IF;
  UPDATE public.approvals SET status=p_decision, approver_id=p_actor, decided_at=now(),
    consumed_at=now(), execution_result=CASE WHEN p_decision='approved' THEN 'executing' ELSE 'not_executed' END,
    policy_revalidated_at=now()
    WHERE id=p_id;
  INSERT INTO public.audit_events(org_id,actor_id,action,resource,resource_id,result,risk)
    VALUES(p_org,p_actor,'approval.' || p_decision,'approval',p_id::text,p_decision,'high');
  RETURN to_jsonb(a);
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_monthly_spend(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nexora_reserve(uuid,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nexora_settle(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nexora_decide_approval(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_monthly_spend(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_reserve(uuid,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_settle(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_decide_approval(uuid,uuid,uuid,text) TO service_role;
