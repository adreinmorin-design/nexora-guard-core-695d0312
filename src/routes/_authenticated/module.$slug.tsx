import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DataTable, NotConfigured, PageHeader, Panel, Tag } from "@/components/nexora/primitives";
import { listControlPlane } from "@/lib/nexora.functions";

export const Route = createFileRoute("/_authenticated/module/$slug")({
  head: () => ({
    meta: [
      { title: "Module — NEXORA Control Plane" },
      {
        name: "description",
        content:
          "This NEXORA module is part of the architecture but has no server-side enforcement wired up yet.",
      },
      { property: "og:title", content: "Module — NEXORA Control Plane" },
      { property: "og:description", content: "Planned NEXORA control-plane module." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ModulePage,
});

const NOTES: Record<string, string> = {
  "agent-registry":
    "Agent identity, ownership, capability grants and lifecycle. Agents will authenticate with their own credentials and may never grant themselves capabilities.",
  "agent-tasks": "Task execution traces, tool calls and per-step authorization decisions.",
  "agent-tools": "Tool catalogue with capability scopes and per-tool approval requirements.",
  "mcp-gateway":
    "MCP server registry, tool discovery, and per-tool policy enforcement between agents and MCP servers.",
  threats: "Correlated threat activity across requests, agents and tools.",
  "security-tests": "Repeatable security test suites executed against governed models and agents.",
  "attack-simulation":
    "Controlled adversarial simulations — prompt injection, exfiltration and jailbreak campaigns with scored results.",
  latency: "Per-provider and per-model latency distribution and error budgets.",
  errors: "Provider and gateway error analytics.",
  integrations: "SIEM, Slack, Jira, identity providers and external provider credentials.",
  settings: "Organization settings, retention, redaction defaults and residency.",
};

function humanize(slug: string) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function ModulePage() {
  const { slug } = useParams({ from: "/_authenticated/module/$slug" });
  const fn = useServerFn(listControlPlane);
  const liveModules = new Set([
    "agent-registry",
    "agent-tools",
    "mcp-gateway",
    "threats",
    "security-tests",
    "attack-simulation",
    "latency",
    "errors",
  ]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["control-plane", slug],
    queryFn: () => fn({ data: { module: slug } }),
    enabled: liveModules.has(slug),
    retry: false,
  });
  if (liveModules.has(slug) && !isLoading && !error && data) {
    const rows = (data.rows ?? []) as any[];
    const columns =
      slug === "agent-registry"
        ? ["Name", "Slug", "Status", "Created"]
        : slug === "mcp-gateway"
          ? ["Name", "Endpoint", "Transport", "Status"]
          : slug === "latency" || slug === "errors"
            ? ["Model", "Decision", "Status", "Latency"]
            : ["Time", "Action", "Resource", "Result"];
    return (
      <div>
        <PageHeader
          title={humanize(slug)}
          subtitle={NOTES[slug] ?? "Live tenant-scoped control-plane data."}
        />
        {rows.length === 0 ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              No records yet. This module is connected and ready for data.
            </p>
          </Panel>
        ) : (
          <DataTable
            columns={columns}
            rows={rows.map((r) =>
              slug === "agent-registry"
                ? [
                    r.name,
                    <span className="font-mono text-xs">{r.slug}</span>,
                    <Tag value={r.status} />,
                    new Date(r.created_at).toLocaleString(),
                  ]
                : slug === "mcp-gateway"
                  ? [
                      r.name,
                      <span className="font-mono text-xs">{r.url}</span>,
                      r.transport,
                      <Tag value={r.status} />,
                    ]
                  : slug === "latency" || slug === "errors"
                    ? [
                        r.model,
                        <Tag value={r.decision} kind="decision" />,
                        r.status,
                        (r.latency_ms ?? 0) + " ms",
                      ]
                    : [new Date(r.created_at).toLocaleString(), r.action, r.resource, r.result],
            )}
          />
        )}
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title={humanize(slug)}
        subtitle="NEXORA never shows placeholder or simulated data for modules that are not enforced server-side."
      />
      <NotConfigured
        module={humanize(slug)}
        note={
          NOTES[slug] ??
          "This module is part of the NEXORA architecture but is not implemented yet. No data is displayed until enforcement exists server-side."
        }
      />
    </div>
  );
}
