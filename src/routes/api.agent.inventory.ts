import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const observation = z
  .object({
    kind: z.enum([
      "desktop_app",
      "local_runtime",
      "local_model",
      "browser_extension",
      "configured_provider",
    ]),
    name: z.string().trim().min(1).max(100),
    vendor: z.string().trim().max(100).optional(),
    version: z.string().trim().max(80).optional(),
    active: z.boolean().default(true),
  })
  .strict();

const inventoryInput = z
  .object({
    device_id: z.string().min(8).max(128),
    device_label: z.string().trim().max(80).optional(),
    platform: z.enum(["windows", "macos", "linux"]),
    idempotency_key: z.string().uuid(),
    observations: z.array(observation).max(100),
  })
  .strict();

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const Route = createFileRoute("/api/agent/inventory")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const reply = (body: unknown, status = 200) =>
          Response.json(body, {
            status,
            headers: {
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });

        let input: z.infer<typeof inventoryInput>;
        try {
          const { readLimitedJson } = await import("@/lib/nexora/agent-input");
          input = inventoryInput.parse(await readLimitedJson(request));
        } catch {
          return reply({ error: "Invalid or oversized inventory report." }, 400);
        }

        const { authenticateAgent } = await import("@/lib/nexora/agents.server");
        let agent: any;
        try {
          agent = await authenticateAgent(
            request.headers.get("authorization"),
            input.idempotency_key,
          );
        } catch {
          return reply({ error: "Valid enrolled agent credential required." }, 403);
        }

        try {
          const { requireOrgEntitlement } = await import(
            "@/lib/nexora/entitlements.server"
          );
          await requireOrgEntitlement(agent.org_id, "device_ai_discovery");

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db: any = supabaseAdmin;
          const deviceFingerprint = sha256(input.device_id);
          const now = new Date().toISOString();

          const stale = await db
            .from("device_ai_inventory")
            .update({ active: false })
            .eq("org_id", agent.org_id)
            .eq("agent_id", agent.id)
            .eq("device_fingerprint", deviceFingerprint)
            .eq("active", true);
          if (stale.error) throw stale.error;

          const rows = input.observations.map((item) => ({
            org_id: agent.org_id,
            agent_id: agent.id,
            device_fingerprint: deviceFingerprint,
            device_label: input.device_label ?? null,
            platform: input.platform,
            observation_key: sha256(
              [item.kind, item.vendor ?? "", item.name].join("\u0000").toLowerCase(),
            ),
            observation_type: item.kind,
            app_name: item.name,
            vendor: item.vendor ?? null,
            version: item.version ?? null,
            active: item.active,
            last_seen: now,
          }));

          if (rows.length) {
            const saved = await db.from("device_ai_inventory").upsert(rows, {
              onConflict: "org_id,agent_id,device_fingerprint,observation_key",
            });
            if (saved.error) throw saved.error;
          }

          const audit = await db.from("audit_events").insert({
            org_id: agent.org_id,
            actor_type: "agent",
            action: "device.ai_inventory_reported",
            resource: "device_ai_inventory",
            result: "success",
            metadata: {
              agentId: agent.id,
              observationCount: rows.length,
              platform: input.platform,
            },
          });
          if (audit.error) throw audit.error;

          return reply({ accepted: true, observations: rows.length });
        } catch {
          return reply(
            {
              error:
                "Device AI discovery is unavailable for this subscription or the report could not be stored.",
            },
            403,
          );
        }
      },
    },
  },
});
