import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOverview, listRequests } from "@/lib/nexora.functions";
import { DataTable, Metric, PageHeader } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/observability/usage")({
  head: () => ({
    meta: [
      { title: "Usage & Cost — NEXORA" },
      {
        name: "description",
        content:
          "Token usage, spend and latency per model, computed server-side from provider-reported usage.",
      },
      { property: "og:title", content: "Usage & Cost — NEXORA" },
      { property: "og:description", content: "AI usage, cost and latency analytics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Usage,
});

function Usage() {
  const overviewFn = useServerFn(getOverview);
  const requestsFn = useServerFn(listRequests);
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => overviewFn({}) });
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => requestsFn({}) });

  const rows = (requests.data ?? []) as any[];
  const byModel = new Map<
    string,
    { model: string; calls: number; input: number; output: number; cost: number; latency: number }
  >();
  for (const r of rows) {
    const key = r.model ?? "unknown";
    const e =
      byModel.get(key) ?? { model: key, calls: 0, input: 0, output: 0, cost: 0, latency: 0 };
    e.calls += 1;
    e.input += r.input_tokens;
    e.output += r.output_tokens;
    e.cost += Number(r.cost_usd);
    e.latency += r.latency_ms;
    byModel.set(key, e);
  }
  const models = [...byModel.values()].sort((a, b) => b.cost - a.cost);
  const t = overview.data?.totals;

  return (
    <div>
      <PageHeader
        title="Usage & Cost"
        subtitle="Spend is derived from registered model pricing and provider-reported token counts, never from client input."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Metric label="Requests" value={t?.requests ?? 0} />
        <Metric label="Spend" value={`$${(t?.spend ?? 0).toFixed(4)}`} tone="primary" />
        <Metric
          label="Tokens"
          value={models.reduce((s, m) => s + m.input + m.output, 0).toLocaleString()}
        />
        <Metric label="Avg latency" value={`${t?.avgLatency ?? 0} ms`} />
      </div>
      <DataTable
        columns={["Model", "Calls", "Input tokens", "Output tokens", "Cost", "Avg latency"]}
        rows={models.map((m) => [
          <span className="font-mono text-xs">{m.model}</span>,
          <span className="tabular-nums">{m.calls}</span>,
          <span className="tabular-nums">{m.input.toLocaleString()}</span>,
          <span className="tabular-nums">{m.output.toLocaleString()}</span>,
          <span className="tabular-nums">${m.cost.toFixed(6)}</span>,
          <span className="tabular-nums">{Math.round(m.latency / Math.max(1, m.calls))} ms</span>,
        ])}
      />
    </div>
  );
}
