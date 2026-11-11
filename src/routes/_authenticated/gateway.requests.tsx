import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listRequests } from "@/lib/nexora.functions";
import { DataTable, PageHeader, Tag } from "@/components/nexora/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FailureSummary } from "@/components/nexora/FailureSummary";
import { isFailedRequest } from "@/lib/nexora/failure-evidence";

export const Route = createFileRoute("/_authenticated/gateway/requests")({
  head: () => ({
    meta: [
      { title: "Requests — NEXORA AI Gateway" },
      {
        name: "description",
        content:
          "Every governed AI request with its decision, matched policy, tokens, cost, latency and status.",
      },
      { property: "og:title", content: "Requests — NEXORA AI Gateway" },
      { property: "og:description", content: "Governed AI traffic log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Requests,
});

function Requests() {
  const fn = useServerFn(listRequests);
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState<any>(null);
  const { data } = useQuery({ queryKey: ["requests"], queryFn: () => fn({}) });

  const rows = ((data ?? []) as any[]).filter((r) => filter === "ALL" || r.decision === filter);

  return (
    <div>
      <PageHeader
        title="Requests"
        subtitle="Request records are append-only and scoped to your organization."
        actions={
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            {["ALL", "ALLOW", "LOG", "REDACT", "REQUIRE_APPROVAL", "BLOCK"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        }
      />

      <DataTable
        columns={["Time", "Decision", "Model", "Provider", "Tokens", "Cost", "Latency", "Reason"]}
        rows={rows.map((r) => [
          <span className="font-mono text-xs">{new Date(r.created_at).toLocaleString()}</span>,
          <Tag value={r.decision} kind="decision" />,
          <span className="font-mono text-xs">{r.model}</span>,
          r.provider ?? "—",
          <span className="tabular-nums">
            {r.input_tokens}/{r.output_tokens}
          </span>,
          <span className="tabular-nums">${Number(r.cost_usd).toFixed(6)}</span>,
          <span className="tabular-nums">{r.latency_ms} ms</span>,
          <div className="space-y-2"><span className="text-xs text-muted-foreground">{r.reason}</span>
            {isFailedRequest(r.status) && <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>View failure</Button>}
          </div>,
        ])}
      />
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Request details</DialogTitle><DialogDescription>{selected ? new Date(selected.created_at).toLocaleString() : ""}</DialogDescription></DialogHeader>
          {selected && <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><Tag value={selected.decision} kind="decision" /><Tag value={selected.status} /></div>
            <p className="break-words text-sm">{selected.reason}</p>
            <FailureSummary key={selected.id} requestId={selected.id} />
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
