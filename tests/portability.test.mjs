import test from "node:test";
import assert from "node:assert/strict";
import { validatePortableConfig, validateBuildSha } from "../scripts/portable-config.mjs";
import {
  installPortableErrorLogging,
  requestLogContext,
} from "../src/lib/portable-logging.server.ts";

const publicEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
};

test("independent build requires explicit public backend config", () => {
  assert.throws(() => validatePortableConfig({}), /SUPABASE_URL/);
  assert.throws(
    () => validatePortableConfig({ ...publicEnv, SUPABASE_URL: "http://example.supabase.co" }),
    /SUPABASE_URL/,
  );
  assert.doesNotThrow(() => validatePortableConfig(publicEnv));
});
test("runtime requires privileged backend credential; public key cannot substitute", () => {
  assert.throws(
    () => validatePortableConfig(publicEnv, { runtime: true }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
  assert.throws(
    () =>
      validatePortableConfig(
        { ...publicEnv, SUPABASE_SERVICE_ROLE_KEY: publicEnv.SUPABASE_PUBLISHABLE_KEY },
        { runtime: true },
      ),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});
test("privileged credentials cannot enter public configuration or Vite exposure", () => {
  const secret = "sb_secret_do_not_echo";
  for (const env of [
    { ...publicEnv, SUPABASE_PUBLISHABLE_KEY: secret },
    { ...publicEnv, VITE_OPENAI_API_KEY: secret },
    { ...publicEnv, VITE_SUPABASE_SERVICE_ROLE_KEY: secret },
    { ...publicEnv, VITE_SUPABASE_URL: "https://different.supabase.co" },
  ]) {
    assert.throws(
      () => validatePortableConfig(env),
      (error) =>
        error.message.startsWith("Invalid or missing configuration:") &&
        !error.message.includes(secret),
    );
  }
});
test("served revision must be a full Git SHA", () => {
  assert.throws(() => validateBuildSha("main"));
  assert.throws(() => validateBuildSha("abcdef0"));
  assert.equal(validateBuildSha("a".repeat(40)), "a".repeat(40));
});

test("production errors emit correlation metadata without arbitrary error content", () => {
  const original = console.error;
  const output = [];
  try {
    console.error = (value) => output.push(value);
    installPortableErrorLogging();
    requestLogContext.run({ correlationId: "fixture-correlation", sha: "a".repeat(40) }, () =>
      console.error(new Error("sb_secret_must_never_appear"), { token: "raw-request-token" }),
    );
    assert.deepEqual(JSON.parse(output[0]), {
      event: "nexora_server_error",
      correlationId: "fixture-correlation",
      sha: "a".repeat(40),
    });
    assert.ok(!output.join("").includes("sb_secret_must_never_appear"));
    assert.ok(!output.join("").includes("raw-request-token"));
  } finally {
    console.error = original;
  }
});
