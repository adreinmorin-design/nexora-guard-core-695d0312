import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getOverview } from "@/lib/nexora.functions";
import { Metric, PageHeader, Panel, Tag } from "@/components/nexora/primitives";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: () => fn({}),
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading overview…</p>;
  if (error)
    return <p className="text-sm text-critical">Could not load overview: {String(error)}</p>;
  if (!data) return null;

  const t = data.totals;
  const maxTraffic = Math.max(1, ...data.traffic.map((d) => d.total));

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Overview" subtitle="Your AI security, usage and spend in one place." />
        <div className="flex flex-wrap gap-2">
          <Link
            to="/gateway/playground"
            className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Run a request
          </Link>
          <Link
            to="/connect-agent"
            className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Connect agent
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Requests" value={t.requests} hint="last 30 days" />
        <Metric
          label="Blocked"
          value={t.blocked}
          tone={t.blocked > 0 ? "critical" : "allow"}
          hint="stopped before provider"
        />
        <Metric
          label="Open findings"
          value={t.openFindings}
          tone={t.criticalFindings > 0 ? "critical" : t.openFindings > 0 ? "high" : "allow"}
          hint={t.criticalFindings > 0 ? String(t.criticalFindings) + " critical" : "no critical findings"}
        />
        <Metric label="Spend" value={"$" + t.spend.toFixed(2)} hint={"$" + t.budget + " budget"} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Traffic</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Allowed and blocked requests</div>
            </div>
            <Link to="/gateway/requests" className="text-xs font-medium text-primary hover:underline">
              View requests
            </Link>
          </div>
          <div className="mt-5 flex h-44 items-end gap-1">
            {data.traffic.length === 0 ? (
              <div className="grid h-full w-full place-items-center rounded-lg border border-dashed border-border">
                <p className="max-w-xs text-center text-sm text-muted-foreground">
                  No traffic yet. Run a request from the Playground to see activity here.
                </p>
              </div>
            ) : (
              data.traffic.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col justify-end gap-0.5" title={d.day}>
                  <div
                    className="w-full rounded-sm bg-critical/65"
                    style={{ height: String((d.blocked / maxTraffic) * 100) + "%" }}
                  />
                  <div
                    className="w-full rounded-sm bg-primary/55"
                    style={{ height: String(((d.total - d.blocked) / maxTraffic) * 100) + "%" }}
                  />
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <div className="text-sm font-medium">Control status</div>
          <div className="mt-4 divide-y divide-border/70">
            {[
              ["Active agents", t.activeAgents],
              ["Policy violations", t.violations],
              ["Pending approvals", t.pendingApprovals],
              ["Risk score", t.riskScore],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="font-mono text-sm font-medium tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setDetailsOpen((value) => !value)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3 text-left transition-colors hover:bg-accent/50"
          aria-expanded={detailsOpen}
        >
          <div>
            <div className="text-sm font-medium">Advanced details</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Decisions, models, policy posture and enforcement guarantees
            </div>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              detailsOpen && "rotate-180",
            )}
          />
        </button>

        {detailsOpen ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <Panel>
              <div className="text-sm font-medium">Decisions</div>
              <ul className="mt-4 space-y-2">
                {data.decisionSplit.map((d) => (
                  <li key={d.decision} className="flex items-center justify-between text-sm">
                    <Tag value={d.decision} kind="decision" />
                    <span className="font-mono tabular-nums">{d.count}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel>
              <div className="text-sm font-medium">Top models</div>
              <ul className="mt-4 space-y-2 text-sm">
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
              <div className="text-sm font-medium">Enforcement</div>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>{t.activePolicies} active policies</li>
                <li>{t.redacted} redacted requests</li>
                <li>{t.avgLatency} ms average latency</li>
                <li>{t.members} organization operators</li>
              </ul>
            </Panel>

            <Panel>
              <div className="text-sm font-medium">Security guarantees</div>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>Tenant resolved server-side</li>
                <li>Blocked requests stop before provider egress</li>
                <li>Redaction runs before external calls</li>
                <li>Provider credentials stay server-side</li>
              </ul>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
