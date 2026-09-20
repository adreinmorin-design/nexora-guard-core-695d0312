import test from "node:test";
import assert from "node:assert/strict";
import { PLANS, planByKey } from "../src/lib/nexora/plans.ts";
import { planAllowsEntitlement } from "../src/lib/nexora/entitlements.ts";

test("commercial plans have increasing paid value and safe limits", () => {
  const [solo, team, enterprise] = PLANS;
  assert.equal(solo.key, "solo");
  assert.equal(team.key, "team");
  assert.equal(enterprise.key, "enterprise");
  assert.ok(solo.monthlyPriceUsd > 0);
  assert.ok(team.monthlyPriceUsd > solo.monthlyPriceUsd);
  assert.ok(enterprise.monthlyPriceUsd > team.monthlyPriceUsd);
  assert.ok(team.seats > solo.seats);
  assert.ok(team.agents > solo.agents);
  assert.ok(team.monthlyRequests > solo.monthlyRequests);
  assert.equal(planByKey("unknown").key, "team");
});

test("premium entitlements are denied to Solo and enabled for Team and Enterprise", () => {
  const premium = [
    "human_approvals",
    "mcp_controls",
    "security_tests",
    "attack_simulation",
    "device_ai_discovery",
  ];
  for (const entitlement of premium) {
    assert.equal(planAllowsEntitlement("solo", entitlement), false);
    assert.equal(planAllowsEntitlement("team", entitlement), true);
    assert.equal(planAllowsEntitlement("enterprise", entitlement), true);
  }
});
