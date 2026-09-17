import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { DataTable, PageHeader, Panel } from "@/components/nexora/primitives";
import {
  createAgent,
  listControlPlane,
  manageControlPlane,
  runSecurityTests,
  type ControlMutation,
} from "@/lib/nexora.functions";

export const Route = createFileRoute("/_authenticated/module/$slug")({
  head: () => ({ meta: [{ title: "NEXORA Control Plane" }] }),
  component: ModulePage,
});

const NOTES: Record<string, string> = {
  "agent-registry":
    "Register agent identities and manage their lifecycle. Use Connect an Agent to issue consent-scoped credentials and activate an identity.",
  "agent-tasks":
    "Recent governed gateway requests attributed to agents, including decisions and execution status.",
  "agent-tools":
    "Manage capability assignments for registered agents. MCP tools also require an explicit tool grant before execution.",
  "mcp-gateway":
    "Register HTTPS MCP endpoints. Discovery and invocation require an administrator allowlist, server credentials, approved tool definitions, capabilities and per-agent grants.",
  threats: "Tenant-scoped security findings with resolution tracking. Latest 200 records.",
  "security-tests":
    "Run synthetic request and response fixtures against your active policies and content detectors. Tests do not call AI providers or verify model behavior.",
  "attack-simulation":
    "Run deterministic injection, extraction and exfiltration fixtures against your active policies. This is policy validation, not a live model penetration test.",
  latency:
    "Latency and decisions for the latest 200 gateway requests. Zero milliseconds means no measured provider duration.",
  errors:
    "Latest 200 requests recorded as provider errors or execution failures. Policy blocks are tracked in Requests.",
  integrations:
    "Current server credential availability. CONFIGURED means a key is present; a successful governed request is needed to verify provider access. SIEM, Slack and Jira delivery are not connected.",
  settings: "Organization identity and the security controls currently enforced by the gateway.",
};

const FIELDS: Record<string, [string, string][]> = {
  "agent-registry": [
    ["Name", "name"],
    ["Slug", "slug"],
    ["Status", "status"],
    ["Created", "created_at"],
  ],
  "agent-tasks": [
    ["Agent", "agent_id"],
    ["Model", "model"],
    ["Decision", "decision"],
    ["Status", "status"],
    ["Created", "created_at"],
  ],
  "agent-tools": [
    ["Agent", "agent_name"],
    ["Capability", "capability"],
    ["Granted", "created_at"],
  ],
  "mcp-gateway": [
    ["Name", "name"],
    ["Endpoint", "url"],
    ["Transport", "transport"],
    ["Status", "status"],
  ],
  threats: [
    ["Finding", "title"],
    ["Category", "category"],
    ["Severity", "severity"],
    ["Status", "status"],
    ["Created", "created_at"],
  ],
  latency: [
    ["Model", "model"],
    ["Decision", "decision"],
    ["Status", "status"],
    ["Latency (ms)", "latency_ms"],
    ["Created", "created_at"],
  ],
  errors: [
    ["Model", "model"],
    ["Status", "status"],
    ["Created", "created_at"],
  ],
  integrations: [
    ["Provider", "name"],
    ["Vendor", "vendor"],
    ["Status", "status"],
    ["Server credential", "readiness"],
  ],
};

const inputStyle = "w-full rounded border border-border bg-background px-3 py-2 text-sm";
const buttonStyle =
  "rounded border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50";
function humanize(slug: string) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function ModulePage() {
  const { slug } = useParams({ from: "/_authenticated/module/$slug" });
  return <ModuleContent key={slug} slug={slug} />;
}

function ModuleContent({ slug }: { slug: string }) {
  const client = useQueryClient();
  const list = useServerFn(listControlPlane);
  const create = useServerFn(createAgent);
  const manage = useServerFn(manageControlPlane);
  const run = useServerFn(runSecurityTests);
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["control-plane", slug],
    queryFn: () => list({ data: { module: slug } }),
    retry: false,
  });
  const roles: string[] = query.data?.workspace.roles ?? [];
  const canAdmin = roles.some((r) => ["platform_admin", "org_admin"].includes(r));
  const canAgent = canAdmin || roles.some((r) => ["agent_admin", "security_admin"].includes(r));
  const canSecurity = canAdmin || roles.includes("security_admin");
  const canTest = canSecurity || roles.includes("governance_admin");
  const suite = slug === "security-tests" || slug === "attack-simulation";
  const agents = useQuery({
    queryKey: ["control-plane", "agent-registry"],
    queryFn: () => list({ data: { module: "agent-registry" } }),
    enabled: slug === "agent-tools",
  });
  const mutation = useMutation({
    mutationFn: (data: ControlMutation) => manage({ data }),
    onSuccess: async () => {
      setMessage("Saved.");
      await client.invalidateQueries();
    },
  });
  const creation = useMutation({
    mutationFn: (data: { name: string; slug: string; description: string }) => create({ data }),
    onSuccess: async () => {
      setMessage("Agent registered in draft.");
      await client.invalidateQueries();
    },
  });
  const tests = useMutation({
    mutationFn: () => run({ data: { adversarial: slug === "attack-simulation" } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["control-plane", slug] });
    },
  });
  const pending = mutation.isPending || creation.isPending || tests.isPending;
  const error = mutation.error || creation.error || tests.error;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    if (slug === "agent-registry")
      creation.mutate({
        name: value("name"),
        slug: value("slug"),
        description: value("description"),
      });
    if (slug === "agent-tools")
      mutation.mutate({
        action: "grant-capability",
        id: value("agent"),
        capability: value("capability"),
      });
    if (slug === "mcp-gateway")
      mutation.mutate({
        action: "register-mcp",
        name: value("name"),
        url: value("url"),
        authMode: "bearer",
      });
    if (slug === "settings")
      mutation.mutate({ action: "rename-organization", name: value("name") });
  }
  const rows: any[] = query.data?.rows ?? [];
  const fields = FIELDS[slug] ?? [];
  const actions =
    ((slug === "agent-registry" || slug === "agent-tools") && canAgent) ||
    (slug === "threats" && canSecurity);
  return (
    <div className="space-y-5">
      <PageHeader title={humanize(slug)} subtitle={NOTES[slug] ?? "Unknown module."} />
      {query.isLoading ? (
        <Panel>
          <p role="status">Loading…</p>
        </Panel>
      ) : query.error ? (
        <Panel>
          <p role="alert">{query.error.message}</p>
          <button className={buttonStyle} onClick={() => query.refetch()}>
            Retry
          </button>
        </Panel>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-destructive">
              {error.message}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {((canAgent && ["agent-registry", "agent-tools", "mcp-gateway"].includes(slug)) ||
            (canAdmin && slug === "settings")) && (
            <Panel>
              <form onSubmit={submit} className="grid max-w-xl gap-3">
                {slug !== "agent-tools" && (
                  <label>
                    Name
                    <input
                      className={inputStyle}
                      name="name"
                      minLength={2}
                      maxLength={100}
                      required
                      defaultValue={slug === "settings" ? query.data?.workspace.orgName : ""}
                    />
                  </label>
                )}
                {slug === "agent-registry" && (
                  <>
                    <label>
                      Slug
                      <input
                        className={inputStyle}
                        name="slug"
                        pattern="[a-z0-9-]+"
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      Description
                      <input className={inputStyle} name="description" maxLength={500} />
                    </label>
                  </>
                )}
                {slug === "mcp-gateway" && (
                  <label>
                    HTTPS endpoint
                    <input
                      className={inputStyle}
                      name="url"
                      type="url"
                      placeholder="https://example.com/mcp"
                      required
                    />
                  </label>
                )}
                {slug === "agent-tools" && (
                  <>
                    <label>
                      Agent
                      <select className={inputStyle} name="agent" required>
                        <option value="">Select an agent</option>
                        {(agents.data?.rows ?? []).map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Capability
                      <input
                        className={inputStyle}
                        name="capability"
                        placeholder="documents:read"
                        pattern="[a-z0-9:._-]+"
                        required
                      />
                    </label>
                    {agents.error && <p role="alert">Could not load agents.</p>}
                  </>
                )}
                <button className={buttonStyle} disabled={pending} type="submit">
                  {pending
                    ? "Saving…"
                    : slug === "settings"
                      ? "Save name"
                      : slug === "agent-tools"
                        ? "Grant capability"
                        : "Register"}
                </button>
              </form>
            </Panel>
          )}
          {slug === "settings" && (
            <Panel>
              <p>Organization: {query.data?.workspace.orgName}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Gateway controls: authenticated membership, request and response inspection, policy
                decisions, approval checks, atomic budget reservation and audit records. Retention
                scheduling and regional routing are not configured.
              </p>
            </Panel>
          )}
          {suite && (
            <>
              {canTest ? (
                <button className={buttonStyle} disabled={pending} onClick={() => tests.mutate()}>
                  {tests.isPending ? "Running…" : "Run policy checks"}
                </button>
              ) : (
                <p>A governance or security administrator can run these checks.</p>
              )}
              {tests.data && (
                <Panel>
                  <p role="status">
                    {tests.data.passed} / {tests.data.total} checks passed.
                  </p>
                  <TestCases cases={tests.data.cases} />
                </Panel>
              )}
              <h2 className="font-semibold">Saved runs</h2>
              {!rows.length && <Panel>No policy test runs recorded yet.</Panel>}
              {rows.map((r) => (
                <Panel key={r.id}>
                  <details>
                    <summary className="cursor-pointer">
                      {new Date(r.created_at).toLocaleString()} · {r.result} ·{" "}
                      {r.metadata?.passed ?? 0}/{r.metadata?.total ?? 0}
                    </summary>
                    <TestCases cases={r.metadata?.cases ?? []} />
                  </details>
                </Panel>
              ))}
            </>
          )}
          {!suite && fields.length > 0 && (
            <DataTable
              columns={[...fields.map(([label]) => label), ...(actions ? ["Action"] : [])]}
              rows={rows.map((r) => [
                ...fields.map(([, key]) =>
                  key === "agent_name"
                    ? (r.agents?.name ?? r.agent_id)
                    : key === "created_at"
                      ? new Date(r[key]).toLocaleString()
                      : String(r[key] ?? "—"),
                ),
                ...(actions
                  ? [
                      slug === "agent-registry" ? (
                        <div className="flex gap-2">
                          {["draft", "suspended", "archived"]
                            .filter((s) => s !== r.status)
                            .map((status) => (
                              <button
                                key={status}
                                className={buttonStyle}
                                disabled={pending}
                                onClick={() =>
                                  mutation.mutate({
                                    action: "agent-status",
                                    id: r.id,
                                    status: status as "draft" | "suspended" | "archived",
                                  })
                                }
                              >
                                {humanize(status)}
                              </button>
                            ))}
                        </div>
                      ) : slug === "agent-tools" ? (
                        <button
                          className={buttonStyle}
                          disabled={pending}
                          onClick={() => mutation.mutate({ action: "revoke-capability", id: r.id })}
                        >
                          Revoke
                        </button>
                      ) : (
                        <button
                          className={buttonStyle}
                          disabled={pending}
                          onClick={() =>
                            mutation.mutate({
                              action: "finding-status",
                              id: r.id,
                              status: r.status === "resolved" ? "open" : "resolved",
                            })
                          }
                        >
                          {r.status === "resolved" ? "Reopen" : "Resolve"}
                        </button>
                      ),
                    ]
                  : []),
              ])}
            />
          )}
        </>
      )}
    </div>
  );
}

function TestCases({ cases }: { cases: any[] }) {
  return (
    <div className="mt-4">
      <DataTable
        columns={["Case", "Stage", "Expected", "Actual", "Result"]}
        rows={cases.map((c) => [c.name, c.stage, c.expected, c.actual, c.passed ? "PASS" : "FAIL"])}
      />
    </div>
  );
}
