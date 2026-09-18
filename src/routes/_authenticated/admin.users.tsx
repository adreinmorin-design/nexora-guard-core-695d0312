import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMembers } from "@/lib/nexora.functions";
import { DataTable, PageHeader, Panel, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "Users & Roles — NEXORA Administration" },
      {
        name: "description",
        content:
          "Organization members and their least-privilege roles. Roles are stored separately from profiles and enforced in the database.",
      },
      { property: "og:title", content: "Users & Roles — NEXORA Administration" },
      { property: "og:description", content: "Least-privilege role administration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Users,
});

function Users() {
  const fn = useServerFn(listMembers);
  const { data } = useQuery({ queryKey: ["members"], queryFn: () => fn({}) });
  const members = (data?.members ?? []) as any[];

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Roles live in a dedicated membership table and are checked by database policies, never by the browser."
      />
      <DataTable
        columns={["Member", "Email", "Role", "Since"]}
        rows={members.map((m) => [
          m.full_name ?? "—",
          <span className="font-mono text-xs">{m.email ?? "—"}</span>,
          <Tag value={m.role} />,
          <span className="font-mono text-xs">{new Date(m.created_at).toLocaleDateString()}</span>,
        ])}
      />
      <Panel className="mt-4">
        <div className="label-caps">Identity</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign-in currently uses email and password. Enterprise single sign-on (OIDC, Microsoft
          Entra ID, SAML) attaches to the same identity layer and the same role model without
          changing enforcement.
        </p>
      </Panel>
    </div>
  );
}
