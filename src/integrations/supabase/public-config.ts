export type PublicSupabaseEnv = Record<string, string | undefined>;

export type PublicSupabaseConfig = {
  url: string | undefined;
  publishableKey: string | undefined;
  missing: string[];
};

// There is intentionally no hard-coded fallback project. A build or runtime
// without explicit public Supabase configuration must fail instead of silently
// pointing the browser at a different (legacy) database.
export function resolvePublicSupabaseConfig(
  viteEnv: PublicSupabaseEnv | undefined,
  serverEnv: PublicSupabaseEnv | undefined,
): PublicSupabaseConfig {
  const url = viteEnv?.["VITE_SUPABASE_URL"] || serverEnv?.["SUPABASE_URL"] || undefined;
  const publishableKey =
    viteEnv?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    serverEnv?.["SUPABASE_PUBLISHABLE_KEY"] ||
    undefined;

  return {
    url,
    publishableKey,
    missing: [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ],
  };
}

/**
 * Build-time gate used by vite.config.ts. Resolves the public (browser-safe)
 * Supabase URL and publishable key from VITE_* or SUPABASE_* variables and
 * throws when either is missing or the URL is not an http(s) URL.
 * Never pass server secrets through this function.
 */
export function requirePublicSupabaseBuildConfig(env: PublicSupabaseEnv): {
  url: string;
  publishableKey: string;
} {
  const config = resolvePublicSupabaseConfig(env, env);
  if (!config.url || !config.publishableKey) {
    const names = config.missing.map((name) => `VITE_${name} (or ${name})`).join(", ");
    throw new Error(
      `[nexora] Missing public Supabase build configuration: ${names}. ` +
        "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the build environment. " +
        "Refusing to build a bundle without an explicit Supabase project.",
    );
  }

  let protocol: string;
  try {
    protocol = new URL(config.url).protocol;
  } catch {
    throw new Error(`[nexora] VITE_SUPABASE_URL is not a valid URL: ${JSON.stringify(config.url)}`);
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error(`[nexora] VITE_SUPABASE_URL must use http(s): ${JSON.stringify(config.url)}`);
  }

  return { url: config.url, publishableKey: config.publishableKey };
}
