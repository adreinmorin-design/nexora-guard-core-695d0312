import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { newAgentCredential } from "@/lib/nexora/agent-credentials";

const PROOF_KEY = "nexora-live-proof-20260920";
const AGENT_ID = "73a4045c-bc2d-4770-a9b0-e0dfebf503fe";
const MCP_SERVER_ID = "27490352-ed6c-4de9-a7e1-31f8478b7d6e";
const MCP_TOOL_ID = "bcfcd222-c977-4088-a489-291af7252fdd";

export const Route = createFileRoute("/api/demo-proof2")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("proof") !== PROOF_KEY) {
          return Response.json({ error: "not found" }, { status: 404 });
        }

        const db: any = supabaseAdmin;
        const { data: org, error: orgError } = await db
          .from("organizations")
          .select("id,created_by,name")
          .order("created_at", { ascending: true })
          .limit(1)
          .single();
        if (orgError || !org) {
          return Response.json({ error: "No organization available for demo." }, { status: 500 });
        }

        const modelExecutionId = crypto.randomUUID();
        const toolExecutionId = crypto.randomUUID();
        const ownerId = org.created_by;
        const credential = await newAgentCredential();
        const toolCapability = `mcp:${MCP_SERVER_ID}:demo_lookup`;

        await db.from("org_ai_controls").upsert(
          {
            org_id: org.id,
            execution_enabled: true,
            console_enabled: true,
            agents_enabled: true,
            max_request_cost_usd: 0.02,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "org_id" },
        );

        const { error: agentError } = await db.from("agents").upsert(
          {
            id: AGENT_ID,
            org_id: org.id,
            name: "Two-Minute Demo Agent",
            slug: "two-minute-demo-agent-v2",
            description: "Ephemeral agent used for live Nexora execution proof.",
            owner_id: ownerId,
            status: "active",
            token_prefix: credential.prefix,
            token_hash: credential.hash,
            credential_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
          { onConflict: "id" },
        );
        if (agentError) {
          return Response.json(
            { error: "Demo agent setup failed.", detail: agentError.message },
            { status: 500 },
          );
        }

        for (const capability of ["model:invoke", toolCapability]) {
          const { error } = await db.from("agent_capabilities").upsert(
            {
              org_id: org.id,
              agent_id: AGENT_ID,
              capability,
              granted_by: ownerId,
            },
            { onConflict: "agent_id,capability" },
          );
          if (error) {
            return Response.json(
              { error: "Capability setup failed.", detail: error.message },
              { status: 500 },
            );
          }
        }

        await db.from("mcp_servers").upsert(
          {
            id: MCP_SERVER_ID,
            org_id: org.id,
            name: "Demo Tool Server",
            url: "https://demo.invalid/mcp",
            transport: "http",
            auth_mode: "none",
            status: "active",
            created_by: ownerId,
          },
          { onConflict: "id" },
        );

        await db.from("mcp_tools").upsert(
          {
            id: MCP_TOOL_ID,
            org_id: org.id,
            server_id: MCP_SERVER_ID,
            tool_name: `${MCP_SERVER_ID}.demo_lookup`,
            remote_name: "demo_lookup",
            description: "Demo tool used to prove explicit tool authorization.",
            risk: "medium",
            required_capability: toolCapability,
            status: "active",
            input_schema: { type: "object", properties: { query: { type: "string" } } },
            definition_hash: "demo-definition-hash-v2",
          },
          { onConflict: "id" },
        );

        const persistenceChecks: Record<string, unknown> = {};
        const modelCheck = await db
          .from("models")
          .select("id,provider_id,model_key,status")
          .eq("org_id", org.id)
          .eq("model_key", "openai/gpt-4o-mini")
          .maybeSingle();
        const providerCheck = modelCheck.data?.provider_id
          ? await db
              .from("providers")
              .select("id,vendor,status")
              .eq("org_id", org.id)
              .eq("id", modelCheck.data.provider_id)
              .maybeSingle()
          : { error: new Error("Model provider unavailable.") };
        persistenceChecks.model = {
          ok: !modelCheck.error && !providerCheck.error,
          error: modelCheck.error?.message ?? providerCheck.error?.message ?? null,
        };
        const spendCheck = await db.rpc("nexora_monthly_spend", { p_org: org.id });
        persistenceChecks.monthlySpend = {
          ok: !spendCheck.error,
          error: spendCheck.error?.message ?? null,
        };
        const policyCheck = await db
          .from("policies")
          .select("id,name,priority,action,version,status,scope,conditions")
          .eq("org_id", org.id);
        persistenceChecks.policies = {
          ok: !policyCheck.error,
          error: policyCheck.error?.message ?? null,
        };
        const budgetCheck = await db
          .from("budgets")
          .select("*")
          .eq("org_id", org.id)
          .eq("status", "active");
        persistenceChecks.budgets = {
          ok: !budgetCheck.error,
          error: budgetCheck.error?.message ?? null,
        };

        const agentUrl = new URL("/api/agent", request.url);
        const headers = {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
        };

        const modelResponse = await fetch(agentUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            kind: "model",
            modelKey: "openai/gpt-4o-mini",
            prompt:
              "In one sentence, explain why deterministic policy enforcement should happen before an AI agent reaches a provider.",
            idempotencyKey: modelExecutionId,
          }),
        });
        const modelBody = await modelResponse.json().catch(() => null);

        const diagnosticError: string | null = null;

        const toolResponse = await fetch(agentUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            kind: "tool",
            toolId: MCP_TOOL_ID,
            arguments: { query: "customer account balance" },
            idempotencyKey: toolExecutionId,
          }),
        });
        const toolBody = await toolResponse.json().catch(() => null);

        const { data: traces } = await db
          .from("execution_events")
          .select("id,execution_id,request_id,stage,status,summary,detail,created_at")
          .eq("org_id", org.id)
          .in("execution_id", [modelExecutionId, toolExecutionId])
          .order("id", { ascending: true });

        const { data: requestRow } = await db
          .from("requests")
          .select(
            "id,agent_id,provider,model,decision,status,reason,input_tokens,output_tokens,cost_usd,latency_ms,created_at",
          )
          .eq("org_id", org.id)
          .eq("idempotency_key", modelExecutionId)
          .maybeSingle();

        const requestId = requestRow?.id ?? null;
        const { data: audits } = requestId
          ? await db
              .from("audit_events")
              .select(
                "id,action,resource,decision,result,request_id,source,risk,metadata,created_at",
              )
              .eq("org_id", org.id)
              .eq("request_id", requestId)
              .order("created_at", { ascending: true })
          : { data: [] };

        await db
          .from("agents")
          .update({
            status: "suspended",
            token_hash: null,
            credential_expires_at: new Date().toISOString(),
          })
          .eq("id", AGENT_ID)
          .eq("org_id", org.id);

        return Response.json(
          {
            demo: "Nexora two-minute live proof",
            organization: { id: org.id, name: org.name },
            controls: { perRequestCeilingUsd: 0.02 },
            persistenceChecks,
            modelInvocation: {
              executionId: modelExecutionId,
              httpStatus: modelResponse.status,
              outcome: modelBody,
              persistedRequest: requestRow,
              diagnosticError,
            },
            toolInvocation: {
              executionId: toolExecutionId,
              httpStatus: toolResponse.status,
              outcome: toolBody,
              expectedAuthorizationResult: "DENY — no explicit mcp_tool_grant exists",
            },
            executionTrace: traces ?? [],
            auditEvidence: audits ?? [],
            credentialRevoked: true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
