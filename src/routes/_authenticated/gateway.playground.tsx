import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listCatalog, submitGatewayRequest } from "@/lib/nexora.functions";
import { PageHeader, Panel, Tag } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/gateway/playground")({
  head: () => ({
    meta: [
      { title: "Gateway Playground — NEXORA" },
      {
        name: "description",
        content:
          "Send a governed request through the NEXORA gateway and inspect the deterministic policy decision, findings and cost.",
      },
      { property: "og:title", content: "Gateway Playground — NEXORA" },
      {
        property: "og:description",
        content: "Inspect policy decisions on live AI traffic.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Playground,
});

function Playground() {
  const catalogFn = useServerFn(listCatalog);
  const submitFn = useServerFn(submitGatewayRequest);
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [modelKey, setModelKey] = useState("");

  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => catalogFn({}) });
  const models = (catalog.data?.models ?? []) as any[];
  const selected = modelKey || models[0]?.model_key || "";

  const run = useMutation({
    mutationFn: () =>
      submitFn({ data: { prompt, modelKey: selected, idempotencyKey: crypto.randomUUID() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
  });

  const result = run.data as any;

  return (
    <div>
      <PageHeader
        title="Gateway Playground"
        subtitle="Every request passes authentication, tenant resolution, inspection, policy evaluation, budget checks and audit before any provider is contacted."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <label className="label-caps" htmlFor="model">
            Model
          </label>
          <select
            id="model"
            value={selected}
            onChange={(e) => setModelKey(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {models.map((m) => (
              <option key={m.model_key} value={m.model_key}>
                {m.display_name} · {m.classification}
              </option>
            ))}
          </select>

          <label className="label-caps mt-4 block" htmlFor="prompt">
            Prompt
          </label>
          <textarea
            id="prompt"
            rows={9}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Try including an email address, an API key, or 'ignore all previous instructions' to see enforcement."
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />

          <button
            onClick={() => run.mutate()}
            disabled={!prompt.trim() || !selected || run.isPending}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {run.isPending ? "Evaluating…" : "Submit through gateway"}
          </button>
          {run.error ? (
            <p className="mt-3 text-sm text-critical">{String((run.error as any).message)}</p>
          ) : null}
        </Panel>

        <Panel>
          <div className="label-caps">Decision</div>
          {!result ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No evaluation yet. Decisions are computed server-side and recorded in the audit log.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Tag value={result.decision} kind="decision" />
                {result.policy ? (
                  <span className="text-xs text-muted-foreground">
                    {result.policy.name} v{result.policy.version}
                  </span>
                ) : null}
                {result.status ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {result.status}
                  </span>
                ) : null}
              </div>
              <p className="text-sm">{result.reason}</p>

              {result.matchedRules?.length ? (
                <div>
                  <div className="label-caps">Matched rules</div>
                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {result.matchedRules.map((r: any) => (
                      <li key={r.policyId + r.action} className="font-mono">
                        {r.policyName} v{r.policyVersion} · p{r.priority} · {r.action}
                        {r.matched?.length ? ` · ${r.matched.join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.findings?.length ? (
                <div>
                  <div className="label-caps">Findings</div>
                  <ul className="mt-1 space-y-1 text-xs">
                    {result.findings.map((f: any, i: number) => (
                      <li key={i} className="flex items-center gap-2">
                        <Tag value={f.severity} kind="severity" />
                        <span>{f.label}</span>
                        <span className="text-muted-foreground">
                          {Math.round(f.confidence * 100)}% · {f.source}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.usage ? (
                <div className="label-caps">
                  {result.usage.inputTokens}/{result.usage.outputTokens} tokens · $
                  {Number(result.usage.costUsd).toFixed(6)} · {result.usage.latency} ms
                </div>
              ) : null}

              <div>
                <div className="label-caps">Model output</div>
                <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap">
                  {result.output ?? "— withheld by policy —"}
                </pre>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
