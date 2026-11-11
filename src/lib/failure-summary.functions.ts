import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authorizeFailureSummary, buildFailureEvidence, type EvidenceRow } from "./nexora/failure-evidence";

export type FailureSummary = { summary: string; nextSteps: string[]; evidence: string[]; citations: number[] };

export const summarizeFailedRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ requestId: z.string().uuid() }).strict())
  .handler(async ({ data, context }): Promise<{ result: FailureSummary | null; error: string | null }> => {
    const { data: row, error } = await context.supabase.from("requests")
      .select("id,org_id,status,decision,reason,policy_version,matched_rules")
      .eq("id", data.requestId).maybeSingle();
    if (error) return { result: null, error: "Request evidence could not be read." };
    const { data: memberships, error: membershipError } = await context.supabase.from("org_members")
      .select("org_id,role").eq("user_id", context.userId);
    if (membershipError) return { result: null, error: "Administrator access could not be verified." };
    try {
      const result = await authorizeFailureSummary(row, memberships ?? [], async (record) => {
        const { data: events, error: traceError } = await context.supabase.from("execution_events")
          .select("stage,status,detail").eq("org_id", String(record.org_id)).eq("request_id", data.requestId)
          .order("id", { ascending: true }).limit(30);
        if (traceError) throw new Error("Linked execution evidence could not be read.");
        const evidence = buildFailureEvidence(record, (events ?? []) as EvidenceRow[]);
        const { generateFailureSummary } = await import("./failure-ai/summary.server");
        return generateFailureSummary(getRequest(), evidence);
      });
      return { result: result as FailureSummary, error: null };
    } catch (error) {
      const { safeSummaryError } = await import("./failure-ai/summary.server");
      return { result: null, error: safeSummaryError(error) };
    }
  });