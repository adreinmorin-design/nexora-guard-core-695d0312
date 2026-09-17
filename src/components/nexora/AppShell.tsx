import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

type NavItem = { label: string; to: string };
type NavGroup = { group: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  { group: "Overview", items: [{ label: "Dashboard", to: "/overview" }] },
  {
    group: "AI Gateway",
    items: [
      { label: "Playground", to: "/gateway/playground" },
      { label: "Requests", to: "/gateway/requests" },
      { label: "Providers", to: "/gateway/providers" },
      { label: "Models", to: "/gateway/models" },
    ],
  },
  {
    group: "Governance",
    items: [
      { label: "Policies", to: "/governance/policies" },
      { label: "DLP", to: "/governance/dlp" },
      { label: "Model Controls", to: "/gateway/models" },
      { label: "Budgets & Quotas", to: "/governance/budgets" },
    ],
  },
  {
    group: "Agents",
    items: [
      { label: "Connect an Agent", to: "/connect-agent" },
      { label: "Registry", to: "/module/agent-registry" },
      { label: "Tasks", to: "/module/agent-tasks" },
      { label: "Tools", to: "/module/agent-tools" },
      { label: "Approvals", to: "/approvals" },
      { label: "MCP", to: "/module/mcp-gateway" },
    ],
  },
  {
    group: "Security",
    items: [
      { label: "Findings", to: "/security/findings" },
      { label: "Threats", to: "/module/threats" },
      { label: "Security Tests", to: "/module/security-tests" },
      { label: "Attack Simulation", to: "/module/attack-simulation" },
    ],
  },
  {
    group: "Observability",
    items: [
      { label: "Usage & Cost", to: "/observability/usage" },
      { label: "Latency", to: "/module/latency" },
      { label: "Errors", to: "/module/errors" },
    ],
  },
  { group: "Audit", items: [{ label: "Audit Log", to: "/audit" }] },
  {
    group: "Administration",
    items: [
      { label: "Users & Roles", to: "/admin/users" },
      { label: "Plans & Billing", to: "/admin/billing" },
      { label: "Integrations", to: "/module/integrations" },
      { label: "Settings", to: "/module/settings" },
    ],
  },
];

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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: "/overview" }, replace: true });
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-border bg-surface/95 backdrop-blur lg:static lg:block",
          open ? "block" : "hidden",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <div className="h-6 w-6 rounded-sm border border-primary/50 bg-primary/15" />
          <div>
            <div className="font-display text-sm font-semibold tracking-[0.22em]">NEXORA</div>
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
              Control Plane
            </div>
          </div>
        </div>

        <nav className="px-3 py-4">
          {NAV.map((group) => (
            <div key={group.group} className="mb-4">
              <div className="label-caps px-2 pb-1">{group.group}</div>
              {group.items.map((item) => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={`${group.group}-${item.to}-${item.label}`}
                    to={item.to}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-primary/12 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle navigation"
              className="rounded-md border border-border p-1.5 text-muted-foreground lg:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div>
              <div className="text-sm font-medium">{org ?? "Loading workspace…"}</div>
              <div className="label-caps">{roles?.join(" · ") ?? "resolving roles"}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
            <button
              onClick={signOut}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
