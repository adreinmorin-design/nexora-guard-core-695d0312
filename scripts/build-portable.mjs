import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { validatePortableConfig, validateBuildSha } from "./portable-config.mjs";

const config = validatePortableConfig(process.env);
// CI checks out the exact source revision; container builders supply it explicitly.
const sha = validateBuildSha(
  process.env.NEXORA_BUILD_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
);
const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--config", "vite.portable.config.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, NEXORA_BUILD_SHA: sha },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(".output/nexora-build.json", JSON.stringify({ sha, ...config }, null, 2) + "\n");
