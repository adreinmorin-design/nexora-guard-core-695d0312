import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
export const Route = createFileRoute("/api/agent/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const reply = (value: unknown, status = 200) =>
          Response.json(value, {
            status,
            headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
          });
        try {
          const input = z
            .object({
              device_code: z.string().regex(/^nxr_[a-f0-9]{64}$/),
              grant_type: z.literal("urn:ietf:params:oauth:grant-type:device_code"),
            })
            .strict()
            .parse(await (await import("@/lib/nexora/agent-input")).readLimitedJson(request));
          const result = await (
            await import("@/lib/nexora/connections.server")
          ).exchangeAgentConnection(input.device_code);
          return reply(result, result.error ? 400 : 200);
        } catch {
          return reply({ error: "invalid_request" }, 400);
        }
      },
    },
  },
});
