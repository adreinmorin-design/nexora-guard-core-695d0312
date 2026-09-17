import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOverview } from "@/lib/nexora.functions";
import { Metric, PageHeader, Panel, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — NEXORA Control Plane" },
      {
        name: "description",
        content:
          "Enterprise AI security dashboard: traffic, blocked requests, findings, spend, policy violations and pending approvals.",
      },
      { property: "og:title", content: "Overview — NEXORA Control Plane" },
      { property: "og:description", content: "AI traffic, security and cost at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

function Overview() {
  const fn = useServerFn(getOverview);
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: () => fn({}),
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading control plane…</p>;
  if (error)
    return <p className="text-sm text-critical">Could not load overview: {String(error)}</p>;
  if (!data) return null;

  const t = data.totals;
  const maxTraffic = Math.max(1, ...data.traffic.map((d) => d.total));

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Deterministic enforcement across every governed AI request in the last 30 days."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="AI Requests" value={t.requests} hint="last 30 days" />
        <Metric label="Blocked" value={t.blocked} tone="critical" hint="never reached a provider" />
        <Metric
          label="Security Findings"
          value={t.openFindings}
          tone={t.criticalFindings > 0 ? "critical" : "high"}
          hint={`${t.criticalFindings} critical`}
        />
        <Metric
          label="Active Agents"
          value={data.totals.activeAgents}
          hint="Registered active identities"
        />
        <Metric label="Spend" value={`$${t.spend.toFixed(4)}`} hint={`budget $${t.budget}`} />
        <Metric label="Policy Violations" value={t.violations} tone="high" />
        <Metric label="Pending Approvals" value={t.pendingApprovals} tone="high" />
        <Metric
          label="Risk Score"
          value={t.riskScore}
          tone={t.riskScore > 60 ? "critical" : t.riskScore > 25 ? "high" : "allow"}
          hint="composite, findings weighted"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="label-caps">AI Traffic</div>
          <div className="mt-4 flex h-40 items-end gap-1">
            {data.traffic.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No governed traffic yet — run a request from the Playground.
              </p>
            ) : (
              data.traffic.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col justify-end gap-0.5" title={d.day}>
                  <div
                    className="w-full rounded-sm bg-critical/70"
                    style={{ height: `${(d.blocked / maxTraffic) * 100}%` }}
                  />
                  <div
                    className="w-full rounded-sm bg-primary/60"
                    style={{ height: `${((d.total - d.blocked) / maxTraffic) * 100}%` }}
                  />
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <div className="label-caps">Decision distribution</div>
          <ul className="mt-4 space-y-2">
            {data.decisionSplit.map((d) => (
              <li key={d.decision} className="flex items-center justify-between text-sm">
                <Tag value={d.decision} kind="decision" />
                <span className="font-mono tabular-nums">{d.count}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel>
          <div className="label-caps">Top models</div>
          <ul className="mt-3 space-y-2 text-sm">
            {data.topModels.length === 0 ? (
              <li className="text-muted-foreground">No model traffic yet.</li>
            ) : (
              data.topModels.map((m) => (
                <li key={m.model} className="flex justify-between gap-3">
                  <span className="truncate font-mono text-xs">{m.model}</span>
                  <span className="tabular-nums">{m.count}</span>
                </li>
              ))
            )}
          </ul>
        </Panel>
        <Panel>
          <div className="label-caps">Enforcement posture</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>{t.activePolicies} active policies</li>
            <li>{t.redacted} redacted requests</li>
            <li>{t.avgLatency} ms average provider latency</li>
            <li>{t.members} operators in this organization</li>
          </ul>
        </Panel>
        <Panel>
          <div className="label-caps">Invariants enforced</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Tenant resolved server-side from session</li>
            <li>Blocked requests never reach a provider</li>
            <li>Redaction applied before egress</li>
            <li>Provider credentials never leave the server</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
