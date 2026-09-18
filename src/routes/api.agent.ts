import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const respond = (body: unknown, status = 200) =>
          Response.json(body, {
            status,
            headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
          });
        const { agentBearer } = await import("@/lib/nexora/agent-credentials");
        try {
          agentBearer(request.headers.get("authorization"));
        } catch {
          return respond({ error: "Valid agent bearer credential required." }, 401);
        }
        let input;
        try {
          input = await (await import("@/lib/nexora/agent-input")).readAgentBody(request);
        } catch {
          return respond({ error: "Invalid JSON task or request exceeds its size limit." }, 400);
        }
        let agent;
        const { authenticateAgent, runAgentOperation } = await import("@/lib/nexora/agents.server");
        try {
          agent = await authenticateAgent(
            request.headers.get("authorization"),
            input.idempotencyKey,
          );
        } catch {
          return respond(
            {
              error:
                "Agent admission denied: check credential, status, duplicate key and rate limit.",
            },
            403,
          );
        }
        try {
          const result = await runAgentOperation(agent.org_id, agent.id, input);
          return respond(result);
        } catch {
          return respond(
            {
              error:
                "Task stopped. Verify capabilities, tool grants and server configuration. Do not retry an ambiguous external action automatically.",
            },
            403,
          );
        }
      },
    },
  },
});
