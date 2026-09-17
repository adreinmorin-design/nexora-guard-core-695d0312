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
  const { data, error, isLoading } = useQuery({ queryKey: ["catalog"], queryFn: () => fn({}) });
  const providers = (data?.providers ?? []) as any[];

  return (
    <div>
      <PageHeader
        title="Providers"
        subtitle="OpenAI, Anthropic and Google use native adapters. Other vendors use the OpenAI-compatible adapter when a base URL and server credential are configured."
      />
      {isLoading && <p role="status">Loading provider status…</p>}
      {error && <p role="alert">{error.message}</p>}
      <DataTable
        columns={["Provider", "Vendor", "Adapter", "Credentials", "Server variable", "Status"]}
        rows={providers.map((p) => [
          p.name,
          <span className="font-mono text-xs">{p.vendor}</span>,
          p.adapter,
          <Tag value={p.credential_state} />,
          <span className="font-mono text-[10px]">{p.credential_variable}</span>,
          <Tag value={p.status} />,
        ])}
      />
      <p className="mt-4 text-xs text-muted-foreground">
        CONFIGURED means the server can see a credential, not that the provider accepted it or that
        a model is entitled. Run a governed request after configuring a model.
      </p>
    </div>
  );
}
