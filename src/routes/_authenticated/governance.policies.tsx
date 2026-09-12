import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listPolicies, savePolicy } from "@/lib/nexora.functions";
import { PageHeader, Panel, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/governance/policies")({
  head: () => ({
    meta: [
      { title: "Policies — NEXORA Governance" },
      {
        name: "description",
        content:
          "Versioned, prioritized, deterministic governance policies with explicit precedence and full change history.",
      },
      { property: "og:title", content: "Policies — NEXORA Governance" },
      { property: "og:description", content: "Deterministic AI governance policies." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Policies,
});

const FIELDS = [
  "detection_category",
  "detection_severity",
  "model_key",
  "model_classification",
  "provider",
  "estimated_cost_usd",
  "monthly_spend_usd",
  "actor_type",
];

const ACTIONS = ["BLOCK", "REQUIRE_APPROVAL", "REDACT", "LOG", "ALLOW"];

type Draft = {
  id: string | null;
  name: string;
  description: string;
  priority: number;
  action: string;
  status: string;
  conditions: Array<{ field: string; op: string; value: string }>;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  description: "",
  priority: 100,
  action: "BLOCK",
  status: "active",
  conditions: [{ field: "detection_category", op: "in", value: "ssn, credit_card" }],
};

function Policies() {
  const listFn = useServerFn(listPolicies);
  const saveFn = useServerFn(savePolicy);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["policies"], queryFn: () => listFn({}) });
  const policies = (data?.policies ?? []) as any[];
  const canGovern = data?.canGovern ?? false;

  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveFn({
        data: {
          id: d.id,
          name: d.name,
          description: d.description,
          priority: Number(d.priority),
          action: d.action as any,
          scope: "organization",
          status: d.status as any,
          conditions: d.conditions
            .filter((c) => c.value.trim())
            .map((c) => ({
              field: c.field,
              op: c.op as any,
              value:
                c.op === "in"
                  ? c.value.split(",").map((v) => v.trim())
                  : c.op === "gt" || c.op === "lt"
                    ? Number(c.value)
                    : c.value.trim(),
            })),
        },
      }),
    onSuccess: () => {
      setDraft(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (e: any) => setError(e?.message ?? "Could not save policy."),
  });

  return (
    <div>
      <PageHeader
        title="Policies"
        subtitle="Precedence is fixed: BLOCK › REQUIRE_APPROVAL › REDACT › LOG › ALLOW. No model participates in this decision."
        actions={
          canGovern ? (
            <button
              onClick={() => setDraft({ ...EMPTY })}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              New policy
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Read-only: no governance role</span>
          )
        }
      />

      {draft ? (
        <Panel className="mb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-caps">Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="label-caps">Description</label>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="label-caps">Priority (lower wins ties)</label>
              <input
                type="number"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="label-caps">Action</label>
              <select
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {ACTIONS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <div className="label-caps">Conditions (all must match)</div>
            {draft.conditions.map((c, i) => (
              <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_2fr_auto]">
                <select
                  value={c.field}
                  onChange={(e) => {
                    const next = [...draft.conditions];
                    next[i] = { ...c, field: e.target.value };
                    setDraft({ ...draft, conditions: next });
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {FIELDS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <select
                  value={c.op}
                  onChange={(e) => {
                    const next = [...draft.conditions];
                    next[i] = { ...c, op: e.target.value };
                    setDraft({ ...draft, conditions: next });
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {["in", "equals", "not_equals", "gt", "lt"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <input
                  value={c.value}
                  onChange={(e) => {
                    const next = [...draft.conditions];
                    next[i] = { ...c, value: e.target.value };
                    setDraft({ ...draft, conditions: next });
                  }}
                  placeholder="comma separated for 'in'"
                  className="rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
                />
                <button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      conditions: draft.conditions.filter((_, j) => j !== i),
                    })
                  }
                  className="rounded-md border border-border px-2 text-xs text-muted-foreground"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setDraft({
                  ...draft,
                  conditions: [
                    ...draft.conditions,
                    { field: "detection_category", op: "in", value: "" },
                  ],
                })
              }
              className="mt-2 text-xs text-primary"
            >
              + Add condition
            </button>
          </div>

          {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}

          <div className="mt-4 flex gap-2">
            <button
              disabled={!draft.name || save.isPending}
              onClick={() => save.mutate(draft)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save new version"}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </Panel>
      ) : null}

      <div className="space-y-3">
        {policies.map((p) => (
          <Panel key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-base font-semibold">{p.name}</h3>
                  <Tag value={p.action} kind="decision" />
                  <Tag value={p.status} />
                  <span className="label-caps">
                    v{p.version} · priority {p.priority}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
                  {(Array.isArray(p.conditions) ? p.conditions : []).length === 0 ? (
                    <li>unconditional</li>
                  ) : (
                    (p.conditions as any[]).map((c, i) => (
                      <li key={i}>
                        IF {c.field} {c.op}{" "}
                        {Array.isArray(c.value) ? c.value.join(" | ") : String(c.value)}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              {canGovern ? (
                <button
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      name: p.name,
                      description: p.description ?? "",
                      priority: p.priority,
                      action: p.action,
                      status: p.status,
                      conditions: (Array.isArray(p.conditions) ? p.conditions : []).map(
                        (c: any) => ({
                          field: c.field,
                          op: c.op,
                          value: Array.isArray(c.value) ? c.value.join(", ") : String(c.value),
                        }),
                      ),
                    })
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Edit
                </button>
              ) : null}
            </div>
          </Panel>
        ))}
      </div>

      <Panel className="mt-6">
        <div className="label-caps">Recent version history</div>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {((data?.versions ?? []) as any[]).map((v) => (
            <li key={v.id} className="font-mono">
              {new Date(v.created_at).toLocaleString()} · v{v.version} · {v.change_note}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
