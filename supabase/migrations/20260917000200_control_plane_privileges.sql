-- Browser clients may read public agent metadata, never credential hashes.
REVOKE SELECT ON public.agents FROM PUBLIC, authenticated, anon;
GRANT SELECT (id, org_id, name, slug, description, owner_id, status, token_prefix,
  last_used_at, created_at, updated_at) ON public.agents TO authenticated;

-- Mutations go through role-checked server actions, including tenant validation
-- of capability parents and audited changes. RLS still scopes metadata reads.
REVOKE INSERT, UPDATE, DELETE ON public.agents, public.agent_capabilities,
  public.mcp_servers, public.mcp_tools, public.mcp_tool_grants FROM PUBLIC, authenticated, anon;
-- Supabase default grants can include TRUNCATE, which is not protected by RLS.
-- Browser-facing roles never need schema-level or whole-table operations.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC, authenticated, anon;
ALTER TABLE public.agents ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.mcp_servers ALTER COLUMN status SET DEFAULT 'draft';
