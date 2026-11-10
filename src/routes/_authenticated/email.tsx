import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  connectEmail,
  disconnectEmail,
  getEmailStatus,
  getInbox,
  getEmailMessage,
  sendEmail,
} from "@/lib/email.functions";

export const Route = createFileRoute("/_authenticated/email")({
  head: () => ({
    meta: [
      { title: "Email \u2014 NEXORA" },
      {
        name: "description",
        content: "Access your private NEXORA email inbox and connection settings.",
      },
      { property: "og:title", content: "Email \u2014 NEXORA" },
      {
        property: "og:description",
        content: "Access your private NEXORA email inbox and connection settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EmailPage,
});
const field = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const button = "rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50";
function EmailPage() {
  const statusFn = useServerFn(getEmailStatus);
  const connect = useServerFn(connectEmail);
  const disconnect = useServerFn(disconnectEmail);
  const inboxFn = useServerFn(getInbox);
  const openMessage = useServerFn(getEmailMessage);
  const send = useServerFn(sendEmail);
  const status = useQuery({
    queryKey: ["email-status"],
    queryFn: () => statusFn({}),
    retry: false,
  });
  const [email, setEmail] = useState("dre@nexoraguard.shop");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [inbox, setInbox] = useState<Awaited<ReturnType<typeof getInbox>> | null>(null);
  const [message, setMessage] = useState<Awaited<ReturnType<typeof getEmailMessage>> | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirm, setConfirm] = useState(false);
  const [attempted, setAttempted] = useState(false);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Email operation failed.");
    } finally {
      setBusy(false);
    }
  }
  function newDraft() {
    setRequestId(crypto.randomUUID());
    setAttempted(false);
    setConfirm(false);
    setTo("");
    setSubject("");
    setText("");
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your private inbox and Nexora email setup.
        </p>
      </div>
      {status.isPending ? <p>Loading email settings…</p> : null}
      {status.error ? (
        <p role="alert" className="text-critical">
          {status.error.message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-critical">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-primary">
          {notice}
        </p>
      ) : null}
      {!status.error && !status.isPending ? (
        <section className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Namecheap Private Email</h2>
            <span className="text-sm text-muted-foreground">
              {status.data?.connected ? `Connected · ${status.data.email}` : "Not connected"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Only you can access this connection. Your password is encrypted on the server. Incoming
            messages cannot run AI actions.
          </p>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const secret = password;
              setPassword("");
              void run(async () => {
                await connect({ data: { email, password: secret } });
                await status.refetch();
                setNotice("IMAP and SMTP verified. Your mailbox is connected.");
              });
            }}
          >
            <label className="text-sm">
              Mailbox address
              <input
                className={field}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Mailbox / application password
              <input
                className={field}
                type="password"
                required
                maxLength={512}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className={button} disabled={busy}>
                {busy
                  ? "Working…"
                  : status.data?.connected
                    ? "Replace connection"
                    : "Connect and test"}
              </button>
              {status.data?.connected ? (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Disconnect this mailbox and remove its stored password? Your email stays at Namecheap.",
                      )
                    )
                      void run(async () => {
                        await disconnect({});
                        setInbox(null);
                        setMessage(null);
                        await status.refetch();
                        setNotice("Mailbox disconnected.");
                      });
                  }}
                >
                  Disconnect
                </button>
              ) : null}
              <a
                className={button}
                href="https://privateemail.com"
                target="_blank"
                rel="noreferrer"
              >
                Open webmail
              </a>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            IMAP 993 · SMTP 465 · TLS · mail.privateemail.com
          </p>
        </section>
      ) : null}
      {status.data?.connected ? (
        <>
          <section className="panel space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Inbox</h2>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setInbox(await inboxFn({}));
                    setMessage(null);
                  })
                }
              >
                Refresh inbox
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Latest 30 messages. Reading here leaves messages unread. Use webmail for attachments,
              folders, or deletion.
            </p>
            {inbox?.messages.length === 0 ? <p>Your inbox is empty.</p> : null}
            <div className="divide-y divide-border">
              {inbox?.messages.map((m) => (
                <button
                  key={m.uid}
                  disabled={busy}
                  className="block w-full py-3 text-left disabled:opacity-50"
                  onClick={() =>
                    void run(async () => {
                      setMessage(
                        await openMessage({ data: { uid: m.uid, validity: inbox.validity } }),
                      );
                    })
                  }
                >
                  <div className={m.unread ? "font-semibold" : ""}>{m.subject}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.from.map((f) => f.name || f.address).join(", ")} ·{" "}
                    {m.date ? new Date(m.date).toLocaleString() : ""}
                  </div>
                </button>
              ))}
            </div>
            {message ? (
              <article className="rounded-md border border-border p-4">
                <h3 className="font-semibold">{message.subject}</h3>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
                  {message.text}
                </pre>
                {message.attachments ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {message.attachments} attachment(s) available in webmail.
                  </p>
                ) : null}
              </article>
            ) : null}
          </section>
          <section className="panel space-y-4 p-5">
            <h2 className="font-semibold">Send a message</h2>
            <p className="text-sm text-muted-foreground">
              From {status.data.email}. Every send requires your review. Up to 50 sends per rolling
              24 hours.
            </p>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setConfirm(true);
              }}
            >
              <label className="block text-sm">
                To
                <input
                  className={field}
                  required
                  type="email"
                  maxLength={254}
                  disabled={attempted || busy}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setConfirm(false);
                  }}
                />
              </label>
              <label className="block text-sm">
                Subject
                <input
                  className={field}
                  required
                  maxLength={200}
                  disabled={attempted || busy}
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setConfirm(false);
                  }}
                />
              </label>
              <label className="block text-sm">
                Message
                <textarea
                  className={field}
                  required
                  rows={6}
                  maxLength={20000}
                  disabled={attempted || busy}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setConfirm(false);
                  }}
                />
              </label>
              <div className="flex gap-2">
                <button className={button} disabled={busy || attempted}>
                  Review send
                </button>
                <button className={button} type="button" disabled={busy} onClick={newDraft}>
                  New draft
                </button>
              </div>
            </form>
            {confirm && !attempted ? (
              <div className="rounded-md border border-primary/40 p-4">
                <p className="mb-3 text-sm">
                  Send “{subject}” to {to} from {status.data.email}?
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    setAttempted(true);
                    void run(async () => {
                      await send({ data: { to, subject, text, requestId } });
                      setConfirm(false);
                      setNotice(
                        "Namecheap accepted the message for delivery. Final delivery is not yet confirmed.",
                      );
                    });
                  }}
                >
                  Confirm and send
                </button>
              </div>
            ) : null}
            {attempted ? (
              <p className="text-xs text-muted-foreground">
                This send has been attempted. Check the result before starting another draft. SMTP
                messages are not automatically copied to your Sent folder.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
      <section className="panel space-y-3 p-5">
        <h2 className="font-semibold">App emails</h2>
        <p className="text-sm">
          Sign-up verification and password resets use Nexora’s authentication service. Connecting
          your inbox does not change their sender.
        </p>
        <p className="text-sm text-muted-foreground">
          For this Lovable Cloud deployment, finish branded authentication delivery in Lovable →
          More → Cloud → Emails: verify nexoraguard.shop and configure the sender. Keep email
          confirmation enabled and preserve Namecheap’s incoming MX records.
        </p>
        <p className="text-sm text-muted-foreground">
          Operational email alerts are available after the deployment’s alert mailbox is configured.
          No email alert delivery is claimed until tested.
        </p>
      </section>
    </div>
  );
}
