import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCatalog } from "@/lib/nexora.functions";
import { DataTable, PageHeader, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/gateway/models")({
  head: () => ({
    meta: [
      { title: "Model Registry — NEXORA" },
      {
        name: "description",
        content:
          "Approved models with pricing metadata, security classification, context window and lifecycle status.",
      },
      { property: "og:title", content: "Model Registry — NEXORA" },
      { property: "og:description", content: "Approved models and model controls." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Models,
});

function Models() {
  const fn = useServerFn(listCatalog);
  const { data } = useQuery({ queryKey: ["catalog"], queryFn: () => fn({}) });
  const models = (data?.models ?? []) as any[];

  return (
    <div>
      <PageHeader
        title="Model Registry & Controls"
        subtitle="A model that is not registered and active in this organization is blocked at the gateway before any provider call."
      />
      <DataTable
        columns={[
          "Model",
          "Provider",
          "Key",
          "Classification",
          "Input /1k",
          "Output /1k",
          "Execution",
        ]}
        rows={models.map((m) => [
          m.display_name,
          m.provider_vendor,
          <span className="font-mono text-xs">{m.model_key}</span>,
          <Tag value={m.classification} />,
          <span className="tabular-nums">${Number(m.input_cost_per_1k).toFixed(5)}</span>,
          <span className="tabular-nums">${Number(m.output_cost_per_1k).toFixed(5)}</span>,
          <Tag value={m.execution_state === "CONFIGURED" ? m.status : "NOT_CONFIGURED"} />,
        ])}
      />
    </div>
  );
}
