import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel } from "@/components/nexora/primitives";

export const Route = createFileRoute("/_authenticated/ai-efficiency")({
  head: () => ({
    meta: [
      { title: "AI Efficiency Playbook — NEXORA" },
      {
        name: "description",
        content: "Practical operating guidance for using AI more efficiently and safely.",
      },
    ],
  }),
  component: Efficiency,
});

const practices = [
  [
    "01",
    "Inventory before expansion",
    "List every model call, agent, MCP tool, owner, data class, provider and business outcome. Retire shadow integrations before buying more capacity.",
  ],
  [
    "02",
    "Route by task, not prestige",
    "Use an inexpensive model for extraction, classification and drafts; reserve frontier models for ambiguity, reasoning and high-value decisions. Measure quality per dollar.",
  ],
  [
    "03",
    "Make prompts reusable",
    "Version prompts, require structured outputs, keep context bounded and remove duplicated instructions. Prompt budgets are usually cheaper than model downgrades that create rework.",
  ],
  [
    "04",
    "Use retrieval selectively",
    "Retrieve only the evidence needed for the task, cap document chunks and attach source identifiers. Large context windows do not justify sending entire repositories to every call.",
  ],
  [
    "05",
    "Treat agents as identities",
    "Give each agent an owner, narrow scopes, explicit tool grants, an expiration date and a revocation path. Require approval for irreversible or external actions.",
  ],
  [
    "06",
    "Measure business outcomes",
    "Track cost per resolved ticket, review minute saved, conversion lift, defect rate and escalation rate—not only tokens and request counts.",
  ],
];

function Efficiency() {
  return (
    <div>
      <PageHeader
        title="AI Efficiency Playbook"
        subtitle="Use AI to reduce cycle time and operating cost while preserving security, quality and human accountability."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {practices.map(([number, title, body]) => (
          <Panel key={number}>
            <div className="label-caps text-primary">{number}</div>
            <h2 className="mt-2 font-display text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
          </Panel>
        ))}
      </div>
      <Panel className="mt-5">
        <div className="label-caps">30-day operating plan</div>
        <ol className="mt-3 grid gap-3 text-sm text-muted-foreground md:grid-cols-4">
          <li>
            <strong className="text-foreground">Week 1:</strong> inventory traffic and owners.
          </li>
          <li>
            <strong className="text-foreground">Week 2:</strong> baseline quality, latency and cost.
          </li>
          <li>
            <strong className="text-foreground">Week 3:</strong> route low-risk work to smaller
            models and add approval gates.
          </li>
          <li>
            <strong className="text-foreground">Week 4:</strong> compare outcome metrics and remove
            low-value calls.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
