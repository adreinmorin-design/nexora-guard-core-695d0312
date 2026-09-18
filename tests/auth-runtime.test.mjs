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

test("public Supabase config reports incomplete deployment configuration", () => {
  const config = resolvePublicSupabaseConfig({}, {});

  assert.equal(config.url, undefined);
  assert.equal(config.publishableKey, undefined);
  assert.deepEqual(config.missing, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
});
