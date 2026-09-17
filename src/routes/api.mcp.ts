import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
          return new Response("Origin denied", { status: 403 });
        return (await import("@/lib/nexora/native-mcp.server")).nativeMcp(request);
      },
      GET: () => new Response(null, { status: 405, headers: { Allow: "POST" } }),
      DELETE: () => new Response(null, { status: 405, headers: { Allow: "POST" } }),
    },
  },
});
