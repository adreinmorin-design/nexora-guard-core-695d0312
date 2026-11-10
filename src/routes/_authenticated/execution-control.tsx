import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  BadgeCheck,
  Ban,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  DollarSign,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Radar,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { getLiveExecutionControl } from "@/lib/nexora.functions";
import { PageHeader, Panel, Tag } from "@/components/nexora/primitives";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/execution-control")({
  head: () => ({
    meta: [
      { title: "Live Agent Execution — NEXORA" },
      {
        name: "description",
        content:
          "Watch governed AI requests move through identity, permissions, data protection, budget, provider and execution controls.",
      },
      { property: "og:title", content: "Live Agent Execution — NEXORA" },
      {
        property: "og:description",
        content: "Inspect governed AI execution decisions and audit evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LiveExecutionControl,
});

const STAGES = [
  { key: "identity", label: "Identity", icon: Fingerprint },
  { key: "permissions", label: "Permissions", icon: KeyRound },
  { key: "pii", label: "PII", icon: LockKeyhole },
  { key: "injection", label: "Injection", icon: ShieldCheck },
  { key: "budget", label: "Budget", icon: DollarSign },
  { key: "provider_selection", label: "Provider", icon: RouteIcon },
  { key: "tool_authorization", label: "Tool auth", icon: Wrench },
  { key: "execution", label: "Execution", icon: Sparkles },
  { key: "audit", label: "Audit", icon: BadgeCheck },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

function stageTone(status?: string) {
  if (["blocked", "failed"].includes(status ?? "")) return "border-critical/40 bg-critical/8";
  if (status === "redacted") return "border-amber-500/40 bg-amber-500/8";
  if (["passed", "completed"].includes(status ?? "")) return "border-primary/35 bg-primary/8";
  if (status === "running") return "border-sky-500/45 bg-sky-500/8";
  if (status === "not_applicable") return "border-border bg-muted/20";
  return "border-border bg-surface";
}

function statusIcon(status?: string) {
  if (["blocked", "failed"].includes(status ?? ""))
    return <Ban className="h-4 w-4 text-critical" />;
  if (["passed", "completed", "redacted"].includes(status ?? ""))
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (status === "running") return <CircleDot className="h-4 w-4 animate-pulse text-sky-500" />;
  return <Clock3 className="h-4 w-4 text-muted-foreground" />;
}

function executionStatus(stages: Array<{ stage: string; status: string }> = []) {
  if (stages.some((event) => event.status === "failed")) return "failed";
  if (stages.some((event) => event.status === "blocked")) return "blocked";
  if (stages.some((event) => event.stage === "audit" && event.status === "completed"))
    return "completed";
  return stages.length ? "live" : "pending";
}

function LiveExecutionControl() {
  const fn = useServerFn(getLiveExecutionControl);
  const { data, isLoading, error } = useQuery({
    queryKey: ["live-execution-control"],
    queryFn: () => fn({ data: { limit: 12 } }),
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  const executions = data?.executions ?? [];
  const active = executions[0] ?? null;
  const latest = new Map<StageKey, any>();
  for (const event of active?.stages ?? []) latest.set(event.stage as StageKey, event);

  const finalEvent = active?.stages?.at(-1);
  const outcomeStatus = executionStatus(active?.stages);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Live Agent Execution Control"
          subtitle="Follow a governed request from identity to audit. This view is driven by real server-side execution events, not a UI simulation."
        />
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            Live · 1s refresh
          </div>
          <Link
            to="/admin/ai-control"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Admin controls
          </Link>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading live execution stream…</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-critical">
          {error.message}
        </p>
      ) : null}

      {data ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Panel className="p-4">
            <div className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Master execution
            </div>
            <div className="mt-2 text-lg font-semibold">
              {data.controls.execution_enabled ? "Enabled" : "Suspended"}
            </div>
          </Panel>
          <Panel className="p-4">
            <div className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Agent channel
            </div>
            <div className="mt-2 text-lg font-semibold">
              {data.controls.agents_enabled ? "Enabled" : "Suspended"}
            </div>
          </Panel>
          <Panel className="p-4">
            <div className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Live executions
            </div>
            <div className="mt-2 text-lg font-semibold">{executions.length}</div>
          </Panel>
          <Panel className="p-4">
            <div className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Per-request ceiling
            </div>
            <div className="mt-2 text-lg font-semibold">
              {data.controls.max_request_cost_usd == null
                ? "Not set"
                : "$" + Number(data.controls.max_request_cost_usd).toFixed(2)}
            </div>
          </Panel>
        </div>
      ) : null}

      {!active && !isLoading ? (
        <Panel>
          <div className="grid min-h-56 place-items-center text-center">
            <div>
              <Radar className="mx-auto h-8 w-8 text-primary" />
              <h2 className="mt-3 text-lg font-semibold">Waiting for governed traffic</h2>
              <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
                Connect an agent or run a governed request. The execution path will appear here as
                the server evaluates each control.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      {active ? (
        <>
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  {active.actorType === "agent" ? (
                    <Bot className="h-4 w-4 text-primary" />
                  ) : (
                    <Activity className="h-4 w-4 text-primary" />
                  )}
                  <h2 className="font-display text-xl font-semibold">
                    {active.agent?.name ??
                      (active.actorType === "agent" ? "Agent request" : "Console request")}
                  </h2>
                  <Tag value={outcomeStatus} />
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  execution {active.executionId.slice(0, 8)}… ·{" "}
                  {new Date(active.latestAt).toLocaleTimeString()}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Latest event</div>
                <div className="mt-1 text-sm font-medium">
                  {finalEvent?.summary ?? "Evaluating…"}
                </div>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto pb-2">
              <div className="flex min-w-[980px] items-start">
                {STAGES.map((stage, index) => {
                  const event = latest.get(stage.key);
                  const Icon = stage.icon;
                  return (
                    <div key={stage.key} className="flex flex-1 items-start">
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "rounded-xl border p-3 transition-all",
                            stageTone(event?.status),
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            {statusIcon(event?.status)}
                          </div>
                          <div className="mt-3 text-xs font-semibold">{stage.label}</div>
                          <div className="mt-1 min-h-10 text-[11px] leading-4 text-muted-foreground">
                            {event?.summary ?? "Waiting"}
                          </div>
                          <div className="mt-2 text-[10px] font-medium uppercase text-muted-foreground">
                            {event?.status?.replaceAll("_", " ") ?? "pending"}
                          </div>
                        </div>
                      </div>
                      {index < STAGES.length - 1 ? (
                        <div
                          className={cn(
                            "mt-10 h-px w-4 shrink-0",
                            event ? "bg-primary/50" : "bg-border",
                          )}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <Panel>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Execution evidence</h3>
                <span className="text-xs text-muted-foreground">{active.stages.length} events</span>
              </div>
              <div className="mt-4 space-y-2">
                {[...active.stages]
                  .reverse()
                  .slice(0, 12)
                  .map((event: any) => (
                    <div
                      key={event.id}
                      className="flex gap-3 rounded-lg border border-border/70 p-3"
                    >
                      <div className="mt-0.5">{statusIcon(event.status)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-medium capitalize">
                            {event.stage.replaceAll("_", " ")}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {new Date(event.created_at).toLocaleTimeString()}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{event.summary}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </Panel>

            <Panel>
              <h3 className="text-sm font-medium">Recent executions</h3>
              <div className="mt-4 space-y-2">
                {executions.slice(0, 8).map((execution: any) => {
                  const last = execution.stages.at(-1);
                  return (
                    <div
                      key={execution.executionId}
                      className="rounded-lg border border-border/70 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">
                          {execution.agent?.name ?? execution.actorType}
                        </span>
                        <Tag value={executionStatus(execution.stages)} />
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {last?.summary ?? "Pending"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        </>
      ) : null}

      <div className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        The screen shows control-plane events only. Prompts, credentials and raw model responses are
        deliberately excluded from the live trace.
      </div>
    </div>
  );
}
