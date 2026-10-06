import { randomUUID } from "node:crypto";
import { applySecurityHeaders } from "./lib/security-headers";
import { installPortableErrorLogging, requestLogContext } from "./lib/portable-logging.server";

installPortableErrorLogging();

const buildSha = import.meta.env["NEXORA_BUILD_SHA"] as string;
let entryPromise: Promise<typeof import("./server")> | undefined;

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const correlationId = randomUUID();
    const started = Date.now();
    const url = new URL(request.url);
    return requestLogContext.run({ correlationId, sha: buildSha }, async () => {
      let response: Response;
      try {
        if (request.method === "GET" && url.pathname === "/api/live") {
          // Process liveness only. /api/health retains its existing database-readiness check.
          response = Response.json({ status: "ok", sha: buildSha, runtime: "node" });
        } else {
          entryPromise ??= import("./server");
          response = await (await entryPromise).default.fetch(request, env, ctx);
        }
      } catch {
        console.error();
        response = Response.json({ error: "Server request failed" }, { status: 500 });
      }
      const headers = new Headers(response.headers);
      headers.set("X-Nexora-Commit", buildSha);
      headers.set("X-Nexora-Correlation-Id", correlationId);
      if (url.pathname === "/api/live" || url.pathname === "/api/health")
        headers.set("Cache-Control", "no-store");
      // Log bounded metadata only. Exclude URL/query, tokens, body, identity and tenant.
      console.info(
        JSON.stringify({
          event: "nexora_http",
          correlationId,
          sha: buildSha,
          method: request.method,
          status: response.status,
          durationMs: Date.now() - started,
        }),
      );
      return applySecurityHeaders(
        request,
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
      );
    });
  },
};
