import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Notice — NEXORA" },
      {
        name: "description",
        content: "How DreEnt. LLC collects, uses and protects information when providing NEXORA.",
      },
      { property: "og:title", content: "Privacy Notice — NEXORA" },
      {
        property: "og:description",
        content: "How NEXORA collects, uses and protects information.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Notice"
      summary="This notice explains how DreEnt. LLC processes information when you visit, register for or use NEXORA."
    >
      <section>
        <h2>1. Information we process</h2>
        <p>Depending on how you use NEXORA, we may process:</p>
        <ul>
          <li>account and contact information, such as name and email address;</li>
          <li>organization, membership, role, plan and subscription information;</li>
          <li>
            prompts, model inputs, outputs, tool arguments and related content submitted through
            governed execution paths;
          </li>
          <li>
            policy decisions, security findings, audit events, usage, token, cost and execution
            metadata;
          </li>
          <li>
            technical information such as session, device, browser, IP, request and diagnostic
            metadata; and
          </li>
          <li>
            billing identifiers and subscription status. Payment-card information is handled by our
            payment provider rather than stored by NEXORA.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. How we use information</h2>
        <p>We use information to:</p>
        <ul>
          <li>provide, authenticate, secure and operate NEXORA;</li>
          <li>enforce tenant, policy, DLP, budget, approval and tool controls;</li>
          <li>route requests to providers and tools you authorize;</li>
          <li>produce audit, usage and security evidence for your organization;</li>
          <li>manage trials, subscriptions, support and service communications;</li>
          <li>detect abuse, investigate failures and improve reliability; and</li>
          <li>comply with legal obligations and protect the rights and security of users.</li>
        </ul>
      </section>

      <section>
        <h2>3. AI providers and other service providers</h2>
        <p>
          When your organization configures or selects an AI provider, MCP server, tool or other
          integration, NEXORA may transmit the data needed to perform that requested operation to
          that provider. The destination provider may process the data under its own terms and
          privacy practices.
        </p>
        <p>
          We also use service providers to operate infrastructure, authentication, hosting, email,
          monitoring and billing. These providers process information for the services they perform
          for us. Paddle acts as the payment provider for supported self-service subscriptions.
        </p>
      </section>

      <section>
        <h2>4. Sale of personal information</h2>
        <p>
          DreEnt. LLC does not sell personal information for money. We do not use NEXORA customer
          prompts or governed execution content for third-party advertising.
        </p>
      </section>

      <section>
        <h2>5. Retention</h2>
        <p>
          We retain information for as long as reasonably necessary to provide the service, meet the
          audit-retention level associated with the applicable plan or contract, maintain security
          and transaction records, resolve disputes and satisfy legal obligations. Different data
          categories may have different retention periods.
        </p>
      </section>

      <section>
        <h2>6. Security</h2>
        <p>
          We use technical and organizational safeguards intended to protect information, including
          authentication, tenant-scoped access controls, server-side secret handling and audit
          controls. No system can guarantee absolute security.
        </p>
      </section>

      <section>
        <h2>7. Your choices and rights</h2>
        <p>
          Depending on applicable law and your relationship with an organization using NEXORA, you
          may have rights to request access, correction or deletion of personal information. An
          organization administrator may control some information held in its NEXORA workspace.
        </p>
        <p>
          To make a privacy request, contact{" "}
          <a href="mailto:dre@nexoraguard.shop">dre@nexoraguard.shop</a>. We may need to verify the
          request before acting on it.
        </p>
      </section>

      <section>
        <h2>8. Changes to this notice</h2>
        <p>
          We may update this Privacy Notice as NEXORA, our providers or legal requirements change.
          The effective date above identifies the current version.
        </p>
      </section>

      <section>
        <h2>9. Contact</h2>
        <p>
          Privacy questions may be sent to{" "}
          <a href="mailto:dre@nexoraguard.shop">dre@nexoraguard.shop</a>.
        </p>
      </section>
    </LegalPage>
  );
}
