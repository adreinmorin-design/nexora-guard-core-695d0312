import test from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders } from "../src/lib/security-headers.ts";

test("security headers are enforced and API responses are never cached", () => {
  const request = new Request("https://nexora.example/api/agent");
  const response = applySecurityHeaders(request, Response.json({ ok: true }));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
});

test("HSTS is not emitted over plaintext development requests", () => {
  const response = applySecurityHeaders(
    new Request("http://localhost/api/test"),
    new Response("ok"),
  );
  assert.equal(response.headers.get("strict-transport-security"), null);
});
