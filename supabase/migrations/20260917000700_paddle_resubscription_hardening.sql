-- Close residual trigger-function grants and support safe Paddle resubscription.
REVOKE ALL ON FUNCTION public.nexora_provision_trial() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nexora_enforce_plan_resource_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nexora_enforce_seat_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_provision_trial() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_enforce_plan_resource_limit() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexora_enforce_seat_limit() TO service_role;

CREATE OR REPLACE FUNCTION public.nexora_apply_paddle_event(
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
DECLARE replacing_subscription boolean := false;
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

  IF NOT FOUND AND p_signed_identity IS TRUE AND p_org IS NOT NULL THEN
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
    replacing_subscription := true;
    IF p_signed_identity IS NOT TRUE
      OR p_org IS NULL
      OR current.org_id <> p_org
      OR current.status NOT IN ('canceled','incomplete')
      OR p_event_type NOT IN (
        'subscription.created',
        'subscription.activated',
        'subscription.trialing'
      ) THEN
      RAISE EXCEPTION 'Organization already has another Paddle subscription';
    END IF;
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
  RETURN jsonb_build_object(
    'result',
    result_value,
    'subscription_replaced',
    replacing_subscription AND result_value = 'processed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_apply_paddle_event(
  text,timestamptz,text,uuid,boolean,text,text,text,text,timestamptz,timestamptz,boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_apply_paddle_event(
  text,timestamptz,text,uuid,boolean,text,text,text,text,timestamptz,timestamptz,boolean
) TO service_role;
