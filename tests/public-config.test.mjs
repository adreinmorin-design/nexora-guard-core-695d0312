import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requirePublicSupabaseBuildConfig,
  resolvePublicSupabaseConfig,
} from "../src/integrations/supabase/public-config.ts";

const URL_VALUE = "https://example-project.supabase.co";
const KEY_VALUE = "sb_publishable_example_not_a_secret";

test("build config throws when both public Supabase values are missing", () => {
  assert.throws(
    () => requirePublicSupabaseBuildConfig({}),
    /Missing public Supabase build configuration: VITE_SUPABASE_URL \(or SUPABASE_URL\), VITE_SUPABASE_PUBLISHABLE_KEY/,
  );
});

test("build config throws when only the URL is missing", () => {
  assert.throws(
    () => requirePublicSupabaseBuildConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE }),
    (error) =>
      error instanceof Error &&
      error.message.includes("VITE_SUPABASE_URL") &&
      !error.message.includes("VITE_SUPABASE_PUBLISHABLE_KEY (or"),
  );
});

test("build config throws when only the publishable key is missing", () => {
  assert.throws(
    () => requirePublicSupabaseBuildConfig({ VITE_SUPABASE_URL: URL_VALUE }),
    /VITE_SUPABASE_PUBLISHABLE_KEY \(or SUPABASE_PUBLISHABLE_KEY\)/,
  );
});

test("build config treats empty strings as missing", () => {
  assert.throws(
    () =>
      requirePublicSupabaseBuildConfig({
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_PUBLISHABLE_KEY: "",
      }),
    /Missing public Supabase build configuration/,
  );
});

test("build config rejects a non-http(s) URL", () => {
  assert.throws(
    () =>
      requirePublicSupabaseBuildConfig({
        VITE_SUPABASE_URL: "not a url",
        VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE,
      }),
    /not a valid URL/,
  );
  assert.throws(
    () =>
      requirePublicSupabaseBuildConfig({
        VITE_SUPABASE_URL: "javascript:alert(1)",
        VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE,
      }),
    /must use http\(s\)/,
  );
});

test("build config uses present VITE_ values", () => {
  assert.deepEqual(
    requirePublicSupabaseBuildConfig({
      VITE_SUPABASE_URL: URL_VALUE,
      VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE,
      SUPABASE_URL: "https://other.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_other",
    }),
    { url: URL_VALUE, publishableKey: KEY_VALUE },
  );
});

test("build config accepts unprefixed SUPABASE_ values", () => {
  assert.deepEqual(
    requirePublicSupabaseBuildConfig({
      SUPABASE_URL: URL_VALUE,
      SUPABASE_PUBLISHABLE_KEY: KEY_VALUE,
    }),
    { url: URL_VALUE, publishableKey: KEY_VALUE },
  );
});

test("runtime resolution reports missing values instead of a fallback project", () => {
  const config = resolvePublicSupabaseConfig(undefined, undefined);
  assert.equal(config.url, undefined);
  assert.equal(config.publishableKey, undefined);
  assert.deepEqual(config.missing, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
});

test("source contains no hard-coded Supabase project fallback", () => {
  const source = readFileSync(
    new URL("../src/integrations/supabase/public-config.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /lovable\.cloud/);
  assert.doesNotMatch(source, /sb_publishable_[A-Za-z0-9_-]{10,}/);
});

test("vite config gates production builds on the public Supabase config", () => {
  const source = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(source, /requirePublicSupabaseBuildConfig\(env\)/);
  assert.match(source, /command === "build" && mode !== "development"/);
  assert.doesNotMatch(source, /SERVICE_ROLE_KEY"\]/);
});

test("wrangler.jsonc pins the worker name and compatibility date", () => {
  const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const json = JSON.parse(
    raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
  assert.equal(json.name, "nexora-guard");
  assert.match(json.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
});

test("strict mode is opt-in and only enabled by NEXORA_STRICT_PUBLIC_CONFIG=1", async () => {
  const { isStrictPublicConfig } =
    await import("../src/integrations/supabase/legacy-build-fallback.ts");
  assert.equal(isStrictPublicConfig({}), false);
  assert.equal(isStrictPublicConfig({ NEXORA_STRICT_PUBLIC_CONFIG: "0" }), false);
  assert.equal(isStrictPublicConfig({ NEXORA_STRICT_PUBLIC_CONFIG: "1" }), true);
});

test("legacy fallback is build-time only and the deploy workflow is strict", () => {
  const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(vite, /!isStrictPublicConfig\(env\)/);
  const deploy = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(deploy, /NEXORA_STRICT_PUBLIC_CONFIG: "1"/);
  for (const file of ["client.ts", "public-config.ts"]) {
    const source = readFileSync(
      new URL(`../src/integrations/supabase/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /legacy-build-fallback/);
  }
});
