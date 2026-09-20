import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mailboxInput, messageInput, uidInput, requireEmailAdmin } from "./nexora/email-input";

async function identity(context: any) {
  // Revalidate against Auth for sensitive mailbox access, including revoked/deleted users.
  const { data: user, error: authError } = await context.supabase.auth.getUser();
  if (authError || user?.user?.id !== context.userId)
    throw new Error("Sign in again to access email.");
  const { data, error } = await context.supabase
    .from("org_members")
    .select("org_id,role")
    .eq("user_id", context.userId);
  if (error || !data?.length) throw new Error("Workspace unavailable.");
  const org = data[0].org_id;
  requireEmailAdmin(data.filter((r: any) => r.org_id === org).map((r: any) => r.role));
  return { org, actor: context.userId };
}
async function rpc(context: any, action: string, extra: Record<string, unknown> = {}) {
  const { org, actor } = await identity(context);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any).rpc("nexora_mailbox", {
    p_action: action,
    p_org: org,
    p_actor: actor,
    ...extra,
  });
  if (error) {
    const allowed = [
      "Daily send limit reached",
      "Send already attempted; do not retry",
      "Wait a moment before retrying",
      "Connect your mailbox first",
      "Too many connection attempts; try again later",
    ];
    throw new Error(
      allowed.find((s) => error.message?.includes(s)) ??
        "Email settings unavailable. Check the server configuration.",
    );
  }
  return data;
}
export const getEmailStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const data = await rpc(context, "status");
    return {
      connected: !!data.connected,
      email: data.email as string | undefined,
      verifiedAt: data.verifiedAt as string | undefined,
    };
  });
export const connectEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => mailboxInput.parse(input))
  .handler(async ({ context, data }) => {
    await rpc(context, "connect-attempt");
    const { verifyMailbox } = await import("./nexora/mail-transport.server");
    await verifyMailbox(data);
    await rpc(context, "save", { p_email: data.email, p_password: data.password });
    return { connected: true };
  });
export const disconnectEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await rpc(context, "disconnect");
    return { connected: false };
  });
export const getInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const credential = await rpc(context, "credentials");
    const { readInbox } = await import("./nexora/mail-transport.server");
    return readInbox(credential);
  });
export const getEmailMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => uidInput.parse(input))
  .handler(async ({ context, data }) => {
    const credential = await rpc(context, "credentials");
    const { readMessage } = await import("./nexora/mail-transport.server");
    return readMessage(credential, data.uid, data.validity);
  });
export const sendEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => messageInput.parse(input))
  .handler(async ({ context, data }) => {
    const credential = await rpc(context, "reserve", { p_request: data.requestId });
    const { sendMailboxEmail } = await import("./nexora/mail-transport.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let status = "unknown";
    try {
      const result = await sendMailboxEmail(credential, data);
      status = "accepted";
      return result;
    } finally {
      // Failure leaves the durable reservation in place: SMTP has no exactly-once guarantee.
      await (supabaseAdmin as any)
        .from("email_deliveries")
        .update({ status })
        .eq("id", data.requestId)
        .eq("mailbox_id", credential.id);
    }
  });
