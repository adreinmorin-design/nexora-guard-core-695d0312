import test from "node:test";
import assert from "node:assert/strict";
import { buildFailureEvidence, authorizeFailureSummary, isFailedRequest } from "../src/lib/nexora/failure-evidence.ts";

test("summaries exclude unclassified reasons, previews and arbitrary trace content", () => {
  const evidence = buildFailureEvidence({ status: "provider_error", decision: "LOG", reason: "secret-user-input", prompt_preview: "secret-prompt", response_preview: "secret-response" }, [{ stage: "execution", status: "failed", summary: "secret-summary", detail: { providerFailureReason: "secret-error", password: "secret-password" } }]);
  assert.equal(JSON.stringify(evidence).includes("secret-"), false);
  assert.ok(evidence.includes("No allowlisted failure reason recorded; details withheld."));
});
test("classified provider failures and versioned decisions ground summaries", () => {
  const evidence = buildFailureEvidence({ status: "provider_error", decision: "REDACT", policy_version: 7, reason: "secret-policy-name · provider request failed: Provider rejected the server credential.", matched_rules: [{ action: "REDACT", policyVersion: 7, policyName: "secret-name" }] }, [{ stage: "execution", status: "failed", detail: { providerStatus: 502, providerFailureReason: "Provider rejected the server credential." } }]);
  assert.ok(evidence.includes("Recorded sanitized reason: Provider rejected the server credential."));
  assert.ok(evidence.includes("Recorded policy version: 7"));
  assert.equal(JSON.stringify(evidence).includes("secret-"), false);
});
test("missing request-linked traces do not imply no downstream call", () => {
  assert.ok(buildFailureEvidence({ status: "blocked", decision: "BLOCK", reason: "An active subscription is required." }).includes("No request-linked execution trace recorded; downstream invocation cannot be established."));
});
test("cross-tenant administrators cannot invoke summary AI", async () => {
  let calls = 0;
  await assert.rejects(authorizeFailureSummary({ org_id: "tenant-a", status: "blocked" }, [{ org_id: "tenant-b", role: "org_admin" }], async () => { calls++; }), /administrator/);
  assert.equal(calls, 0);
});
test("non-administrators cannot invoke summary AI", async () => {
  let calls = 0;
  await assert.rejects(authorizeFailureSummary({ org_id: "a", status: "blocked" }, [{ org_id: "a", role: "member" }], async () => { calls++; }), /administrator/);
  assert.equal(calls, 0);
});
test("completed requests cannot invoke failure summary AI", async () => {
  let calls = 0;
  await assert.rejects(authorizeFailureSummary({ org_id: "a", status: "completed" }, [{ org_id: "a", role: "org_admin" }], async () => { calls++; }), /Only failed/);
  assert.equal(calls, 0);
  assert.equal(isFailedRequest("pending_approval"), false);
});
test("tenant administrator can summarize a recorded failed request", async () => {
  let calls = 0;
  const result = await authorizeFailureSummary({ org_id: "a", status: "provider_error" }, [{ org_id: "a", role: "org_admin" }], async () => { calls++; return "summarized"; });
  assert.equal(calls, 1);
  assert.equal(result, "summarized");
});