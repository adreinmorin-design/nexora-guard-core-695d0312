import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Refund Policy — NEXORA" },
      {
        name: "description",
        content: "NEXORA trial, cancellation and no-refund policy for digital subscriptions.",
      },
      { property: "og:title", content: "Refund Policy — NEXORA" },
      {
        property: "og:description",
        content: "NEXORA trial, cancellation and refund policy for digital subscriptions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Refund,
});

function Refund() {
  return (
    <LegalPage
      eyebrow="Billing"
      title="Refund Policy"
      summary="NEXORA is a digital subscription service offered with a trial period. Paid subscription charges are non-refundable except where applicable law requires otherwise."
    >
      <section>
        <h2>1. Trial period</h2>
        <p>
          Eligible Solo and Team customers receive the trial period displayed when they enroll,
          currently 14 days. The trial is intended to let you evaluate NEXORA before activating a
          paid subscription.
        </p>
        <p>
          If you cancel during the trial period, you may continue using NEXORA until the end of that
          trial period. A paid subscription charge is not due for the subsequent subscription if
          cancellation is completed before paid activation or conversion.
        </p>
      </section>

      <section>
        <h2>2. Paid subscription after the trial</h2>
        <p>
          If you choose to continue using NEXORA after the trial, you must select or activate the
          tier you want. By activating a paid tier, you agree to pay the price displayed for that
          tier and billing interval at the time of activation.
        </p>
        <p>
          Current self-service prices are shown on the <Link to="/pricing">Pricing page</Link>.
          Enterprise pricing and billing terms are set by contract.
        </p>
      </section>

      <section>
        <h2>3. No refunds for paid digital subscriptions</h2>
        <p>
          Because NEXORA is delivered digitally and customers can evaluate the product during the
          trial period, payments for paid subscription periods are final and non-refundable once
          charged, except where applicable law requires otherwise.
        </p>
        <p>
          We do not provide prorated refunds or credits for unused time, partial billing periods,
          plan downgrades, reduced usage or cancellation after a paid billing period has begun.
        </p>
      </section>

      <section>
        <h2>4. Cancellation</h2>
        <p>
          Canceling a paid subscription prevents future renewal according to the cancellation terms
          shown in the service or by our payment provider. Unless otherwise required by law,
          cancellation does not create a refund for a charge that has already been processed.
        </p>
      </section>

      <section>
        <h2>5. Separate provider and implementation charges</h2>
        <p>
          Charges billed directly by an AI model provider, cloud provider or other third party are
          governed by that provider and are not refundable by DreEnt. LLC. Separately contracted
          implementation or professional services follow the applicable written agreement.
        </p>
      </section>

      <section>
        <h2>6. Billing errors</h2>
        <p>
          If you believe you were charged more than once, charged the wrong amount or charged after
          a cancellation should have taken effect, contact{" "}
          <a href="mailto:dre@nexoraguard.shop">dre@nexoraguard.shop</a>. We will review documented
          billing errors separately from discretionary refund requests.
        </p>
      </section>

      <section>
        <h2>7. Enterprise agreements</h2>
        <p>
          If a signed Enterprise agreement expressly contains different refund, cancellation or
          payment terms, that signed agreement controls for that Enterprise customer.
        </p>
      </section>
    </LegalPage>
  );
}
