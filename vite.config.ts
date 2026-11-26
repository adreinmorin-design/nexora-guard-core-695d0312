// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv, type Plugin } from "vite";
import {
  requirePublicSupabaseBuildConfig,
  resolvePublicSupabaseConfig,
} from "./src/integrations/supabase/public-config.ts";
import {
  LEGACY_LOVABLE_PUBLIC_SUPABASE,
  isStrictPublicConfig,
} from "./src/integrations/supabase/legacy-build-fallback.ts";

// Mirror only the public URL + publishable key into the bundle at build time.
// Never expose SUPABASE_SERVICE_ROLE_KEY here. Production builds fail when
// either value is missing so the browser can never fall back to another project.
function publicSupabaseEnv(): Plugin {
  return {
    name: "nexora-public-supabase-env",
    config(_config, { command, mode }) {
      // .env files (any prefix) first, then real process env wins.
      const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
      const resolved = resolvePublicSupabaseConfig(env, env);
      const legacyFallback =
        command === "build" && resolved.missing.length > 0 && !isStrictPublicConfig(env);
      if (legacyFallback) {
        console.warn(
          "[nexora] WARNING: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set; " +
            "this non-strict build targets the legacy Lovable Cloud project. " +
            "Set NEXORA_STRICT_PUBLIC_CONFIG=1 to fail instead.",
        );
      }
      const { url, publishableKey } = legacyFallback
        ? LEGACY_LOVABLE_PUBLIC_SUPABASE
        : command === "build" && mode !== "development"
          ? requirePublicSupabaseBuildConfig(env)
          : resolved;
      return {
        define: {
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url ?? ""),
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publishableKey ?? ""),
        },
      };
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [publicSupabaseEnv()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
