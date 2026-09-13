/**
 * Deterministic execution gate.
 *
 * This is the single place where a provider call may originate. It makes two
 * invariants structurally enforceable and unit-testable:
 *
 *  1. BLOCK and REQUIRE_APPROVAL never reach the provider executor.
 *  2. When the decision is REDACT, only the redacted prompt is ever handed to
 *     the executor — the original text is not in scope of the call.
 */

import type { GovAction } from "./policy-engine";

export type Executor<T> = (outboundPrompt: string) => Promise<T>;

export type GateOutcome<T> = {
  executed: boolean;
  forwardedPrompt: string | null;
  redacted: boolean;
  result: T | null;
};

const NO_PROVIDER_ACTIONS: GovAction[] = ["BLOCK", "REQUIRE_APPROVAL"];

export async function executeUnderDecision<T>(params: {
  action: GovAction;
  originalPrompt: string;
  redactedPrompt: string;
  execute: Executor<T>;
}): Promise<GateOutcome<T>> {
  const { action, originalPrompt, redactedPrompt, execute } = params;

  if (NO_PROVIDER_ACTIONS.includes(action)) {
    return { executed: false, forwardedPrompt: null, redacted: false, result: null };
  }

  const redacted = action === "REDACT";
  const outbound = redacted ? redactedPrompt : originalPrompt;

  if (redacted && outbound === originalPrompt && originalPrompt.length > 0) {
    // Fail closed: a REDACT decision must never forward the untouched original.
    throw new Error("REDACT decision produced no redaction; refusing provider call.");
  }

  const result = await execute(outbound);
  return { executed: true, forwardedPrompt: outbound, redacted, result };
}
