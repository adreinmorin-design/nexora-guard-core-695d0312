import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAudit } from "@/lib/nexora.functions";
import { DataTable, PageHeader, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — NEXORA" },
      {
        name: "description",
        content:
          "Append-only audit trail of every governance action, decision and administrative change in the control plane.",
      },
      { property: "og:title", content: "Audit Log — NEXORA" },
      { property: "og:description", content: "Append-only governance audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Audit,
});

function Audit() {
  const fn = useServerFn(listAudit);
  const { data } = useQuery({ queryKey: ["audit"], queryFn: () => fn({}) });
  const rows = (data ?? []) as any[];

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Audit records cannot be updated or deleted — the database denies both operations for every role."
      />
      <DataTable
        columns={["Time", "Actor", "Action", "Resource", "Decision", "Risk", "Result", "Source"]}
        rows={rows.map((e) => [
          <span className="font-mono text-xs">{new Date(e.created_at).toLocaleString()}</span>,
          <span className="font-mono text-xs">{e.actor_type}</span>,
          e.action,
          <span className="font-mono text-xs">
            {e.resource}
            {e.resource_id ? `:${String(e.resource_id).slice(0, 8)}` : ""}
          </span>,
          e.decision ? <Tag value={e.decision} kind="decision" /> : "—",
          <Tag value={e.risk} kind="severity" />,
          e.result,
          e.source,
        ])}
      />
    </div>
  );
}
