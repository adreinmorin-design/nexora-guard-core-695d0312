import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicSupabaseConfig } from "../src/integrations/supabase/public-config.ts";

test("public Supabase config prefers Vite browser values", () => {
  const config = resolvePublicSupabaseConfig(
    {
      VITE_SUPABASE_URL: "https://browser.example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_browser",
    },
    {
      SUPABASE_URL: "https://server.example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_server",
    },
  );

  assert.equal(config.url, "https://browser.example.supabase.co");
  assert.equal(config.publishableKey, "sb_publishable_browser");
  assert.deepEqual(config.missing, []);
});

test("public Supabase config safely falls back to server values", () => {
  const config = resolvePublicSupabaseConfig(undefined, {
    SUPABASE_URL: "https://server.example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_server",
  });

  assert.equal(config.url, "https://server.example.supabase.co");
  assert.equal(config.publishableKey, "sb_publishable_server");
  assert.deepEqual(config.missing, []);
});

test("public Supabase config falls back to browser-safe deployment defaults", () => {
  const config = resolvePublicSupabaseConfig({}, {});

  assert.equal(config.url, "https://c--f46c7dc2-f8c6-4710-96bb-07ffc11e5270-prod.lovable.cloud");
  assert.equal(config.publishableKey, "sb_publishable_eWI2U31KL-zYV8Mn_AzGlw_40-gaGMC");
  assert.deepEqual(config.missing, []);
});
