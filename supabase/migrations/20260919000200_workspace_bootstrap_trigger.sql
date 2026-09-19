-- Workspace bootstrap hardening.
--
-- New organizations receive a billing trial from an AFTER INSERT trigger before
-- their founding org_members row is created. The seat-limit trigger runs during
-- that first membership insert. As a SECURITY INVOKER function it evaluates
-- billing_subscriptions through the founder's RLS context, but subscription
-- rows are readable only by existing organization members. That creates a
-- bootstrap deadlock: the founder cannot become a member because they are not
-- a member yet.
--
-- Run the trigger with the migration owner's privileges so it can enforce the
-- authoritative subscription/seat state without weakening table RLS. Direct
-- browser execution remains denied.
ALTER FUNCTION public.nexora_enforce_seat_limit() SECURITY DEFINER;
ALTER FUNCTION public.nexora_enforce_seat_limit() SET search_path = '';

REVOKE ALL ON FUNCTION public.nexora_enforce_seat_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_enforce_seat_limit() TO service_role;
