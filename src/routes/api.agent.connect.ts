import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
export const Route = createFileRoute("/api/agent/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const reply = (value: unknown, status = 200) =>
          Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
        let input;
        try {
          input = z
            .object({
              client_name: z.string().trim().min(1).max(80),
              scope: z.string().max(200).default("requests:read findings:read policies:read"),
            })
            .strict()
            .parse(await (await import("@/lib/nexora/agent-input")).readLimitedJson(request));
          const { CONNECTION_SCOPES } = await import("@/lib/nexora/connection-scopes");
          const scopes = [...new Set(input.scope.split(/\s+/))];
          if (!scopes.length || scopes.some((s) => !(s in CONNECTION_SCOPES)))
            return reply({ error: "invalid_scope" }, 400);
          const result = await (
            await import("@/lib/nexora/connections.server")
          ).startAgentConnection(
            input.client_name,
            scopes as Array<keyof typeof CONNECTION_SCOPES>,
          );
          const verification = new URL("/connect-agent", request.url);
          return reply({
            ...result,
            verification_uri: verification.href,
            verification_uri_complete: `${verification.href}?code=${result.user_code}`,
            token_endpoint: new URL("/api/agent/token", request.url).href,
          });
        } catch {
          return reply(
            {
              error: "invalid_request",
              error_description:
                "Connection could not be started. Check the request or retry later.",
            },
            400,
          );
        }
      },
    },
  },
});
