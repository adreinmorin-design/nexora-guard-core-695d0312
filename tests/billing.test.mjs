import test from "node:test";
import assert from "node:assert/strict";
import { PLANS, planByKey } from "../src/lib/nexora/plans.ts";

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
