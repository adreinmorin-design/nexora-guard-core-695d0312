import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { PLANS, formatLimit } from "@/lib/nexora/plans";
import { cn } from "@/lib/utils";
import { PublicFooter } from "@/components/public-footer";
import { getPaddlePublicConfig } from "@/lib/nexora.functions";

type PaddlePaymentApi = {
  Initialize: (options: {
    token: string;
    checkout?: {
      settings?: {
        displayMode?: "overlay" | "inline";
        theme?: "light" | "dark";
      };
    };
  }) => void;
};

async function loadPaddle(): Promise<PaddlePaymentApi> {
  if (typeof window === "undefined") throw new Error("Checkout is only available in a browser.");
  const browser = window as typeof window & { Paddle?: PaddlePaymentApi };
  if (browser.Paddle) return browser.Paddle;

  return new Promise<PaddlePaymentApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-nexora-paddle="true"]');
    const script = existing ?? document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.dataset["nexoraPaddle"] = "true";
    script.onload = () =>
      browser.Paddle ? resolve(browser.Paddle) : reject(new Error("Paddle failed to load."));
    script.onerror = () => reject(new Error("Paddle checkout could not load."));
    if (!existing) document.head.appendChild(script);
  });
}

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — NEXORA AI Security & Governance" },
      {
        name: "description",
        content:
          "NEXORA plans for independent businesses, growing teams and enterprise AI governance.",
      },
      { property: "og:title", content: "NEXORA pricing" },
      {
        property: "og:description",
        content: "Secure and govern models, agents and MCP tools from $49 per month.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Pricing,
});

function Pricing() {
  const getPaddleConfig = useServerFn(getPaddlePublicConfig);
  const [paymentLinkError, setPaymentLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const config = await getPaddleConfig({});
        if (!config.enabled) {
          if (window.location.search.includes("_ptxn=") && !cancelled) {
            setPaymentLinkError("Live checkout is not configured yet.");
          }
          return;
        }

        const paddle = await loadPaddle();
        if (cancelled) return;
        paddle.Initialize({
          token: config.clientToken,
          checkout: { settings: { displayMode: "overlay", theme: "light" } },
        });
      } catch {
        if (window.location.search.includes("_ptxn=") && !cancelled) {
          setPaymentLinkError("Secure checkout could not be initialized.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getPaddleConfig]);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-5 lg:px-12">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-sm border border-primary/50 bg-primary/15" />
          <span className="font-display text-sm font-semibold tracking-[0.22em]">NEXORA</span>
        </Link>
        <Link
          to="/auth"
          search={{ next: "/overview" }}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          Sign in
        </Link>
      </header>

      <main className="px-6 py-16 lg:px-12">
        <div className="mx-auto max-w-3xl text-center">
          {paymentLinkError ? (
            <p
              role="alert"
              className="mb-5 rounded-md border border-critical/30 bg-critical/5 p-3 text-sm text-critical"
            >
              {paymentLinkError}
            </p>
          ) : null}
          <p className="label-caps">Simple platform pricing</p>
          <h1 className="mt-3 font-display text-4xl font-semibold">
            Govern AI before it governs your spend.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Every plan includes the governed gateway, policy engine, DLP and cost visibility. AI
            provider usage is billed separately by your model provider.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <section
              key={plan.key}
              className={cn(
                "panel relative flex flex-col p-6",
                plan.featured && "border-primary/60",
              )}
            >
              {plan.featured ? (
                <span className="absolute -top-3 right-5 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold tracking-wider text-primary-foreground uppercase">
                  Best value
                </span>
              ) : null}
              <p className="label-caps">{plan.audience}</p>
              <h2 className="mt-2 font-display text-2xl font-semibold">{plan.name}</h2>
              <div className="mt-5 flex items-end gap-1">
                <span className="font-display text-4xl font-semibold">
                  {plan.monthlyPriceUsd === null
                    ? "Custom"
                    : `$${plan.monthlyPriceUsd.toLocaleString()}`}
                </span>
                {plan.monthlyPriceUsd !== null ? (
                  <span className="pb-1 text-sm text-muted-foreground">/month</span>
                ) : null}
              </div>
              {plan.key === "enterprise" ? (
                <p className="mt-1 text-xs text-muted-foreground">Custom annual contract</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Two months free annually · 14-day trial
                </p>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2 border-y border-border py-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Seats</span>
                  <br />
                  {formatLimit(plan.seats)}
                </div>
                <div>
                  <span className="text-muted-foreground">Agents</span>
                  <br />
                  {formatLimit(plan.agents)}
                </div>
                <div>
                  <span className="text-muted-foreground">Requests/mo</span>
                  <br />
                  {formatLimit(plan.monthlyRequests)}
                </div>
                <div>
                  <span className="text-muted-foreground">Retention</span>
                  <br />
                  {plan.auditRetentionDays ? `${plan.auditRetentionDays} days` : "Contracted"}
                </div>
              </div>

              <ul className="mt-5 flex-1 space-y-3 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/auth"
                search={{ next: `/admin/billing?plan=${plan.key}` }}
                className={cn(
                  "mt-7 rounded-md px-4 py-2.5 text-center text-sm font-medium",
                  plan.featured
                    ? "bg-primary text-primary-foreground"
                    : "border border-border hover:bg-accent",
                )}
              >
                {plan.key === "enterprise" ? "Request enterprise access" : "Start 14-day trial"}
              </Link>
            </section>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-xs text-muted-foreground">
          Platform fees exclude model-provider charges, taxes and contracted implementation work.
          Limits apply per organization and reset monthly unless otherwise stated.
        </p>
      </main>

      <PublicFooter />
    </div>
  );
}
