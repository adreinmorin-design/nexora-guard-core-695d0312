import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { useState } from "react";
import { getBillingState, getPaddleCheckout } from "@/lib/nexora.functions";
import { PLANS, formatLimit, planByKey, type PlanKey } from "@/lib/nexora/plans";
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
    script.onload = () => (browser.Paddle ? resolve(browser.Paddle) : reject(new Error("Paddle failed to load.")));
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

function Billing() {
  const requested = Route.useSearch().plan;
  const fn = useServerFn(getBillingState);
  const paddleFn = useServerFn(getPaddleCheckout);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const { data, isLoading, error } = useQuery({ queryKey: ["billing"], queryFn: () => fn({}) });
  const current = planByKey(data?.subscription?.plan_key);
  const checkout = useMutation({
    mutationFn: async (plan: "solo" | "team") => {
      const result = await paddleFn({ data: { plan, interval } });
      if (!result.enabled) throw new Error("Paddle checkout is not configured yet.");
      return result;
    },
    onSuccess: (config) => openPaddleCheckout(config),
  });

  return (
    <div>
      <PageHeader
        title="Plans & Billing"
        subtitle="Platform subscription limits are enforced independently from model-provider budgets and charges."
      />
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
          <p className="mt-1 text-xs text-muted-foreground">Annual billing includes two months free.</p>
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

      {checkout.error ? (
        <p role="alert" className="mb-4 text-sm text-critical">
          {checkout.error.message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const selected = requested === plan.key || current.key === plan.key;
          return (
            <Panel key={plan.key} className={cn(selected && "border-primary/60")}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold">{plan.name}</h2>
                {current.key === plan.key ? <Tag value="current" /> : null}
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
              <div className="mt-6 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                {plan.key === "enterprise"
                  ? "Enterprise contracting becomes available after the billing account is connected."
                  : "Secure Paddle checkout uses a server-signed organization identity; entitlements change only after a verified webhook."}
              </div>
              {plan.key === "enterprise" ? (
                <button disabled className="mt-4 w-full rounded-md border border-border px-3 py-2 text-sm opacity-60">
                  Contact sales
                </button>
              ) : (
                <button
                  onClick={() => checkout.mutate(plan.key as "solo" | "team")}
                  disabled={checkout.isPending}
                  className="mt-4 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {checkout.isPending ? "Opening checkout…" : `Choose ${plan.name}`}
                </button>
              )}
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
