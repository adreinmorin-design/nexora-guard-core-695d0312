import { readFileSync } from "node:fs";
import { NODE_VERSION, validatePortableConfig, validateBuildSha } from "./portable-config.mjs";

try {
  if (process.versions.node !== NODE_VERSION) throw new Error(`Node ${NODE_VERSION} is required`);
  const config = validatePortableConfig(process.env, { runtime: true });
  const build = JSON.parse(
    readFileSync(new URL("../.output/nexora-build.json", import.meta.url), "utf8"),
  );
  validateBuildSha(build.sha);
  if (
    build.supabaseUrl !== config.supabaseUrl ||
    build.publishableKeyHash !== config.publishableKeyHash
  )
    throw new Error(
      "Runtime public Supabase configuration differs from the built client; rebuild required",
    );
  if (process.env.NEXORA_BUILD_SHA && process.env.NEXORA_BUILD_SHA !== build.sha)
    throw new Error("Runtime SHA differs from the build SHA");
  process.env.NEXORA_BUILD_SHA = build.sha;
  process.env.NODE_ENV = "production";
  process.env.HOST ??= "0.0.0.0";
  console.info(
    JSON.stringify({ event: "nexora_start", sha: build.sha, node: process.versions.node }),
  );
  await import("../.output/server/index.mjs");
} catch (error) {
  // Validation errors contain names, never values. Import errors may contain secrets.
  const known =
    error instanceof Error &&
    /^(Invalid or missing configuration:|Node |Runtime |A full NEXORA_BUILD_SHA)/.test(
      error.message,
    );
  console.error(
    JSON.stringify({
      event: "nexora_start_failed",
      reason: known ? error.message : "Server artifact could not start",
    }),
  );
  process.exitCode = 1;
}
