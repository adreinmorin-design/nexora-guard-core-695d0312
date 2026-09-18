const BASE_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Permissions-Policy":
    'camera=(), microphone=(), geolocation=(), payment=(self "https://*.paddle.com")',
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function applySecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASE_HEADERS)) headers.set(name, value);
  if (new URL(request.url).protocol === "https:")
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (new URL(request.url).pathname.startsWith("/api/")) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
