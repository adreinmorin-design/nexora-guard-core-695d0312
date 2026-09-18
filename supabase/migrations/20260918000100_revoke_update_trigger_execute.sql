-- Remove direct API-role execution from the generic timestamp trigger helper.
-- The function is invoked by database triggers, not by PostgREST clients.
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
