import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCatalog } from "@/lib/nexora.functions";
import { DataTable, PageHeader, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/gateway/providers")({
  head: () => ({
    meta: [
      { title: "Providers — NEXORA AI Gateway" },
      {
        name: "description",
        content:
          "Registered AI providers, their credential posture and lifecycle status. Credentials are held server-side only.",
      },
      { property: "og:title", content: "Providers — NEXORA AI Gateway" },
      { property: "og:description", content: "Provider registry and credential posture." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Providers,
});

function Providers() {
  const fn = useServerFn(listCatalog);
  const { data } = useQuery({ queryKey: ["catalog"], queryFn: () => fn({}) });
  const providers = (data?.providers ?? []) as any[];

  return (
    <div>
      <PageHeader
        title="Providers"
        subtitle="Provider credentials are never exposed to the browser, to logs or to audit records. Vendors without a configured credential posture are marked NOT_CONFIGURED and are refused at the gateway."
      />
      <DataTable
        columns={["Provider", "Vendor", "Credentials", "Region", "Status"]}
        rows={providers.map((p) => [
          p.name,
          <span className="font-mono text-xs">{p.vendor}</span>,
          <Tag value={p.credential_state} />,
          p.region ?? "—",
          <Tag value={p.status} />,
        ])}
      />
    </div>
  );
}
