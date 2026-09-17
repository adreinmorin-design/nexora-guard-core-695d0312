import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFindings } from "@/lib/nexora.functions";
import {
  DataTable,
  PageHeader,
  Panel,
  Tag,
} from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/governance/dlp")({
  head: () => ({
    meta: [
      { title: "DLP & Data Protection — NEXORA" },
      {
        name: "description",
        content:
          "Detection coverage for personal data, secrets and prompt injection, with the action each category triggers.",
      },
      { property: "og:title", content: "DLP & Data Protection — NEXORA" },
      {
        property: "og:description",
        content: "Data protection coverage and detections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dlp,
});

const COVERAGE = [
  {
    group: "Personal data",
    items: "Email, phone, SSN, payment card, IBAN, IP address",
  },
  {
    group: "Secrets",
    items:
      "Provider API keys, private keys, JWTs, connection strings, credential assignments",
  },
  {
    group: "Adversarial input",
    items:
      "Instruction override, guardrail bypass, system-prompt extraction, exfiltration attempts, role reassignment",
  },
];

function Dlp() {
  const fn = useServerFn(listFindings);
  const { data } = useQuery({ queryKey: ["findings"], queryFn: () => fn({}) });
  const rows = ((data ?? []) as any[]).slice(0, 50);

  return (
    <div>
      <PageHeader
        title="DLP & Data Protection"
        subtitle="Detection is pattern-based and imperfect by design — every finding carries a confidence score and its detection source. Actions are decided by policy, not by the detector."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {COVERAGE.map((c) => (
          <Panel key={c.group}>
            <div className="label-caps">{c.group}</div>
            <p className="mt-2 text-sm text-muted-foreground">{c.items}</p>
          </Panel>
        ))}
      </div>

      <h2 className="mt-8 mb-3 font-display text-lg font-semibold">
        Recent detections
      </h2>
      <DataTable
        columns={[
          "Time",
          "Severity",
          "Category",
          "Detection",
          "Confidence",
          "Source",
          "Stage",
        ]}
        rows={rows.map((f) => [
          <span className="font-mono text-xs">
            {new Date(f.created_at).toLocaleString()}
          </span>,
          <Tag value={f.severity} kind="severity" />,
          <span className="font-mono text-xs">{f.category}</span>,
          f.title,
          <span className="tabular-nums">
            {Math.round(Number(f.confidence ?? 0) * 100)}%
          </span>,
          f.detection_source,
          (f.evidence as any)?.stage ?? "—",
        ])}
      />
    </div>
  );
}
