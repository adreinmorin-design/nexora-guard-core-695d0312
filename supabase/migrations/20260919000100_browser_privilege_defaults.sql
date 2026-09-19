-- Close legacy/browser grants and make future exposed objects opt-in.
--
-- Migration 20260917000200 hardened the then-existing tables, but later billing
-- tables inherited the project's permissive default privileges. RLS blocks
-- ordinary row writes, but privileges such as TRUNCATE are not row-level
-- operations and should never be available to browser roles.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

REVOKE ALL ON public.billing_plans, public.billing_subscriptions
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.billing_plans TO anon, authenticated;
GRANT SELECT ON public.billing_subscriptions TO authenticated;

-- Reassert the non-row privileges for every table, including tables created
-- after the earlier control-plane hardening migration.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- Public RPC is not part of the browser trust boundary. Authenticated users
-- operate through RLS-backed table access and server functions; server RPCs
-- use service_role. Private-schema RLS helpers are unaffected.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Existing service-only RPC grants remain intact because service_role is not
-- included above. Prevent future objects from silently inheriting browser
-- access; migrations must grant only the operations they intentionally expose.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
-- PostgreSQL grants EXECUTE on new functions to PUBLIC at the global
-- default level. A per-schema REVOKE cannot subtract that global grant, so
-- remove it globally for objects subsequently created by the migration owner.
-- Any callable function must be granted explicitly after creation.
ALTER DEFAULT PRIVILEGES
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
