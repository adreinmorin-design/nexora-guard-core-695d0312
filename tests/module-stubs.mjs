// Shared module stubs for tests that must replace the Supabase service client
// (and, for auth tests, @supabase/supabase-js createClient) without touching
// production code. Works under Node's test runner (module.registerHooks) and
// under `bun test` (bun:test mock.module), so the same files run in both CI jobs.
//
// Tests install a fake by assigning globalThis.__nexoraTestSupabaseAdmin (and
// optionally globalThis.__nexoraTestCreateClient); the stubs read them per call.
import * as nodeModule from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function adminProxy() {
  return new Proxy(
    {},
    {
      get(_, prop) {
        const db = globalThis.__nexoraTestSupabaseAdmin;
        if (!db) throw new Error("Test Supabase admin fake is not installed");
        return db[prop];
      },
    },
  );
}

const ADMIN_SOURCE = `export const supabaseAdmin = new Proxy({}, { get(_, prop) {
  const db = globalThis.__nexoraTestSupabaseAdmin;
  if (!db) throw new Error("Test Supabase admin fake is not installed");
  return db[prop];
} });`;
const CREATE_CLIENT_SOURCE =
  "export const createClient = (...args) => globalThis.__nexoraTestCreateClient(...args);";
const dataUrl = (source) => "data:text/javascript," + encodeURIComponent(source);

export async function installModuleStubs({ authCreateClient = false } = {}) {
  if (typeof nodeModule.registerHooks === "function") {
    nodeModule.registerHooks({
      resolve(specifier, context, next) {
        if (specifier === "@/integrations/supabase/client.server")
          return { url: dataUrl(ADMIN_SOURCE), shortCircuit: true };
        if (
          authCreateClient &&
          specifier === "@supabase/supabase-js" &&
          context.parentURL?.endsWith("/integrations/supabase/auth-middleware.ts")
        )
          return { url: dataUrl(CREATE_CLIENT_SOURCE), shortCircuit: true };
        if (specifier.startsWith("@/")) {
          const base = SRC + specifier.slice(2);
          for (const candidate of [base, base + ".ts", base + ".tsx"])
            if (existsSync(candidate) && !candidate.endsWith("/"))
              return next(pathToFileURL(candidate).href, context);
        }
        try {
          return next(specifier, context);
        } catch (error) {
          // tests/resolve-ts.mjs treats "./x.server" as already having an extension.
          if (specifier.startsWith(".") && !specifier.endsWith(".ts"))
            return next(specifier + ".ts", context);
          throw error;
        }
      },
    });
    return;
  }
  if (globalThis.Bun) {
    // Bun resolves "@/" (tsconfig paths) and ".ts" natively; only the stubs are needed.
    const { mock } = await import("bun:test");
    const supabaseAdmin = adminProxy();
    mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
    if (authCreateClient) {
      // Bun module mocks are process-wide, so delegate to the real createClient
      // unless a test has installed its fake.
      const real = await import("@supabase/supabase-js");
      const realCreateClient = real.createClient;
      mock.module("@supabase/supabase-js", () => ({
        ...real,
        createClient: (...args) =>
          (globalThis.__nexoraTestCreateClient ?? realCreateClient)(...args),
      }));
    }
    return;
  }
  throw new Error("No supported module-stub mechanism (need Node registerHooks or Bun)");
}
