import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { notifySlackAlert, type AlertCategory } from "./lib/monitoring.server";
import { applySecurityHeaders } from "./lib/security-headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

function monitoringCategory(pathname: string): AlertCategory {
  if (pathname === "/api/paddle/webhook") return "billing";
  if (
    pathname.startsWith("/api/agent") ||
    pathname.startsWith("/api/mcp") ||
    pathname.includes("gateway")
  ) {
    return "provider";
  }
  return "runtime";
}

async function alertServerFailure(request: Request, response: Response) {
  if (response.status < 500) return;
  const pathname = new URL(request.url).pathname;
  const category = monitoringCategory(pathname);
  await notifySlackAlert({
    category,
    severity: response.status >= 500 ? "critical" : "warning",
    summary:
      category === "billing"
        ? "Billing endpoint returned a server error"
        : category === "provider"
          ? "AI gateway or agent endpoint returned a server error"
          : "Application returned a server error",
    route: pathname,
    status: response.status,
  });
}

async function healthResponse(): Promise<Response> {
  try {
    const { supabaseAdmin } = await import("./integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("organizations")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (error) throw error;
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      { status: "degraded" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        const response = await healthResponse();
        await alertServerFailure(request, response);
        return applySecurityHeaders(request, response);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      await alertServerFailure(request, normalized);
      return applySecurityHeaders(request, normalized);
    } catch (error) {
      console.error(error);
      const response = new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      await alertServerFailure(request, response);
      return applySecurityHeaders(request, response);
    }
  },
};
