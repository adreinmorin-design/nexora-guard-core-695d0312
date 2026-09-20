-- Server-authoritative premium entitlements and consented device AI inventory.
--
-- Premium feature checks are enforced twice:
--   1. application server functions fail closed before premium actions; and
--   2. restrictive RLS / database triggers prevent direct browser or accidental
--      service-role writes from bypassing the subscription tier.
--
-- Device discovery stores only bounded product metadata reported by an enrolled
-- NEXORA agent. It does not collect command lines, file paths, prompts, browser
-- history, document names, or provider credentials.

CREATE OR REPLACE FUNCTION private.has_feature_entitlement(p_org uuid, p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.billing_subscriptions s
    WHERE s.org_id = p_org
      AND (
        s.status = 'active'
        OR (s.status = 'trialing' AND s.trial_ends_at > now())
      )
      AND CASE p_feature
        WHEN 'human_approvals' THEN s.plan_key IN ('team','enterprise')
        WHEN 'mcp_controls' THEN s.plan_key IN ('team','enterprise')
        WHEN 'security_tests' THEN s.plan_key IN ('team','enterprise')
        WHEN 'attack_simulation' THEN s.plan_key IN ('team','enterprise')
        WHEN 'device_ai_discovery' THEN s.plan_key IN ('team','enterprise')
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION private.has_feature_entitlement(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_feature_entitlement(uuid,text)
  TO authenticated, service_role;

-- Existing permissive tenant policies still determine membership/role access.
-- These restrictive policies add a mandatory plan entitlement on top.
DROP POLICY IF EXISTS "mcp servers require entitlement" ON public.mcp_servers;
CREATE POLICY "mcp servers require entitlement"
  ON public.mcp_servers
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (private.has_feature_entitlement(org_id,'mcp_controls'))
  WITH CHECK (private.has_feature_entitlement(org_id,'mcp_controls'));

DROP POLICY IF EXISTS "mcp tools require entitlement" ON public.mcp_tools;
CREATE POLICY "mcp tools require entitlement"
  ON public.mcp_tools
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (private.has_feature_entitlement(org_id,'mcp_controls'))
  WITH CHECK (private.has_feature_entitlement(org_id,'mcp_controls'));

DROP POLICY IF EXISTS "mcp grants require entitlement" ON public.mcp_tool_grants;
CREATE POLICY "mcp grants require entitlement"
  ON public.mcp_tool_grants
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (private.has_feature_entitlement(org_id,'mcp_controls'))
  WITH CHECK (private.has_feature_entitlement(org_id,'mcp_controls'));

DROP POLICY IF EXISTS "tool invocations require entitlement" ON public.tool_invocations;
CREATE POLICY "tool invocations require entitlement"
  ON public.tool_invocations
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (private.has_feature_entitlement(org_id,'mcp_controls'));

DROP POLICY IF EXISTS "approvals require entitlement" ON public.approvals;
CREATE POLICY "approvals require entitlement"
  ON public.approvals
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (private.has_feature_entitlement(org_id,'human_approvals'))
  WITH CHECK (private.has_feature_entitlement(org_id,'human_approvals'));

DROP POLICY IF EXISTS "approval policies require entitlement insert" ON public.policies;
CREATE POLICY "approval policies require entitlement insert"
  ON public.policies
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    action <> 'REQUIRE_APPROVAL'::public.gov_action
    OR private.has_feature_entitlement(org_id,'human_approvals')
  );

DROP POLICY IF EXISTS "approval policies require entitlement update" ON public.policies;
CREATE POLICY "approval policies require entitlement update"
  ON public.policies
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    action <> 'REQUIRE_APPROVAL'::public.gov_action
    OR private.has_feature_entitlement(org_id,'human_approvals')
  );

CREATE TABLE public.device_ai_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  device_fingerprint text NOT NULL CHECK (device_fingerprint ~ '^[a-f0-9]{64}$'),
  device_label text CHECK (device_label IS NULL OR length(device_label) <= 80),
  platform text NOT NULL CHECK (platform IN ('windows','macos','linux')),
  observation_key text NOT NULL CHECK (observation_key ~ '^[a-f0-9]{64}$'),
  observation_type text NOT NULL CHECK (
    observation_type IN (
      'desktop_app',
      'local_runtime',
      'local_model',
      'browser_extension',
      'configured_provider'
    )
  ),
  app_name text NOT NULL CHECK (length(app_name) BETWEEN 1 AND 100),
  vendor text CHECK (vendor IS NULL OR length(vendor) <= 100),
  version text CHECK (version IS NULL OR length(version) <= 80),
  active boolean NOT NULL DEFAULT true,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_ai_inventory_org_agent_fk
    FOREIGN KEY (org_id,agent_id) REFERENCES public.agents(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,agent_id,device_fingerprint,observation_key)
);

ALTER TABLE public.device_ai_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_ai_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.device_ai_inventory TO authenticated;
GRANT ALL ON public.device_ai_inventory TO service_role;

CREATE POLICY "members read entitled device AI inventory"
  ON public.device_ai_inventory
  FOR SELECT
  TO authenticated
  USING (
    private.is_org_member(org_id)
    AND private.has_feature_entitlement(org_id,'device_ai_discovery')
  );

CREATE INDEX device_ai_inventory_org_last_seen_idx
  ON public.device_ai_inventory(org_id,last_seen DESC);
CREATE INDEX device_ai_inventory_agent_device_idx
  ON public.device_ai_inventory(agent_id,device_fingerprint);

-- Defense in depth for service-role paths. Cleanup DELETE operations remain
-- possible after a downgrade, but new/changed premium data cannot be written.
CREATE OR REPLACE FUNCTION public.nexora_enforce_feature_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE required_feature text;
BEGIN
  IF TG_TABLE_NAME = 'policies' THEN
    IF NEW.action <> 'REQUIRE_APPROVAL'::public.gov_action THEN
      RETURN NEW;
    END IF;
    required_feature := 'human_approvals';
  ELSIF TG_TABLE_NAME = 'approvals' THEN
    required_feature := 'human_approvals';
  ELSIF TG_TABLE_NAME IN ('mcp_servers','mcp_tools','mcp_tool_grants','tool_invocations') THEN
    required_feature := 'mcp_controls';
  ELSIF TG_TABLE_NAME = 'device_ai_inventory' THEN
    required_feature := 'device_ai_discovery';
  ELSE
    RAISE EXCEPTION 'Unknown premium resource';
  END IF;

  IF NOT private.has_feature_entitlement(NEW.org_id,required_feature) THEN
    RAISE EXCEPTION 'Plan entitlement required for %', required_feature;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_enforce_feature_entitlement()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_enforce_feature_entitlement()
  TO service_role;

DROP TRIGGER IF EXISTS approvals_entitlement_guard ON public.approvals;
CREATE TRIGGER approvals_entitlement_guard
  BEFORE INSERT OR UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_feature_entitlement();

DROP TRIGGER IF EXISTS policies_entitlement_guard ON public.policies;
CREATE TRIGGER policies_entitlement_guard
  BEFORE INSERT OR UPDATE OF action,org_id ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_feature_entitlement();

DROP TRIGGER IF EXISTS mcp_servers_entitlement_guard ON public.mcp_servers;
CREATE TRIGGER mcp_servers_entitlement_guard
  BEFORE INSERT OR UPDATE ON public.mcp_servers
  FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_feature_entitlement();

DROP TRIGGER IF EXISTS mcp_tools_entitlement_guard ON public.mcp_tools;
CREATE TRIGGER mcp_tools_entitlement_guard
  BEFORE INSERT OR UPDATE ON public.mcp_tools
  FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_feature_entitlement();

DROP TRIGGER IF EXISTS mcp_tool_grants_entitlement_guard ON public.mcp_tool_grants;
CREATE TRIGGER mcp_tool_grants_entitlement_guard
  BEFORE INSERT OR UPDATE ON public.mcp_tool_grants
  FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_feature_entitlement();

DROP TRIGGER IF EXISTS tool_invocations_entitlement_guard ON public.tool_invocations;
CREATE TRIGGER tool_invocations_entitlement_guard
  BEFORE INSERT OR UPDATE ON public.tool_invocations
  FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_feature_entitlement();

DROP TRIGGER IF EXISTS device_ai_inventory_entitlement_guard ON public.device_ai_inventory;
CREATE TRIGGER device_ai_inventory_entitlement_guard
  BEFORE INSERT OR UPDATE ON public.device_ai_inventory
  FOR EACH ROW EXECUTE FUNCTION public.nexora_enforce_feature_entitlement();
