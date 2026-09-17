import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { getBillingState } from "@/lib/nexora.functions";
import { PLANS, formatLimit, planByKey, type PlanKey } from "@/lib/nexora/plans";
import { Metric, PageHeader, Panel, Tag } from "@/components/nexora/primitives";
import { cn } from "@/lib/utils";

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
  const { data, isLoading, error } = useQuery({ queryKey: ["billing"], queryFn: () => fn({}) });
  const current = planByKey(data?.subscription?.plan_key);

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
                  : "Checkout becomes available after Paddle is connected and the plan price is provisioned."}
              </div>
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
