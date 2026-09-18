import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { decideApproval, listApprovals } from "@/lib/nexora.functions";
import { EmptyState, PageHeader, Panel, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals — NEXORA" },
      {
        name: "description",
        content:
          "Human-in-the-loop approvals for high-risk AI actions, with requester, risk, expiry and separation of duties.",
      },
      { property: "og:title", content: "Approvals — NEXORA" },
      { property: "og:description", content: "Human approval queue for high-risk AI actions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Approvals,
});

function Approvals() {
  const listFn = useServerFn(listApprovals);
  const decideFn = useServerFn(decideApproval);
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ["approvals"], queryFn: () => listFn({}) });
  const approvals = (data?.approvals ?? []) as any[];
  const canDecide = data?.canDecide ?? false;

  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) =>
      decideFn({ data: { id: v.id, approve: v.approve } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Approval requests are created by the gateway before any provider call. A requester can never approve their own request."
      />

      {approvals.length === 0 ? (
        <EmptyState
          title="No approval requests"
          body="When a request matches a REQUIRE_APPROVAL policy, it is held here instead of reaching a provider."
        />
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <Panel key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-semibold">{a.action}</h3>
                    <Tag value={a.risk} kind="severity" />
                    <Tag value={a.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{a.reason}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    target {a.target ?? "—"} · requested{" "}
                    {new Date(a.created_at).toLocaleString()} · expires{" "}
                    {new Date(a.expires_at).toLocaleString()}
                  </p>
                </div>
                {canDecide && a.status === "pending" ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide.mutate({ id: a.id, approve: true })}
                      disabled={decide.isPending}
                      className="rounded-md border border-allow/40 bg-allow/10 px-3 py-1.5 text-xs text-allow disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => decide.mutate({ id: a.id, approve: false })}
                      disabled={decide.isPending}
                      className="rounded-md border border-critical/40 bg-critical/10 px-3 py-1.5 text-xs text-critical disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>
      )}
      {decide.error ? (
        <p className="mt-3 text-sm text-critical">{String((decide.error as any).message)}</p>
      ) : null}
    </div>
  );
}
