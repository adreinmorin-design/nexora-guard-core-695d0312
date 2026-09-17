import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBudgets } from "@/lib/nexora.functions";
import {
  DataTable,
  Metric,
  PageHeader,
  Tag,
} from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/governance/budgets")({
  head: () => ({
    meta: [
      { title: "Budgets & Quotas — NEXORA" },
      {
        name: "description",
        content:
          "Server-side cost governance: organization budgets, periods and the enforcement action taken when a limit is exceeded.",
      },
      { property: "og:title", content: "Budgets & Quotas — NEXORA" },
      {
        property: "og:description",
        content: "Cost governance and enforcement actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Budgets,
});

function Budgets() {
  const fn = useServerFn(listBudgets);
  const { data } = useQuery({ queryKey: ["budgets"], queryFn: () => fn({}) });
  const budgets = (data?.budgets ?? []) as any[];
  const spend = data?.monthToDateSpend ?? 0;

  return (
    <div>
      <PageHeader
        title="Budgets & Quotas"
        subtitle="Cost is calculated server-side from provider token usage. The browser never supplies spend figures."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label="Month-to-date spend"
          value={`$${spend.toFixed(4)}`}
          tone="primary"
        />
        <Metric
          label="Active budgets"
          value={budgets.filter((b) => b.status === "active").length}
        />
        <Metric
          label="Headroom"
          value={`$${Math.max(0, Number(budgets[0]?.limit_usd ?? 0) - spend).toFixed(2)}`}
        />
      </div>

      <DataTable
        columns={["Budget", "Scope", "Period", "Limit", "On exceed", "Status"]}
        rows={budgets.map((b) => [
          b.name,
          b.scope,
          b.period,
          <span className="tabular-nums">
            ${Number(b.limit_usd).toFixed(2)}
          </span>,
          <Tag value={b.action_on_exceed} kind="decision" />,
          <Tag value={b.status} />,
        ])}
      />
    </div>
  );
}
