import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import {
  connectAgentDirect,
  consentAgentConnection,
  disconnectAgent,
  inspectAgentConnection,
  listAgentConnections,
} from "@/lib/nexora.functions";
import {
  CONNECTION_SCOPES,
  DEFAULT_CONNECTION_SCOPES,
  type ConnectionScope,
} from "@/lib/nexora/connection-scopes";
import { Metric, PageHeader, Panel, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/connect-agent")({
  validateSearch: (search: Record<string, unknown>) => ({
    code:
      typeof search["code"] === "string" && /^[A-Fa-f0-9]{10}$/.test(search["code"])
        ? search["code"].toUpperCase()
        : "",
  }),
  head: () => ({
    meta: [
      { title: "Connect an Agent \u2014 NEXORA" },
      { name: "description", content: "Review agent consent, capabilities and connection status." },
      { property: "og:title", content: "Connect an Agent \u2014 NEXORA" },
      {
        property: "og:description",
        content: "Review agent consent, capabilities and connection status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConnectAgent,
});

const button = "rounded border border-border px-4 py-2 text-sm disabled:opacity-50";
const input = "mt-1 w-full rounded border border-border bg-background px-3 py-2";

function ScopeSelection({
  values,
  selected,
  setSelected,
  permitted,
}: {
  values: ConnectionScope[];
  selected: ConnectionScope[];
  setSelected: (value: ConnectionScope[]) => void;
  permitted: (scope: ConnectionScope) => boolean;
}) {
  return (
    <div className="space-y-3">
      {values.map((scope) => (
        <label key={scope} className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={selected.includes(scope)}
            disabled={!permitted(scope)}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? [...selected, scope]
                  : selected.filter((item) => item !== scope),
              )
            }
          />
          <span>
            {CONNECTION_SCOPES[scope]}
            {!permitted(scope) ? " — requires an elevated role" : ""}
          </span>
        </label>
      ))}
    </div>
  );
}

function ConnectAgent() {
  const search = Route.useSearch();
  const [code, setCode] = useState(search.code);
  const [lookup, setLookup] = useState(search.code);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ConnectionScope[]>(DEFAULT_CONNECTION_SCOPES);
  const [remoteScopes, setRemoteScopes] = useState<ConnectionScope[]>([]);
  const client = useQueryClient();
  const inspect = useServerFn(inspectAgentConnection);
  const consent = useServerFn(consentAgentConnection);
  const connect = useServerFn(connectAgentDirect);
  const list = useServerFn(listAgentConnections);
  const disconnect = useServerFn(disconnectAgent);
  const connections = useQuery({
    queryKey: ["agent-connections"],
    queryFn: () => list({}),
  });
  const request = useQuery({
    queryKey: ["agent-consent", lookup],
    queryFn: () => inspect({ data: { code: lookup } }),
    enabled: lookup.length === 10,
    retry: false,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["agent-connections"] });
  const direct = useMutation({
    mutationFn: () => connect({ data: { name, scopes } }),
    onSuccess: refresh,
    gcTime: 0,
  });
  const approve = useMutation({
    mutationFn: (allow: boolean) =>
      consent({ data: { code: lookup, allow, scopes: remoteScopes } }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => disconnect({ data: { id } }),
    onSuccess: refresh,
  });
  const roles = connections.data?.workspace.roles ?? [];
  const admin = roles.some((role) =>
    ["platform_admin", "org_admin", "security_admin", "agent_admin"].includes(role),
  );
  const permitted = (scope: ConnectionScope) =>
    scope === "findings:resolve"
      ? roles.some((role) => ["platform_admin", "org_admin", "security_admin"].includes(role))
      : scope === "model:invoke"
        ? roles.some((role) =>
            [
              "platform_admin",
              "org_admin",
              "security_admin",
              "governance_admin",
              "agent_admin",
              "developer",
            ].includes(role),
          )
        : true;
  const error = direct.error || approve.error || revoke.error || connections.error;
  const agents = connections.data?.agents ?? [];
  const total = agents.reduce(
    (sum, agent: any) => ({
      requests: sum.requests + agent.usage.requests,
      cost: sum.cost + agent.usage.costUsd,
      tokens: sum.tokens + agent.usage.inputTokens + agent.usage.outputTokens,
    }),
    { requests: 0, cost: 0, tokens: 0 },
  );

  let connectionDetails: ReactNode = null;
  if (direct.data) {
    const details = {
      mcpServers: {
        nexora: {
          url: `${window.location.origin}/api/mcp`,
          headers: { Authorization: `Bearer ${direct.data.access_token}` },
        },
      },
      apiUrl: `${window.location.origin}/api/agent`,
      agentId: direct.data.agent_id,
    };
    connectionDetails = (
      <div className="space-y-3">
        <p role="status">Connected. Save this credential now; it is shown only once.</p>
        <textarea
          aria-label="Agent connection details"
          className={`${input} font-mono text-xs`}
          readOnly
          rows={10}
          value={JSON.stringify(details, null, 2)}
        />
        <p className="text-xs text-muted-foreground">
          The credential grants only the selected permissions and expires in 90 days. Store it in
          the agent&apos;s secret manager.
        </p>
        <button className={button} onClick={() => direct.reset()}>
          I saved it — hide credential
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Connect an Agent"
        subtitle="Choose what an agent may access. It can interact immediately after consent, and you can disconnect it at any time."
      />
      {error ? (
        <p role="alert" className="text-critical">
          {error.message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Agent requests" value={total.requests} hint="All recorded agent requests" />
        <Metric label="Agent tokens" value={total.tokens.toLocaleString()} />
        <Metric label="Agent cost" value={`$${total.cost.toFixed(4)}`} tone="primary" />
      </div>

      <Panel>
        <h2 className="font-semibold">Approve an agent&apos;s request</h2>
        <p className="my-2 text-sm text-muted-foreground">
          Enter the code shown by the agent. Only approve a connection you initiated.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setLookup(code.replace(/[-\s]/g, "").toUpperCase());
            setRemoteScopes([]);
            approve.reset();
          }}
        >
          <input
            aria-label="Connection code"
            className={input}
            placeholder="10-character code"
            value={code}
            maxLength={14}
            onChange={(event) => setCode(event.target.value)}
          />
          <button className={button}>Review</button>
        </form>
        {request.isFetching ? <p role="status">Loading request…</p> : null}
        {request.error ? <p role="alert">{request.error.message}</p> : null}
        {request.data && !approve.isSuccess ? (
          <div className="mt-5 space-y-4">
            <h3 className="font-semibold">
              {request.data.connection.client_name} requests access to{" "}
              {request.data.workspace.orgName}
            </h3>
            <p className="text-sm text-muted-foreground">
              The agent supplied this name; Nexora has not verified its publisher. Select the
              permissions to grant. Credentials expire after 90 days.
            </p>
            <ScopeSelection
              values={request.data.connection.scopes}
              selected={remoteScopes}
              setSelected={setRemoteScopes}
              permitted={permitted}
            />
            <div className="flex gap-3">
              <button
                className={button}
                disabled={approve.isPending || !remoteScopes.length}
                onClick={() => approve.mutate(true)}
              >
                Grant permission & connect
              </button>
              <button
                className={button}
                disabled={approve.isPending}
                onClick={() => approve.mutate(false)}
              >
                Deny
              </button>
            </div>
          </div>
        ) : null}
        {approve.isSuccess ? (
          <p role="status" className="mt-4">
            {approve.data.approved
              ? "Permission granted. Return to your agent to finish connecting."
              : "Connection denied."}
          </p>
        ) : null}
      </Panel>

      <Panel>
        <h2 className="font-semibold">Connect with an API credential</h2>
        <p className="my-2 text-sm text-muted-foreground">
          Use this for agents that accept a custom MCP URL or HTTP API with bearer authentication.
        </p>
        {connectionDetails ?? (
          <form
            className="max-w-xl space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              direct.mutate();
            }}
          >
            <label>
              Agent name
              <input
                className={input}
                value={name}
                maxLength={80}
                required
                onChange={(event) => setName(event.target.value)}
                placeholder="My research agent"
              />
            </label>
            <ScopeSelection
              values={Object.keys(CONNECTION_SCOPES) as ConnectionScope[]}
              selected={scopes}
              setSelected={setScopes}
              permitted={permitted}
            />
            <button className={button} disabled={!scopes.length || direct.isPending}>
              {direct.isPending ? "Connecting…" : "Grant permission & create connection"}
            </button>
          </form>
        )}
      </Panel>

      <Panel>
        <h2 className="mb-4 font-semibold">Connected agents — usage and cost</h2>
        {connections.isLoading ? <p>Loading…</p> : null}
        {agents.length === 0 ? <p>No connections yet.</p> : null}
        <div className="space-y-3">
          {agents.map((agent: any) => (
            <div key={agent.id} className="border-b border-border py-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2">
                    {agent.name} <Tag value={agent.status} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {agent.credential_expires_at
                      ? `Credential expires ${new Date(agent.credential_expires_at).toLocaleDateString()}`
                      : "No active credential"}
                  </p>
                </div>
                {admin || agent.owner_id === connections.data?.userId ? (
                  <button
                    className={button}
                    disabled={revoke.isPending || agent.status === "suspended"}
                    onClick={() => revoke.mutate(agent.id)}
                  >
                    Disconnect & revoke access
                  </button>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <span>{agent.usage.requests} requests</span>
                <span>${Number(agent.usage.costUsd).toFixed(4)}</span>
                <span>{Number(agent.usage.inputTokens).toLocaleString()} input tokens</span>
                <span>{Number(agent.usage.outputTokens).toLocaleString()} output tokens</span>
                <span>
                  {agent.usage.lastUsedAt
                    ? `Last used ${new Date(agent.usage.lastUsedAt).toLocaleString()}`
                    : "No usage yet"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
