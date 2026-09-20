import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import PostalMime from "postal-mime";
import { MAIL_HOST } from "./email-input";

type Credential = { email: string; password: string };
function smtp(credential: Credential) {
  return nodemailer.createTransport({
    host: MAIL_HOST,
    port: 465,
    secure: true,
    auth: { user: credential.email, pass: credential.password },
    logger: false,
    debug: false,
    pool: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
async function withImap<T>(credential: Credential, work: (client: ImapFlow) => Promise<T>) {
  const client = new ImapFlow({
    host: MAIL_HOST,
    port: 993,
    secure: true,
    auth: { user: credential.email, pass: credential.password },
    logger: false,
    disableAutoIdle: true,
    disableCompression: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  client.on("error", () => {}); // Never log protocol errors containing mailbox data.
  const deadline = setTimeout(() => client.close(), 25000);
  try {
    await client.connect();
    return await work(client);
  } catch {
    throw new Error("IMAP connection failed. Check your mailbox password and try again.");
  } finally {
    clearTimeout(deadline);
    client.close();
  }
}
export async function verifyMailbox(credential: Credential) {
  await withImap(credential, async () => true);
  const transport = smtp(credential);
  try {
    await transport.verify();
  } catch {
    throw new Error("SMTP connection failed. Check your mailbox password and try again.");
  } finally {
    transport.close();
  }
}
export async function readInbox(credential: Credential) {
  return withImap(credential, async (client) => {
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    if (!box.exists) return { messages: [], validity: String(box.uidValidity) };
    const messages = [];
    // At most the latest 30 envelopes; no bodies, attachments, or flags changed.
    for await (const msg of client.fetch(`${Math.max(1, box.exists - 29)}:*`, {
      envelope: true,
      flags: true,
    })) {
      messages.push({
        uid: msg.uid,
        subject: (msg.envelope?.subject ?? "(No subject)").slice(0, 500),
        from: (msg.envelope?.from ?? [])
          .slice(0, 5)
          .map((a) => ({ name: a.name ?? "", address: a.address ?? "" })),
        date: msg.envelope?.date ? String(msg.envelope.date) : null,
        unread: !msg.flags?.has("\\Seen"),
      });
    }
    return { messages: messages.reverse(), validity: String(box.uidValidity) };
  });
}
export async function readMessage(credential: Credential, uid: number, validity: string) {
  return withImap(credential, async (client) => {
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    if (String(box.uidValidity) !== validity)
      throw new Error("Refresh the inbox before opening this message.");
    const meta = await client.fetchOne(String(uid), { size: true }, { uid: true });
    if (!meta || !meta.size || meta.size > 1024 * 1024)
      throw new Error("Message unavailable or larger than 1 MB. Open it in webmail.");
    // Bound the source on the wire as well as checking RFC822.SIZE.
    const msg = await client.fetchOne(
      String(uid),
      { source: { start: 0, maxLength: 1024 * 1024 + 1 } },
      { uid: true },
    );
    if (!msg || !msg.source || msg.source.length > 1024 * 1024)
      throw new Error("Message unavailable.");
    const parsed = await PostalMime.parse(msg.source);
    return {
      subject: (parsed.subject ?? "(No subject)").slice(0, 500),
      text: (parsed.text ?? "This message has no plain-text version. Open it in webmail.").slice(
        0,
        100000,
      ),
      attachments: parsed.attachments.length,
    };
  });
}
export async function sendMailboxEmail(
  credential: Credential,
  message: { to: string; subject: string; text: string; requestId: string },
) {
  const transport = smtp(credential);
  try {
    const info = await transport.sendMail({
      from: { name: "Nexora", address: credential.email },
      to: message.to,
      subject: message.subject,
      text: message.text,
      messageId: `<${message.requestId}@${credential.email.split("@")[1]}>`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (!info.accepted?.length) throw new Error("Not accepted");
    return { accepted: true };
  } catch {
    // SMTP timeout after DATA is ambiguous: never automatically retry.
    throw new Error("Delivery could not be confirmed. Check webmail before trying another send.");
  } finally {
    transport.close();
  }
}
