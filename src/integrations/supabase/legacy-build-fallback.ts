// Build-time only. Imported by vite.config.ts, never by application code.
//
// Lovable's hosted builds have historically relied on these public,
// browser-safe identifiers of the legacy Lovable Cloud project when no
// VITE_SUPABASE_* values were injected. Non-strict builds keep that behavior
// (with a loud warning) so the Lovable-connected app keeps publishing until
// cutover. Strict builds (NEXORA_STRICT_PUBLIC_CONFIG=1, set by the Cloudflare
// deploy workflow) never use it and fail instead.
export const LEGACY_LOVABLE_PUBLIC_SUPABASE = {
  url: "https://c--f46c7dc2-f8c6-4710-96bb-07ffc11e5270-prod.lovable.cloud",
  publishableKey: "sb_publishable_eWI2U31KL-zYV8Mn_AzGlw_40-gaGMC",
} as const;

export function isStrictPublicConfig(env: Record<string, string | undefined>): boolean {
  return env["NEXORA_STRICT_PUBLIC_CONFIG"] === "1";
}
