import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PaddleData = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    customer_id: z.string().optional(),
    custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
    items: z
      .array(z.object({ price: z.object({ id: z.string() }).optional() }).passthrough())
      .optional(),
    current_billing_period: z
      .object({ starts_at: z.string().optional(), ends_at: z.string().optional() })
      .nullable()
      .optional(),
    scheduled_change: z.object({ action: z.string().optional() }).nullable().optional(),
  })
  .passthrough();

const PaddleEvent = z
  .object({ event_type: z.string(), data: PaddleData })
  .passthrough();

function subscriptionStatus(eventType: string, upstream: string | undefined) {
  if (eventType.includes("canceled")) return "canceled" as const;
  if (eventType.includes("past_due")) return "past_due" as const;
  if (upstream === "trialing") return "trialing" as const;
  if (upstream === "active") return "active" as const;
  if (upstream === "past_due") return "past_due" as const;
  if (upstream === "canceled" || upstream === "paused") return "canceled" as const;
  return "incomplete" as const;
}

export const Route = createFileRoute("/api/paddle/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 1_000_000) return new Response("Payload too large", { status: 413 });
        const { verifyPaddleWebhook, verifyCheckoutData, planFromPriceId } =
          await import("@/lib/paddle.server");
        if (!verifyPaddleWebhook(raw, request.headers.get("paddle-signature")))
          return new Response("Invalid signature", { status: 401 });

        let event;
        try {
          event = PaddleEvent.parse(JSON.parse(raw));
        } catch {
          return new Response("Invalid event", { status: 400 });
        }
        if (!event.event_type.startsWith("subscription."))
          return Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } });

        const data = event.data;
        const custom = data.custom_data;
        const signed = custom as
          | { org_id?: string; plan_key?: "solo" | "team"; interval?: "monthly" | "annual"; user_id?: string; signature?: string }
          | null
          | undefined;
        const hasSignedIdentity =
          !!signed?.org_id && !!signed?.plan_key && !!signed?.interval && !!signed?.user_id && !!signed?.signature;
        if (hasSignedIdentity && !verifyCheckoutData(signed as any))
          return new Response("Invalid checkout metadata", { status: 400 });

        const priceId = data.items?.[0]?.price?.id;
        const planKey = signed?.plan_key ?? planFromPriceId(priceId);
        const subscriptionId = data.id;
        if (!planKey || !subscriptionId)
          return new Response("Missing subscription identity", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const update = {
          plan_key: planKey,
          status: subscriptionStatus(event.event_type, data.status),
          provider_customer_id: data.customer_id ?? null,
          provider_subscription_id: subscriptionId,
          current_period_start: data.current_billing_period?.starts_at ?? null,
          current_period_end: data.current_billing_period?.ends_at ?? null,
          cancel_at_period_end: data.scheduled_change?.action === "cancel",
          updated_at: new Date().toISOString(),
        };
        const db: any = supabaseAdmin;
        const existing = await db
          .from("billing_subscriptions")
          .update(update)
          .eq("provider_subscription_id", subscriptionId)
          .select("org_id")
          .maybeSingle();
        if (existing.error) return new Response("Billing persistence unavailable", { status: 503 });
        if (!existing.data && signed?.org_id) {
          const inserted = await db
            .from("billing_subscriptions")
            .upsert({ org_id: signed.org_id, ...update }, { onConflict: "org_id" });
          if (inserted.error) return new Response("Billing persistence unavailable", { status: 503 });
        }
        return Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});

