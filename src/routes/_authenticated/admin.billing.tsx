import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Gauge, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getBillingState, getPaddleCheckout } from "@/lib/nexora.functions";
import { PLANS, formatLimit, planByKey, type Plan, type PlanKey } from "@/lib/nexora/plans";
import { Metric, PageHeader, Panel, Tag } from "@/components/nexora/primitives";
import { cn } from "@/lib/utils";

type PaddleCheckoutConfig = {
  clientToken: string;
  environment: "sandbox" | "production";
  priceId: string;
  customData: Record<string, string>;
};

type PaddleApi = {
  Environment?: { set: (environment: "sandbox" | "production") => void };
  Initialize: (options: { token: string }) => void;
  Checkout: { open: (options: Record<string, unknown>) => void };
};

async function openPaddleCheckout(config: PaddleCheckoutConfig): Promise<void> {
  if (typeof window === "undefined") throw new Error("Checkout is only available in a browser.");
  const browser = window as typeof window & { Paddle?: PaddleApi };
  const paddle = await new Promise<PaddleApi>((resolve, reject) => {
    if (browser.Paddle) return resolve(browser.Paddle);
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
  if (config.environment === "sandbox") paddle.Environment?.set("sandbox");
  paddle.Initialize({ token: config.clientToken });
  paddle.Checkout.open({
    items: [{ priceId: config.priceId, quantity: 1 }],
    customData: config.customData,
    settings: { displayMode: "overlay", theme: "light" },
  });
}

export const Route = createFileRoute("/_authenticated/admin/billing")({
  validateSearch: (search: Record<string, unknown>) => ({
    plan: ["solo", "team", "enterprise"].includes(String(search["plan"]))
      ? (String(search["plan"]) as PlanKey)
      : undefined,
  }),
  head: () => ({ meta: [{ title: "Plans & Billing — NEXORA" }] }),
  component: Billing,
});

function PlanWizard({
  plan,
  current,
  status,
  interval,
  step,
  checkoutPending,
  checkoutError,
  onStep,
  onClose,
  onCheckout,
}: {
  plan: Plan;
  current: Plan;
  status: string | undefined;
  interval: "monthly" | "annual";
  step: number;
  checkoutPending: boolean;
  checkoutError: string | null;
  onStep: (step: number) => void;
  onClose: () => void;
  onCheckout: (plan: "solo" | "team") => void;
}) {
  const steps = ["Plan", "Features", "Limits", "Setup"];
  const isCurrentActive = current.key === plan.key && status === "active";
  const isCurrentTrial = current.key === plan.key && status === "trialing";
  const price =
    plan.key === "enterprise"
      ? "From $1,500/month"
      : interval === "annual"
        ? `$${plan.annualPriceUsd?.toLocaleString()}/year`
        : `$${plan.monthlyPriceUsd?.toLocaleString()}/month`;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-background/85 p-4 backdrop-blur-sm">
      <div className="mx-auto my-4 w-full max-w-3xl rounded-2xl border border-border bg-background shadow-2xl sm:my-10">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-5 sm:px-7">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium tracking-[0.14em] text-primary uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              {isCurrentActive ? "Your plan guide" : "Plan wizard"}
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold">{plan.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{plan.guide.headline}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plan wizard"
            className="rounded-md border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-5 py-4 sm:px-7">
          <div className="grid grid-cols-4 gap-2">
            {steps.map((label, index) => (
              <div key={label}>
                <div
                  className={cn("h-1 rounded-full", index <= step ? "bg-primary" : "bg-muted")}
                />
                <div
                  className={cn(
                    "mt-2 text-[10px] font-medium uppercase",
                    index === step ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-[23rem] px-5 py-6 sm:px-7">
          {step === 0 ? (
            <div>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-5">
                <div className="text-xs font-medium text-muted-foreground">Selected tier</div>
                <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="font-display text-3xl font-semibold">{plan.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{plan.audience}</div>
                  </div>
                  <div className="font-display text-xl font-semibold">{price}</div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs font-medium text-muted-foreground">Your current tier</div>
                  <div className="mt-1 text-lg font-semibold">{current.name}</div>
                  <div className="mt-1 text-xs capitalize text-muted-foreground">
                    {status ?? "status unavailable"}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs font-medium text-muted-foreground">Billing</div>
                  <div className="mt-1 text-lg font-semibold capitalize">
                    {plan.key === "enterprise" ? "Contracted" : interval}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {plan.key === "enterprise"
                      ? "Final scope is agreed during enterprise onboarding."
                      : interval === "annual"
                        ? "Annual billing includes two months free."
                        : "Billed monthly."}
                  </div>
                </div>
              </div>

              {plan.key !== "solo" ? (
                <p className="mt-5 text-sm text-muted-foreground">
                  {plan.key === "team"
                    ? "Team includes the Solo foundation plus the collaboration, MCP and security capabilities shown next."
                    : "Enterprise includes the Team platform. Enterprise-specific items below are contracted capabilities that are scoped during implementation."}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div>
              <h3 className="font-display text-xl font-semibold">
                {plan.key === "solo" ? "What Solo includes" : `What ${plan.name} adds`}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                These are the capabilities that define this tier.
              </p>
              <div className="mt-5 space-y-3">
                {plan.guide.benefits.map((benefit) => (
                  <div
                    key={benefit.title}
                    className="flex gap-3 rounded-lg border border-border p-4"
                  >
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10">
                      <Check className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{benefit.title}</div>
                        {benefit.delivery === "contracted" ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Contracted
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{benefit.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <h3 className="font-display text-xl font-semibold">Your tier limits</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Resource limits are enforced separately from model-provider charges.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ["Operator seats", formatLimit(plan.seats)],
                  ["Governed agents", formatLimit(plan.agents)],
                  ["Requests / month", formatLimit(plan.monthlyRequests)],
                  ["MCP servers", formatLimit(plan.mcpServers)],
                  [
                    "Audit retention",
                    plan.auditRetentionDays ? `${plan.auditRetentionDays} days` : "Contracted",
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5" />
                      {label}
                    </div>
                    <div className="mt-2 font-mono text-lg font-medium">{value}</div>
                  </div>
                ))}
              </div>
              {plan.key === "enterprise" ? (
                <p className="mt-5 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Enterprise limits are not represented as unlimited by default. They are defined in
                  the customer contract and implementation plan.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <h3 className="font-display text-xl font-semibold">
                {isCurrentActive ? "Get value from your plan" : "What happens after activation"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                NEXORA keeps the full platform available while guiding you to the controls that
                matter first.
              </p>

              <div className="mt-5 space-y-3">
                {plan.guide.setup.map((item, index) => (
                  <a
                    key={item.title}
                    href={item.href}
                    className="flex gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary/30 text-xs font-semibold text-primary">
                      {index + 1}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{item.title}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    </div>
                  </a>
                ))}
              </div>

              {checkoutError ? (
                <p role="alert" className="mt-4 text-sm text-critical">
                  {checkoutError}
                </p>
              ) : null}

              {isCurrentTrial ? (
                <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                  Your {plan.name} capabilities are already active for the trial. Checkout converts
                  the tier to a paid subscription after Paddle confirms the purchase.
                </div>
              ) : null}

              {plan.key === "enterprise" ? (
                <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Enterprise-specific identity, SIEM, deployment and support options are contracted
                  during onboarding rather than activated by self-service checkout.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-5 sm:px-7">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : onStep(step - 1))}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            {step === 0 ? (
              "Close"
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" /> Back
              </>
            )}
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={() => onStep(step + 1)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : isCurrentActive || plan.key === "enterprise" ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <CheckCircle2 className="h-4 w-4" />
              {isCurrentActive ? "Done" : "Finish review"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onCheckout(plan.key as "solo" | "team")}
              disabled={checkoutPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {checkoutPending
                ? "Opening checkout…"
                : isCurrentTrial
                  ? `Activate ${plan.name}`
                  : `Choose ${plan.name}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Billing() {
  const requested = Route.useSearch().plan;
  const fn = useServerFn(getBillingState);
  const paddleFn = useServerFn(getPaddleCheckout);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [wizardPlan, setWizardPlan] = useState<PlanKey | null>(requested ?? null);
  const [wizardStep, setWizardStep] = useState(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["billing"],
    queryFn: () => fn({}),
  });
  const current = planByKey(data?.subscription?.plan_key);
  const checkout = useMutation({
    mutationFn: async (plan: "solo" | "team") => {
      const result = await paddleFn({ data: { plan, interval } });
      if (!result.enabled) throw new Error("Paddle checkout is not configured yet.");
      return result;
    },
    onSuccess: (config) => openPaddleCheckout(config),
  });

  useEffect(() => {
    if (!data || requested || wizardPlan || data.subscription.status !== "active") return;
    if (typeof window === "undefined") return;
    const key = `nexora-plan-guide:${data.workspace.orgId}:${current.key}`;
    if (!window.localStorage.getItem(key)) {
      setWizardPlan(current.key);
      setWizardStep(0);
    }
  }, [current.key, data, requested, wizardPlan]);

  function openWizard(plan: PlanKey) {
    checkout.reset();
    setWizardPlan(plan);
    setWizardStep(0);
  }

  function closeWizard() {
    if (
      wizardPlan &&
      data?.subscription.status === "active" &&
      data.subscription.plan_key === wizardPlan &&
      typeof window !== "undefined"
    ) {
      window.localStorage.setItem(
        `nexora-plan-guide:${data.workspace.orgId}:${wizardPlan}`,
        "seen",
      );
    }
    setWizardPlan(null);
    setWizardStep(0);
  }

  const targetPlan = wizardPlan ? planByKey(wizardPlan) : null;

  return (
    <div>
      <PageHeader
        title="Plans & Billing"
        subtitle="Choose a tier, see exactly what it adds, then follow a guided setup after activation."
      />

      {targetPlan ? (
        <PlanWizard
          plan={targetPlan}
          current={current}
          status={data?.subscription.status}
          interval={interval}
          step={wizardStep}
          checkoutPending={checkout.isPending}
          checkoutError={checkout.error?.message ?? null}
          onStep={setWizardStep}
          onClose={closeWizard}
          onCheckout={(plan) => checkout.mutate(plan)}
        />
      ) : null}

      {isLoading ? <p role="status">Loading billing status…</p> : null}
      {error ? (
        <p role="alert" className="text-critical">
          {error.message}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <Metric label="Current plan" value={current.name} tone="primary" />
            <Metric label="Status" value={data.subscription.status} />
            <Metric label="Seats" value={`${data.usage.seats} / ${formatLimit(current.seats)}`} />
            <Metric
              label="Requests this month"
              value={`${data.usage.requests.toLocaleString()} / ${formatLimit(current.monthlyRequests)}`}
            />
          </div>

          <Panel className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <div className="text-sm font-medium">
                    {data.subscription.status === "trialing"
                      ? `Explore your ${current.name} trial`
                      : `Get more from ${current.name}`}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  See your included capabilities, limits and recommended setup in a four-step guide.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openWizard(current.key)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Open plan guide
              </button>
            </div>
          </Panel>

          {data.subscription.trial_ends_at ? (
            <Panel className="mb-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="label-caps">Trial</div>
                  <p className="mt-1 text-sm">
                    Team capabilities are active until{" "}
                    {new Date(data.subscription.trial_ends_at).toLocaleDateString()}.
                  </p>
                </div>
                <Tag value={data.subscription.status} />
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label-caps">Billing interval</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Annual billing includes two months free.
          </p>
        </div>
        <div className="flex rounded-md border border-border p-1 text-xs">
          {(["monthly", "annual"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setInterval(value)}
              className={cn(
                "rounded px-3 py-1.5 capitalize",
                interval === value && "bg-primary text-primary-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {checkout.error && !targetPlan ? (
        <p role="alert" className="mb-4 text-sm text-critical">
          {checkout.error.message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const selected = requested === plan.key || current.key === plan.key;
          const currentPlan = current.key === plan.key;
          return (
            <Panel key={plan.key} className={cn(selected && "border-primary/60")}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold">{plan.name}</h2>
                {currentPlan ? <Tag value="current" /> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{plan.audience}</p>
              <div className="mt-4 font-display text-3xl font-semibold">
                {plan.monthlyPriceUsd === null
                  ? "Custom"
                  : `$${plan.monthlyPriceUsd.toLocaleString()}`}
                {plan.monthlyPriceUsd !== null ? (
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                ) : null}
              </div>

              <ul className="mt-5 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => openWizard(plan.key)}
                className={cn(
                  "mt-6 w-full rounded-md px-3 py-2 text-sm font-medium",
                  plan.featured
                    ? "bg-primary text-primary-foreground"
                    : "border border-border hover:bg-accent",
                )}
              >
                {currentPlan
                  ? data?.subscription.status === "trialing"
                    ? "Review & activate"
                    : "Review plan"
                  : `Explore ${plan.name}`}
              </button>
            </Panel>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Need to compare plans publicly?{" "}
        <Link to="/pricing" className="text-primary hover:underline">
          View pricing
        </Link>
        .
      </p>
    </div>
  );
}
