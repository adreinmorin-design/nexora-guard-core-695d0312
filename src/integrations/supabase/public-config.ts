export type PublicSupabaseEnv = Record<string, string | undefined>;

export type PublicSupabaseConfig = {
  url: string | undefined;
  publishableKey: string | undefined;
  missing: string[];
};

// These values are intentionally public/browser-safe Supabase identifiers.
// They are safe to ship in the client bundle and provide a deploy-time fallback
// when Lovable/Vite environment injection is unavailable.
const DEFAULT_SUPABASE_URL = "https://c--f46c7dc2-f8c6-4710-96bb-07ffc11e5270-prod.lovable.cloud";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_eWI2U31KL-zYV8Mn_AzGlw_40-gaGMC";

export function resolvePublicSupabaseConfig(
  viteEnv: PublicSupabaseEnv | undefined,
  serverEnv: PublicSupabaseEnv | undefined,
): PublicSupabaseConfig {
  const url = viteEnv?.["VITE_SUPABASE_URL"] || serverEnv?.["SUPABASE_URL"] || DEFAULT_SUPABASE_URL;
  const publishableKey =
    viteEnv?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    serverEnv?.["SUPABASE_PUBLISHABLE_KEY"] ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  return {
    url,
    publishableKey,
    missing: [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ],
  };
}
