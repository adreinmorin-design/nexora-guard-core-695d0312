import type { SlackAlert } from "./monitoring.server";

// Deployment-controlled: never accept a mailbox id or recipient from a request.
export async function notifyEmailAlert(alert: SlackAlert): Promise<void> {
  const id = process.env["NEXORA_ALERT_MAILBOX_ID"];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || alert.severity !== "critical") return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db: any = supabaseAdmin;
    const { data: mailbox, error } = await db
      .from("email_mailboxes")
      .select("org_id,user_id")
      .eq("id", id)
      .single();
    if (error || !mailbox) return;
    const requestId = crypto.randomUUID();
    const reservation = await db.rpc("nexora_mailbox", {
      p_action: "reserve",
      p_org: mailbox.org_id,
      p_actor: mailbox.user_id,
      p_request: requestId,
    });
    if (reservation.error) return;
    const { sendMailboxEmail } = await import("./nexora/mail-transport.server");
    // Fixed template excludes request text, URLs, identifiers, and provider error messages.
    let status = "unknown";
    try {
      await sendMailboxEmail(reservation.data, {
        to: reservation.data.email,
        subject: "Nexora: operational alert",
        text: "Nexora detected a critical service event. Sign in to your Nexora console to review monitoring and audit records. This email contains no customer data or credentials.",
        requestId,
      });
      status = "accepted";
    } finally {
      await db.from("email_deliveries").update({ status }).eq("id", requestId).eq("mailbox_id", id);
    }
  } catch {
    /* Email must never break the operation being monitored. */
  }
}
