import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileSearch, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { summarizeFailedRequest, type FailureSummary as Summary } from "@/lib/failure-summary.functions";

export function FailureSummary({ requestId }: { requestId: string }) {
  const summarize = useServerFn(summarizeFailedRequest);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function generate() {
    setPending(true); setError(null);
    try {
      const response = await summarize({ data: { requestId } });
      setResult(response.result); setError(response.error);
    } catch { setError("Summary unavailable. No changes were made."); }
    finally { setPending(false); }
  }
  return <section className="space-y-3 border-t border-border pt-4" aria-label="Failure summary">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Failure summary</h3>
      {!result && <Button variant="outline" size="sm" onClick={generate} disabled={pending}>
        {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <FileSearch className="size-4" />}
        {pending ? "Summarizing…" : "Summarize failure"}
      </Button>}
    </div>
    <div aria-live="polite" className="space-y-3 text-sm">
      {error && <p role="alert" className="text-critical">{error}</p>}
      {result && <>
        <p className="break-words">{result.summary}</p>
        <h4 className="font-medium">Administrator checks · confirm before changes</h4>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">{result.nextSteps.map((step, i) => <li key={i}>{step}</li>)}</ul>
        <details><summary className="cursor-pointer text-xs text-muted-foreground">Recorded evidence</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">{result.evidence.map((item, i) => <li key={i} className={result.citations.includes(i) ? "text-foreground" : ""}>{item}</li>)}</ol>
        </details>
        <p className="text-xs text-muted-foreground">AI-generated advisory · no changes or retries performed.</p>
      </>}
    </div>
  </section>;
}