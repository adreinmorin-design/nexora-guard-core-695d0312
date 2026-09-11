import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NEXORA — AI Security, Governance & Control Plane" },
      {
        name: "description",
        content:
          "NEXORA gives organizations centralized security, governance, cost control and visibility across every AI model, application and autonomous agent.",
      },
      { property: "og:title", content: "NEXORA — AI Security, Governance & Control Plane" },
      {
        property: "og:description",
        content:
          "Control every model. Govern every agent. Secure every action. Deterministic policy enforcement for enterprise AI traffic.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const PILLARS = [
  {
    title: "Gateway",
    body: "Every model call is authenticated, tenant-resolved, inspected and routed server-side before a provider ever sees it.",
  },
  {
    title: "Policy",
    body: "Versioned, prioritized, deterministic rules. Explicit deny beats security block beats approval beats redaction beats allow.",
  },
  {
    title: "Guard",
    body: "PII, secret and prompt-injection detection on both prompts and responses, with confidence and detection source on every finding.",
  },
  {
    title: "Audit",
    body: "Append-only records of actor, action, decision, policy version and result — searchable, tenant-scoped, immutable.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-5 lg:px-12">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-sm border border-primary/50 bg-primary/15" />
          <span className="font-display text-sm font-semibold tracking-[0.22em]">NEXORA</span>
        </div>
        <Link
          to="/auth"
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Sign in
        </Link>
      </header>

      <section className="grid-lines border-y border-border px-6 py-20 lg:px-12">
        <p className="label-caps">AI Security, Governance &amp; Control Plane</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight font-semibold lg:text-5xl">
          Control every model. Govern every agent. Secure every action.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted-foreground">
          NEXORA sits between your organization and the AI systems it uses — enforcing policy,
          budgets, data protection and human approval on every request, deterministically and
          server-side.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/auth"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open the control plane
          </Link>
        </div>
      </section>

      <section className="grid gap-4 px-6 py-16 md:grid-cols-2 lg:grid-cols-4 lg:px-12">
        {PILLARS.map((p) => (
          <div key={p.title} className="panel p-5">
            <div className="label-caps">NEXORA</div>
            <h2 className="mt-1 font-display text-lg font-semibold">{p.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-border px-6 py-12 lg:px-12">
        <h2 className="font-display text-xl font-semibold">Architectural invariant</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          AI reasoning is separated from security enforcement. Models and agents may recommend; they
          never decide the policies that govern them. Enforcement, tenant isolation, credentials,
          budgets and approvals live on the server — never in the browser.
        </p>
      </section>

      <footer className="border-t border-border px-6 py-6 text-xs text-muted-foreground lg:px-12">
        NEXORA — AI Security, Governance &amp; Control Plane
      </footer>
    </div>
  );
}
