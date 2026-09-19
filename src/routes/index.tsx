import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ShieldCheck } from "lucide-react";

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

const CORE = [
  "AI gateway and provider routing",
  "Policy, DLP and prompt-injection controls",
  "Budgets, approvals and usage limits",
  "Agent identity, tools and MCP governance",
  "Security findings and attack simulation",
  "Immutable audit and cost visibility",
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-md border border-primary/35 bg-primary/10">
            <ShieldCheck className="h-4 w-4 text-primary" />
          </div>
          <span className="font-display text-sm font-semibold tracking-[0.2em]">NEXORA</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
          <Link
            to="/auth"
            search={{ next: "/overview" }}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:px-8 lg:py-28">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">
              Enterprise AI control
            </p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight font-semibold lg:text-6xl">
              Keep AI powerful.
              <br />
              Keep it under control.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground lg:text-lg">
              One control plane for AI security, governance, agents, cost and audit. NEXORA keeps
              the complexity underneath so operators can work from a simple interface.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/auth"
                search={{ next: "/overview" }}
                className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Open NEXORA
              </Link>
              <Link
                to="/pricing"
                className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                View plans
              </Link>
            </div>
          </div>

          <div className="panel p-6 lg:p-7">
            <div className="text-sm font-medium">Premium controls, without the clutter</div>
            <div className="mt-5 space-y-3">
              {CORE.map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10">
                    <Check className="h-3 w-3 text-primary" />
                  </div>
                  <span className="text-sm text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface/30">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-3 lg:px-8">
            <div>
              <div className="text-sm font-medium">Control</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Route models, agents and tools through one governed gateway.
              </p>
            </div>
            <div>
              <div className="text-sm font-medium">Protect</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Enforce data protection, approvals, policy and spend before AI traffic leaves.
              </p>
            </div>
            <div>
              <div className="text-sm font-medium">Understand</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                See requests, risk, findings, cost and audit history from one workspace.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-7xl items-center justify-between px-6 py-7 text-xs text-muted-foreground lg:px-8">
        <span>NEXORA</span>
        <span>AI Security & Governance</span>
      </footer>
    </div>
  );
}
