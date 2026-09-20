import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const NONCE = "J0_8_cPqDb-GbxkBIkIK_YSxHrqGtAFe";
const AGENT_ID = "bd264164-2ba1-4564-bde1-f21219b02a67";
const AGENT_TOKEN = "nxr_cc0d59b00f53b9fc7f5c98010c5027bf233ff619892def2d1350a363a1a6eeb9";
const AGENT_HASH = "e7e23f4b16bb0b3f54e6310a86fcf7050c0849e318fe2700403310f8f4a3dff9";
const MODEL_EXECUTION_ID = "9e2068ba-26dd-475d-89ec-d2e58efd58aa";
const TOOL_EXECUTION_ID = "0c3e7432-8110-4393-a23a-df75821daea1";
const MCP_SERVER_ID = "6342c629-4631-4b94-af04-31613f815500";
const MCP_TOOL_ID = "98f4db4d-9694-4144-9d5c-66ed76a9eb64";

export const Route = createFileRoute("/api/demo-proof")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("nonce") !== NONCE) {
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

        const ownerId = org.created_by;
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
            slug: "two-minute-demo-agent",
            description: "Ephemeral agent used for live Nexora execution proof.",
            owner_id: ownerId,
            status: "active",
            token_prefix: AGENT_TOKEN.slice(0, 12),
            token_hash: AGENT_HASH,
            credential_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          },
          { onConflict: "id" },
        );
        if (agentError) {
          return Response.json({ error: "Demo agent setup failed.", detail: agentError.message }, { status: 500 });
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
            return Response.json({ error: "Capability setup failed.", detail: error.message }, { status: 500 });
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
            definition_hash: "demo-definition-hash",
          },
          { onConflict: "id" },
        );

        // Intentionally DO NOT create mcp_tool_grants. This makes the second
        // invocation a live authorization denial before any remote side effect.
        const agentUrl = new URL("/api/agent", request.url);
        const commonHeaders = {
          Authorization: `Bearer ${AGENT_TOKEN}`,
          "Content-Type": "application/json",
        };

        const modelResponse = await fetch(agentUrl, {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            kind: "model",
            modelKey: "openai/gpt-4o-mini",
            prompt:
              "In one sentence, explain why deterministic policy enforcement should happen before an AI agent reaches a provider.",
            idempotencyKey: MODEL_EXECUTION_ID,
          }),
        });
        const modelBody = await modelResponse.json().catch(() => null);
        let diagnosticError: string | null = null;
        if (!modelResponse.ok) {
          try {
            const { executeAgentModel } = await import("@/lib/nexora/agents.server");
            await executeAgentModel(org.id, AGENT_ID, {
              modelKey: "openai/gpt-4o-mini",
              prompt: "Diagnostic governed provider request.",
              idempotencyKey: "b13bd35b-a9a2-49ef-9007-b594e0db0e29",
            });
          } catch (error) {
            diagnosticError = error instanceof Error ? error.message : "unknown error";
          }
        }

        const toolResponse = await fetch(agentUrl, {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            kind: "tool",
            toolId: MCP_TOOL_ID,
            arguments: { query: "customer account balance" },
            idempotencyKey: TOOL_EXECUTION_ID,
          }),
        });
        const toolBody = await toolResponse.json().catch(() => null);

        const { data: traces } = await db
          .from("execution_events")
          .select("id,execution_id,request_id,stage,status,summary,detail,created_at")
          .eq("org_id", org.id)
          .in("execution_id", [MODEL_EXECUTION_ID, TOOL_EXECUTION_ID])
          .order("id", { ascending: true });

        const { data: requestRow } = await db
          .from("requests")
          .select("id,agent_id,provider,model,decision,status,reason,input_tokens,output_tokens,cost_usd,latency_ms,created_at")
          .eq("org_id", org.id)
          .eq("idempotency_key", MODEL_EXECUTION_ID)
          .maybeSingle();

        const requestId = requestRow?.id ?? null;
        const { data: audits } = requestId
          ? await db
              .from("audit_events")
              .select("id,action,resource,decision,result,request_id,source,risk,metadata,created_at")
              .eq("org_id", org.id)
              .eq("request_id", requestId)
              .order("created_at", { ascending: true })
          : { data: [] };

        // Revoke the one-time credential after the proof while preserving
        // execution and audit evidence.
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
            modelInvocation: {
              httpStatus: modelResponse.status,
              outcome: modelBody,
              persistedRequest: requestRow,
              diagnosticError,
            },
            toolInvocation: {
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
