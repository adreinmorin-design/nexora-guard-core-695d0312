import test from "node:test";
import assert from "node:assert/strict";
import { runSecuritySuite } from "../src/lib/nexora/security-suite.ts";
import { SEED_POLICIES } from "../src/lib/nexora/catalog.ts";
import { inspect, redact } from "../src/lib/nexora/dlp.ts";

const policies = SEED_POLICIES.map((p, i) => ({
  ...p,
  id: String(i),
  version: 1,
  status: "active",
}));
test("security suite passes baseline protections in both stages", () => {
  const results = runSecuritySuite(policies);
  assert.equal(results.length, 14);
  assert.ok(
    results.every((r) => r.passed),
    JSON.stringify(results.filter((r) => !r.passed)),
  );
});
test("suite fails closed without policies and rejects malformed policies", () => {
  assert.ok(
    runSecuritySuite([]).every(
      (r) =>
        r.passed &&
        r.actual === "BLOCK" &&
        r.reason ===
          "No active policy authorized this request; explicit policy coverage is required.",
    ),
  );
  assert.ok(
    runSecuritySuite([{ ...policies[0], action: "INVALID" }]).every(
      (r) => !r.passed && r.actual === "ERROR",
    ),
  );
  assert.equal(runSecuritySuite(policies, true).length, 6);
});
test("nested and overlapping detections leave no credential fragments", () => {
  const text = "Before password=sk-syntheticCredential01234567890 after";
  assert.equal(redact(text, inspect(text)), "Before [REDACTED:PASSWORD] after");
  const card = "Card 4111 1111 1111 1111 end";
  assert.equal(redact(card, inspect(card)), "Card [REDACTED:CREDIT_CARD]end");
  const pem = "-----BEGIN PRIVATE KEY-----\nsynthetic-key-content\n-----END PRIVATE KEY-----";
  assert.equal(redact(pem, inspect(pem)), "[REDACTED:PRIVATE_KEY]");
  const truncated = "-----BEGIN PRIVATE KEY-----\nsynthetic-key-content";
  assert.equal(redact(truncated, inspect(truncated)), "[REDACTED:PRIVATE_KEY]");
});
