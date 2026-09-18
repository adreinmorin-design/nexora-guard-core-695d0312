export type PublicSupabaseEnv = Record<string, string | undefined>;

export type PublicSupabaseConfig = {
  url: string | undefined;
  publishableKey: string | undefined;
  missing: string[];
};

export function resolvePublicSupabaseConfig(
  viteEnv: PublicSupabaseEnv | undefined,
  serverEnv: PublicSupabaseEnv | undefined,
): PublicSupabaseConfig {
  const url = viteEnv?.["VITE_SUPABASE_URL"] || serverEnv?.["SUPABASE_URL"];
  const publishableKey =
    viteEnv?.["VITE_SUPABASE_PUBLISHABLE_KEY"] || serverEnv?.["SUPABASE_PUBLISHABLE_KEY"];

  return {
    url,
    publishableKey,
    missing: [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ],
  };
}
