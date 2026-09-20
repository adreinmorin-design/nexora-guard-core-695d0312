import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ChevronDown, Menu, ShieldCheck, X } from "lucide-react";

type NavItem = { label: string; to: string };
type NavGroup = { group: string; items: NavItem[] };

const PRIMARY_NAV: NavItem[] = [
  { label: "Overview", to: "/overview" },
  { label: "Playground", to: "/gateway/playground" },
  { label: "Requests", to: "/gateway/requests" },
  { label: "Agents", to: "/connect-agent" },
  { label: "Findings", to: "/security/findings" },
  { label: "Approvals", to: "/approvals" },
];

const ADVANCED_NAV: NavGroup[] = [
  {
    group: "Gateway",
    items: [
      { label: "Providers", to: "/gateway/providers" },
      { label: "Models", to: "/gateway/models" },
    ],
  },
  {
    group: "Governance",
    items: [
      { label: "Policies", to: "/governance/policies" },
      { label: "Data protection", to: "/governance/dlp" },
      { label: "Budgets & quotas", to: "/governance/budgets" },
    ],
  },
  {
    group: "Agent controls",
    items: [
      { label: "Registry", to: "/module/agent-registry" },
      { label: "Tasks", to: "/module/agent-tasks" },
      { label: "Tools", to: "/module/agent-tools" },
      { label: "AI discovery", to: "/module/ai-discovery" },
      { label: "MCP gateway", to: "/module/mcp-gateway" },
    ],
  },
  {
    group: "Security",
    items: [
      { label: "Threats", to: "/module/threats" },
      { label: "Security tests", to: "/module/security-tests" },
      { label: "Attack simulation", to: "/module/attack-simulation" },
    ],
  },
  {
    group: "Insights",
    items: [
      { label: "Usage & cost", to: "/observability/usage" },
      { label: "Latency", to: "/module/latency" },
      { label: "Errors", to: "/module/errors" },
      { label: "Audit log", to: "/audit" },
      { label: "AI efficiency", to: "/ai-efficiency" },
    ],
  },
  {
    group: "Administration",
    items: [
      { label: "Users & roles", to: "/admin/users" },
      { label: "Plans & billing", to: "/admin/billing" },
      { label: "Integrations", to: "/module/integrations" },
      { label: "Settings", to: "/module/settings" },
    ],
  },
];

export const NAV: NavGroup[] = [{ group: "Core", items: PRIMARY_NAV }, ...ADVANCED_NAV];

export function AppShell({
  children,
  org,
  roles,
  email,
}: {
  children: ReactNode;
  org?: string | undefined;
  roles?: string[] | undefined;
  email?: string | null | undefined;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const advancedActive = useMemo(
    () => ADVANCED_NAV.some((group) => group.items.some((item) => pathname === item.to)),
    [pathname],
  );
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive);

  useEffect(() => {
    setOpen(false);
    if (advancedActive) setAdvancedOpen(true);
  }, [pathname, advancedActive]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: "/overview" }, replace: true });
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-60 overflow-y-auto border-r border-border bg-surface/95 backdrop-blur lg:static lg:block",
          open ? "block" : "hidden",
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-5">
          <div className="grid h-7 w-7 place-items-center rounded-md border border-primary/35 bg-primary/10">
            <ShieldCheck className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="font-display text-sm font-semibold tracking-[0.2em]">NEXORA</div>
            <div className="text-[10px] text-muted-foreground">AI control plane</div>
          </div>
        </div>

        <nav className="px-3 py-4">
          <div className="space-y-1">
            {PRIMARY_NAV.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "block rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="my-4 border-t border-border/70" />

          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
              advancedActive
                ? "text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            aria-expanded={advancedOpen}
          >
            <span>Advanced</span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")}
            />
          </button>

          {advancedOpen ? (
            <div className="mt-2 space-y-4 border-l border-border/70 pl-3">
              {ADVANCED_NAV.map((group) => (
                <div key={group.group}>
                  <div className="px-2 pb-1 text-[10px] font-medium tracking-[0.14em] text-muted-foreground/75 uppercase">
                    {group.group}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = pathname === item.to;
                      return (
                        <Link
                          key={`${group.group}-${item.to}-${item.label}`}
                          to={item.to}
                          className={cn(
                            "block rounded-md px-2 py-1.5 text-sm transition-colors",
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </nav>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setOpen((value) => !value)}
              aria-label="Toggle navigation"
              className="rounded-md border border-border p-1.5 text-muted-foreground lg:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{org ?? "Loading workspace…"}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                Protected
                {roles?.length ? (
                  <span className="hidden sm:inline">· {roles[0]?.replaceAll("_", " ")}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden max-w-56 truncate text-xs text-muted-foreground md:inline">
              {email}
            </span>
            <button
              onClick={signOut}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-7 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
