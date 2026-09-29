-- Reprice current commercial plans without rewriting the original billing migration.
-- Existing subscription entitlement keys and limits are unchanged.
UPDATE public.billing_plans
SET monthly_price_usd = 49,
    annual_price_usd = 490
WHERE plan_key = 'solo';

UPDATE public.billing_plans
SET monthly_price_usd = 399,
    annual_price_usd = 3990
WHERE plan_key = 'team';

UPDATE public.billing_plans
SET monthly_price_usd = NULL,
    annual_price_usd = NULL
WHERE plan_key = 'enterprise';
