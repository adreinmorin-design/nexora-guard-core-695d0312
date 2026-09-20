import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Bot,
  CirclePower,
  DollarSign,
  Network,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import {
  getAdminAiControl,
  updateAdminAiControl,
  type AiAdminMutation,
} from "@/lib/nexora.functions";
import { PageHeader, Panel, Tag } from "@/components/nexora/primitives";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/ai-control")({
  head: () => ({
    meta: [
      { title: "AI Administration — NEXORA" },
      {
        name: "description",
        content:
          "Organization-wide AI execution controls for providers, models, agents, budgets and emergency suspension.",
      },
    ],
  }),
  component: AdminAiControl,
});

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

function AdminAiControl() {
  const queryClient = useQueryClient();
  const get = useServerFn(getAdminAiControl);
  const update = useServerFn(updateAdminAiControl);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-ai-control"],
    queryFn: () => get({}),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (input: AiAdminMutation) => update({ data: input }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-ai-control"] }),
        queryClient.invalidateQueries({ queryKey: ["live-execution-control"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
      ]);
    },
  });

  const controls = data?.controls;
  const [draft, setDraft] = useState<{
    executionEnabled?: boolean;
    consoleEnabled?: boolean;
    agentsEnabled?: boolean;
    maxRequestCostUsd?: string;
  }>({});

  const executionEnabled = draft.executionEnabled ?? Boolean(controls?.execution_enabled ?? true);
  const consoleEnabled = draft.consoleEnabled ?? Boolean(controls?.console_enabled ?? true);
  const agentsEnabled = draft.agentsEnabled ?? Boolean(controls?.agents_enabled ?? true);
  const costValue =
    draft.maxRequestCostUsd ??
    (controls?.max_request_cost_usd == null ? "" : String(controls.max_request_cost_usd));

  function saveGlobal() {
    mutation.mutate({
      action: "global-controls",
      executionEnabled,
      consoleEnabled,
      agentsEnabled,
      maxRequestCostUsd: costValue.trim() === "" ? null : Number(costValue),
    });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading AI controls…</p>;
  if (error) return <p role="alert" className="text-sm text-critical">{error.message}</p>;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="AI Administration"
          subtitle="Organization-owner controls for every governed AI execution path."
        />
        <Link
          to="/execution-control"
          className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Open live execution
        </Link>
      </div>

      {mutation.error ? <p role="alert" className="mb-4 text-sm text-critical">{mutation.error.message}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Panel>
          <div className="flex items-center gap-2">
            <CirclePower className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Master execution controls</h2>
          </div>
          <div className="mt-4 grid gap-3">
            <Toggle
              checked={executionEnabled}
              onChange={(value) => setDraft((current) => ({ ...current, executionEnabled: value }))}
              label="Allow AI execution"
              description="Emergency organization-wide kill switch. When off, model and tool execution fail closed."
            />
            <Toggle
              checked={consoleEnabled}
              onChange={(value) => setDraft((current) => ({ ...current, consoleEnabled: value }))}
              label="Allow operator console requests"
              description="Controls requests initiated by authenticated human operators."
            />
            <Toggle
              checked={agentsEnabled}
              onChange={(value) => setDraft((current) => ({ ...current, agentsEnabled: value }))}
              label="Allow agent execution"
              description="Controls all enrolled agent model and MCP execution paths."
            />
          </div>

          <div className="mt-4 rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm font-medium">Per-request cost ceiling</div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Requests whose conservative preflight estimate exceeds this amount are blocked before provider dispatch.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                aria-label="Maximum cost per request"
                inputMode="decimal"
                value={costValue}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, maxRequestCostUsd: event.target.value }))
                }
                placeholder="No ceiling"
                className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={saveGlobal}
                disabled={mutation.isPending || (costValue !== "" && !Number.isFinite(Number(costValue)))}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Save controls
              </button>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Current posture</h2>
          </div>
          <div className="mt-4 space-y-3">
            {[
              ["Organization AI", executionEnabled ? "enabled" : "suspended"],
              ["Console", consoleEnabled ? "enabled" : "suspended"],
              ["Agents", agentsEnabled ? "enabled" : "suspended"],
              ["Providers", String(data.providers.filter((item: any) => item.status === "active").length) + " active"],
              ["Models", String(data.models.filter((item: any) => item.status === "active").length) + " active"],
              ["Agents enrolled", String(data.agents.length)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-border/70 pb-3 last:border-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-critical/25 bg-critical/5 p-3">
            <div className="text-xs font-semibold text-critical">Emergency action</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Suspending organization AI stops new governed execution without deleting configuration or audit history.
            </p>
            <button
              type="button"
              onClick={() =>
                mutation.mutate({
                  action: "global-controls",
                  executionEnabled: false,
                  consoleEnabled,
                  agentsEnabled,
                  maxRequestCostUsd: costValue.trim() === "" ? null : Number(costValue),
                })
              }
              className="mt-3 rounded-md border border-critical/30 px-3 py-2 text-xs font-medium text-critical hover:bg-critical/10"
            >
              Suspend all AI execution
            </button>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Providers</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Suspending a provider blocks every model routed through it before egress.
          </p>
          <div className="mt-4 space-y-2">
            {data.providers.map((provider: any) => (
              <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <div className="text-sm font-medium">{provider.name}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">{provider.vendor}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    mutation.mutate({
                      action: "provider-status",
                      id: provider.id,
                      status: provider.status === "active" ? "suspended" : "active",
                    })
                  }
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  <Tag value={provider.status} />
                  {provider.status === "active" ? "Suspend" : "Enable"}
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Models</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Only active registered models can be selected by the gateway.
          </p>
          <div className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {data.models.map((model: any) => (
              <div key={model.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{model.display_name}</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{model.model_key}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    mutation.mutate({
                      action: "model-status",
                      id: model.id,
                      status: model.status === "active" ? "suspended" : "active",
                    })
                  }
                  className="flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  <Tag value={model.status} />
                  {model.status === "active" ? "Suspend" : "Enable"}
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Agents</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Suspend a specific identity immediately without revoking the rest of the organization.
          </p>
          <div className="mt-4 space-y-2">
            {data.agents.length ? data.agents.map((agent: any) => (
              <div key={agent.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <div className="text-sm font-medium">{agent.name}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">{agent.slug}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    mutation.mutate({
                      action: "agent-status",
                      id: agent.id,
                      status: agent.status === "active" ? "suspended" : "active",
                    })
                  }
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  <Tag value={agent.status} />
                  {agent.status === "active" ? "Suspend" : "Enable"}
                </button>
              </div>
            )) : <p className="text-sm text-muted-foreground">No enrolled agents yet.</p>}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Organization budgets</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the monthly budget envelope enforced by the gateway admission path.
          </p>
          <div className="mt-4 space-y-3">
            {data.budgets.map((budget: any) => (
              <BudgetEditor
                key={budget.id}
                budget={budget}
                disabled={mutation.isPending}
                onSave={(limitUsd) =>
                  mutation.mutate({ action: "budget-limit", id: budget.id, limitUsd })
                }
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function BudgetEditor({
  budget,
  disabled,
  onSave,
}: {
  budget: any;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(String(budget.limit_usd));
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{budget.name}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            On exceed: {String(budget.action_on_exceed).replaceAll("_", " ")}
          </div>
        </div>
        <Tag value={budget.status} />
      </div>
      <div className="mt-3 flex gap-2">
        <input
          aria-label={budget.name + " limit"}
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => onSave(Number(value))}
          disabled={disabled || !Number.isFinite(Number(value)) || Number(value) < 0}
          className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Update
        </button>
      </div>
    </div>
  );
}
