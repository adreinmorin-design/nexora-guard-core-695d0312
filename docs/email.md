# Namecheap mailbox and app email

Open `/email` while signed in as an organization administrator. The Namecheap preset uses
`mail.privateemail.com`, IMAP 993 and SMTP 465 with implicit TLS. Enter your mailbox
password/application password into the password field, then Connect and test. Both
protocols must authenticate before the encrypted Vault secret is saved. Credentials
are never returned to the browser, written to audit events, or sent to an AI provider.

The connection belongs to the authenticated user in their current organization. Other
admins cannot access it. The backend verifies the user with Auth on every operation and
checks current organization membership. Client roles have no privileges on the mailbox
or send-reservation tables or the invoker RPC. Supabase service_role needs its standard
Vault access. Apply `20260920070137_email_mailboxes.sql` before deploying.

Inbox refresh reads the latest 30 envelopes. Individual messages are limited to 1 MB;
only plain text is displayed. Remote content and attachments are not rendered. Reading
does not change flags. Use Namecheap webmail for folders, attachments and deletion.
There is no background polling or autonomous AI processing of email.

Sending requires explicit review. There is a durable request-id reservation, a two-second
operation throttle, and a 50-send rolling daily limit per mailbox. SMTP acceptance is not
proof of final delivery. A timeout after DATA is ambiguous: no automatic resend occurs.
Messages are not automatically appended to the Sent folder. Bodies and recipients are
not persisted by Nexora. Send reservations remain until disconnect for deduplication.

## Verification and password resets

This project uses Lovable Cloud Auth. Configure branded authentication email in
Lovable project → More → Cloud → Emails, verify `nexoraguard.shop`, enable root-domain
sender display if wanted, and configure the local sender as supported by the UI.
Preserve Namecheap incoming MX records: a transactional sending subdomain is separate.
Lovable's paid-plan and domain-verification requirements apply. Do not disable email
confirmation or replace the signup/recovery flow with client-generated links.

If moved to a directly managed Supabase project, configure Auth custom SMTP with host
`mail.privateemail.com`, port 465, username/sender `dre@nexoraguard.shop`, and the
mailbox/application password. Secrets belong in the provider's secured settings.
Inbox connection alone does not change the authentication sender.

## Operational alerts

After connecting and verifying the intended operational mailbox, set the server-only
`NEXORA_ALERT_MAILBOX_ID` to its ID from `email_mailboxes`. This is deployment-controlled;
users cannot select another mailbox or recipients in requests. Critical events already
reported by the monitoring helper also send a fixed, non-sensitive alert to that mailbox
itself. Membership, limits and reservations still apply. Existing Slack alerts remain.
No credentials, tenant identifiers, prompts, arbitrary error strings or URLs enter emails.
The environment switch remains unset until the operator explicitly configures it.

## Validation and remaining activation checks

Run `bun run test:email`, `bun run test:database`, `bun run test:monitoring`, lint, typecheck
and build. Exercise Connect, Inbox, Read and a single self-addressed send on the deployed
Workers runtime: a successful bundle alone does not prove network access or credentials.
Verify actual arrival, SPF/DKIM/DMARC and a real signup/recovery email after domain setup.
