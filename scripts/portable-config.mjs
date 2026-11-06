import { createHash } from "node:crypto";

export const NODE_VERSION = "24.19.0";
const publicNames = new Set(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);

function keyRole(key) {
  if (key.startsWith("sb_publishable_")) return "anon";
  if (key.startsWith("sb_secret_")) return "service_role";
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role;
  } catch {
    return undefined;
  }
}

export function validatePortableConfig(env, { runtime = false } = {}) {
  const issues = [];
  const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];
  if (runtime) required.push("SUPABASE_SERVICE_ROLE_KEY");
  for (const name of required) if (!env[name]?.trim()) issues.push(name);
  for (const name of Object.keys(env)) {
    if (name.startsWith("VITE_") && !publicNames.has(name)) issues.push(name);
  }
  try {
    const url = new URL(env.SUPABASE_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      issues.push("SUPABASE_URL");
  } catch {
    issues.push("SUPABASE_URL");
  }
  if (keyRole(env.SUPABASE_PUBLISHABLE_KEY ?? "") !== "anon")
    issues.push("SUPABASE_PUBLISHABLE_KEY");
  if (runtime && keyRole(env.SUPABASE_SERVICE_ROLE_KEY ?? "") !== "service_role")
    issues.push("SUPABASE_SERVICE_ROLE_KEY");
  for (const name of publicNames) {
    const serverName = name.slice(5);
    if (env[name] && env[name] !== env[serverName]) issues.push(name);
  }
  if (issues.length)
    throw new Error(`Invalid or missing configuration: ${[...new Set(issues)].join(", ")}`);
  return {
    supabaseUrl: env.SUPABASE_URL,
    publishableKeyHash: createHash("sha256").update(env.SUPABASE_PUBLISHABLE_KEY).digest("hex"),
  };
}

export function validateBuildSha(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("A full NEXORA_BUILD_SHA is required");
  return sha;
}
