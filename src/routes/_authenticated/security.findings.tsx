import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listFindings } from "@/lib/nexora.functions";
import { DataTable, PageHeader, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/security/findings")({
  head: () => ({
    meta: [
      { title: "Security Findings — NEXORA" },
      {
        name: "description",
        content:
          "Security findings with severity, affected resource, evidence, detection source and remediation guidance.",
      },
      { property: "og:title", content: "Security Findings — NEXORA" },
      {
        property: "og:description",
        content: "AI security findings and remediation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Findings,
});

function Findings() {
  const fn = useServerFn(listFindings);
  const [severity, setSeverity] = useState("ALL");
  const { data } = useQuery({ queryKey: ["findings"], queryFn: () => fn({}) });
  const rows = ((data ?? []) as any[]).filter((f) => severity === "ALL" || f.severity === severity);

  return (
    <div>
      <PageHeader
        title="Findings"
        subtitle="Findings are raised by deterministic inspection of prompts and model responses."
        actions={
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            {["ALL", "critical", "high", "medium", "low", "info"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        }
      />
      <DataTable
        columns={["Time", "Severity", "Finding", "Resource", "Status", "Remediation"]}
        rows={rows.map((f) => [
          <span className="font-mono text-xs">{new Date(f.created_at).toLocaleString()}</span>,
          <Tag value={f.severity} kind="severity" />,
          f.title,
          <span className="font-mono text-xs">{f.affected_resource}</span>,
          <Tag value={f.status} />,
          <span className="text-xs text-muted-foreground">{f.remediation}</span>,
        ])}
      />
    </div>
  );
}
