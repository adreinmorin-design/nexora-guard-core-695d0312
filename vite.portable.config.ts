import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Separate from vite.config.ts so Lovable's existing build stays unchanged.
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server.portable" } }),
    nitro({ preset: "node_server" }),
    react(),
  ],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env["SUPABASE_URL"]),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      process.env["SUPABASE_PUBLISHABLE_KEY"],
    ),
    "import.meta.env.NEXORA_BUILD_SHA": JSON.stringify(process.env["NEXORA_BUILD_SHA"]),
  },
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-router"] },
});
