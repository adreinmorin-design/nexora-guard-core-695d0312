import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — NEXORA" },
      {
        name: "description",
        content: "Terms governing use of the NEXORA AI security and governance service.",
      },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      summary="These Terms of Service govern access to and use of NEXORA, a digital AI security, governance and execution-control service operated by DreEnt. LLC."
    >
      <section>
        <h2>1. Agreement and eligibility</h2>
        <p>
          By creating an account, starting a trial, activating a paid plan or otherwise using
          NEXORA, you agree to these Terms and the{" "}
          <Link to="/privacy">Privacy Notice</Link>. You must be at least 18 years old and able to
          enter into a binding agreement. If you use NEXORA for an organization, you represent that
          you are authorized to act for that organization.
        </p>
      </section>

      <section>
        <h2>2. The service</h2>
        <p>
          NEXORA provides software for governing AI model, agent and tool execution, including
          policy enforcement, sensitive-data controls, budgets, approvals, routing, usage
          visibility and audit evidence. Features, limits and availability vary by plan and may
          change as the service evolves.
        </p>
        <p>
          NEXORA may integrate with third-party services selected or configured by you, including AI
          model providers, infrastructure providers and payment services. Those services may have
          separate terms and charges.
        </p>
      </section>

      <section>
        <h2>3. Accounts and security</h2>
        <p>
          You are responsible for the accuracy of account information, maintaining the
          confidentiality of credentials, controlling authorized users and agents, and promptly
          notifying us of suspected unauthorized access. You may not share credentials in a way
          that bypasses plan or security controls.
        </p>
      </section>

      <section>
        <h2>4. Trials, subscriptions and payment</h2>
        <p>
          Eligible customers may receive the trial period displayed when they enroll. If you cancel
          during the trial, you may continue using the trial through its stated end date. If you
          choose to continue after the trial, activating a paid tier constitutes your agreement to
          pay the recurring price displayed for that tier and billing interval.
        </p>
        <p>
          Solo and Team subscriptions are billed in advance through our payment provider. Enterprise
          service is governed by the applicable signed order form or agreement. Model-provider
          usage, taxes and separately contracted implementation work may be charged separately as
          disclosed.
        </p>
        <p>
          Because NEXORA is a digital subscription service offered with a trial period, paid
          subscription charges are non-refundable except where applicable law requires otherwise.
          See the <Link to="/refund">Refund Policy</Link>.
        </p>
      </section>

      <section>
        <h2>5. Acceptable use</h2>
        <p>You may not use NEXORA to:</p>
        <ul>
          <li>violate applicable law or the rights of another person;</li>
          <li>gain unauthorized access to systems, accounts, data or networks;</li>
          <li>circumvent authentication, tenant isolation, policy, budget or usage controls;</li>
          <li>introduce malware or intentionally disrupt the service;</li>
          <li>resell or provide access to NEXORA except under an authorized agreement; or</li>
          <li>use the service in a way that materially interferes with other customers.</li>
        </ul>
      </section>

      <section>
        <h2>6. Customer data and AI content</h2>
        <p>
          As between you and DreEnt. LLC, you retain your rights in data and content you submit to
          NEXORA. You authorize us to process that data as needed to provide, secure, troubleshoot
          and support the service. When you direct NEXORA to invoke a third-party model or tool,
          applicable request data may be transmitted to that selected provider subject to its terms
          and privacy practices.
        </p>
        <p>
          You are responsible for having the rights and permissions needed to submit data to the
          service and for deciding which providers, tools and policies your organization permits.
        </p>
      </section>

      <section>
        <h2>7. NEXORA intellectual property</h2>
        <p>
          NEXORA, its software, interfaces, documentation, trademarks and related technology are
          owned by DreEnt. LLC or its licensors. These Terms give you a limited right to use the
          service during your authorized subscription or trial; they do not transfer ownership of
          the service or its underlying technology.
        </p>
      </section>

      <section>
        <h2>8. Availability and changes</h2>
        <p>
          We may modify, update or discontinue features, including to improve security, reliability
          or legal compliance. We do not guarantee that the service will be uninterrupted or
          error-free. Material subscription changes will be presented through the service or other
          reasonable notice when required.
        </p>
      </section>

      <section>
        <h2>9. Suspension and termination</h2>
        <p>
          We may suspend or restrict access when reasonably necessary to address security threats,
          abuse, nonpayment, legal requirements or material violations of these Terms. You may stop
          using the service and cancel a subscription subject to the applicable billing terms.
          Provisions that by their nature should survive termination continue to apply.
        </p>
      </section>

      <section>
        <h2>10. Disclaimers</h2>
        <p>
          To the extent permitted by law, NEXORA is provided on an “as is” and “as available”
          basis. Security, DLP and policy controls reduce risk but cannot guarantee detection or
          prevention of every threat, sensitive value or unsafe action. You remain responsible for
          your systems, provider configurations and organizational decisions.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Questions about these Terms may be sent to{" "}
          <a href="mailto:dre@nexoraguard.shop">dre@nexoraguard.shop</a>.
        </p>
      </section>
    </LegalPage>
  );
}
