import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PaddleData = z
  .object({
    id: z.string().min(1),
    status: z.string().optional(),
    customer_id: z.string().optional(),
    custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
    items: z
      .array(z.object({ price: z.object({ id: z.string() }).optional() }).passthrough())
      .optional(),
    current_billing_period: z
      .object({
        starts_at: z.string().datetime().optional(),
        ends_at: z.string().datetime().optional(),
      })
      .nullable()
      .optional(),
    scheduled_change: z.object({ action: z.string().optional() }).nullable().optional(),
  })
  .passthrough();

const PaddleEvent = z
  .object({
    event_id: z.string().min(1).max(200),
    event_type: z.string().min(1).max(100),
    occurred_at: z.string().datetime(),
    data: PaddleData,
  })
  .passthrough();

const ACCEPTED_SUBSCRIPTION_EVENTS = new Set([
  "subscription.created",
  "subscription.activated",
  "subscription.updated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.trialing",
]);

function subscriptionStatus(eventType: string, upstream: string | undefined) {
  if (eventType === "subscription.canceled" || eventType === "subscription.paused")
    return "canceled" as const;
  if (eventType === "subscription.past_due") return "past_due" as const;
  if (upstream === "trialing") return "trialing" as const;
  if (upstream === "active") return "active" as const;
  if (upstream === "past_due") return "past_due" as const;
  if (upstream === "canceled" || upstream === "paused") return "canceled" as const;
  return "incomplete" as const;
}

async function readLimitedText(request: Request, limit: number): Promise<string> {
  if (!request.body) throw new Error("Request body required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      size += value?.byteLength ?? 0;
      if (size > limit) throw new RangeError("Payload too large.");
      result += decoder.decode(value, { stream: !done });
      if (done) return result;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export const Route = createFileRoute("/api/paddle/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!request.headers.get("content-type")?.startsWith("application/json"))
          return new Response("JSON body required", { status: 415 });
        let raw: string;
        try {
          raw = await readLimitedText(request, 1_000_000);
        } catch (error) {
          return new Response(
            error instanceof RangeError ? "Payload too large" : "Invalid payload",
            {
              status: error instanceof RangeError ? 413 : 400,
            },
          );
        }
        const { verifyPaddleWebhook, resolvePaddleWebhookIdentity } =
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
        if (!ACCEPTED_SUBSCRIPTION_EVENTS.has(event.event_type))
          return Response.json(
            { received: true, ignored: "unsupported_event" },
            { headers: { "Cache-Control": "no-store" } },
          );

        const data = event.data;
        const identity = resolvePaddleWebhookIdentity(
          data.items?.[0]?.price?.id,
          data.custom_data as any,
        );
        if (!identity) return new Response("Invalid checkout metadata", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: result, error } = await (supabaseAdmin as any).rpc(
          "nexora_apply_paddle_event",
          {
            p_event_id: event.event_id,
            p_occurred_at: event.occurred_at,
            p_event_type: event.event_type,
            p_org: identity.orgId,
            p_signed_identity: identity.signedIdentity,
            p_plan_key: identity.planKey ?? null,
            p_status: subscriptionStatus(event.event_type, data.status),
            p_customer: data.customer_id ?? null,
            p_subscription: data.id,
            p_period_start: data.current_billing_period?.starts_at ?? null,
            p_period_end: data.current_billing_period?.ends_at ?? null,
            p_cancel_at_period_end: data.scheduled_change?.action === "cancel",
          },
        );
        if (error)
          return new Response("Billing persistence unavailable", {
            status: 503,
          });
        return Response.json(
          { received: true, result: result?.result ?? "processed" },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
