import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("panel p-5", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

const decisionTone: Record<string, string> = {
  ALLOW: "border-allow/30 bg-allow/10 text-allow",
  LOG: "border-info/30 bg-info/10 text-info",
  REDACT: "border-medium/30 bg-medium/10 text-medium",
  REQUIRE_APPROVAL: "border-high/30 bg-high/10 text-high",
  BLOCK: "border-critical/40 bg-critical/10 text-critical",
};

const severityTone: Record<string, string> = {
  critical: "border-critical/40 bg-critical/10 text-critical",
  high: "border-high/30 bg-high/10 text-high",
  medium: "border-medium/30 bg-medium/10 text-medium",
  low: "border-low/30 bg-low/10 text-low",
  info: "border-info/30 bg-info/10 text-info",
};

export function Tag({
  value,
  kind = "neutral",
  className,
}: {
  value: string;
  kind?: "decision" | "severity" | "neutral";
  className?: string;
}) {
  const tone =
    kind === "decision"
      ? (decisionTone[value] ?? decisionTone["LOG"])
      : kind === "severity"
        ? (severityTone[value] ?? severityTone["info"])
        : "border-border bg-secondary text-secondary-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] tracking-wide uppercase",
        tone,
        className,
      )}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "critical" | "high" | "allow" | "primary";
}) {
  const toneClass =
    tone === "critical"
      ? "text-critical"
      : tone === "high"
        ? "text-high"
        : tone === "allow"
          ? "text-allow"
          : tone === "primary"
            ? "text-primary"
            : "text-foreground";
  return (
    <div className="panel p-4">
      <div className="label-caps">{label}</div>
      <div className={cn("mt-2 font-display text-2xl font-semibold tabular-nums", toneClass)}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel grid-lines flex flex-col items-center justify-center p-12 text-center">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function NotConfigured({ module, note }: { module: string; note?: string }) {
  return (
    <div className="panel p-8">
      <span className="inline-flex items-center rounded-sm border border-medium/30 bg-medium/10 px-2 py-0.5 font-mono text-[11px] tracking-wide text-medium uppercase">
        NOT_CONFIGURED
      </span>
      <h2 className="mt-4 font-display text-xl font-semibold">{module}</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {note ??
          "This module is part of the NEXORA architecture but has no backend enforcement wired up yet. Nothing here is simulated — no data is shown until the module is implemented server-side."}
      </p>
    </div>
  );
}

export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th key={c} className="label-caps px-4 py-3 text-left font-normal">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">No records yet.</div>
      ) : null}
    </div>
  );
}
