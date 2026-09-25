/**
 * Deterministic, tamper-evident governance event hashing.
 *
 * The database serializes chain advancement. This module owns canonical JSON
 * and SHA-256 calculation so verification can be performed independently of
 * the storage engine.
 */

export type GovernanceHashInput = {
  previousEventHash: string | null;
  chainPosition: number;
  eventId: string;
  traceId: string;
  executionId: string;
  intentId: string;
  parentEventId: string | null;
  actorId: string | null;
  agentId: string | null;
  organizationId: string;
  applicationId: string | null;
  policyId: string | null;
  policyVersion: number | null;
  ruleId: string | null;
  decision: string;
  reason: string;
  evaluatedContextHash: string;
  timestamp: string;
  decisionEngineVersion: string;
  enforcementPoint: string;
  attributes: Record<string, unknown>;
};

export type GovernanceChainRecord = GovernanceHashInput & {
  eventHash: string;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Non-finite numbers are not canonicalizable.");
    }
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item))
      .join(",") +
    "}"
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashGovernanceContext(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export async function computeGovernanceEventHash(input: GovernanceHashInput): Promise<string> {
  return sha256Hex(canonicalJson(input));
}

export async function verifyGovernanceChain(records: GovernanceChainRecord[]): Promise<{
  valid: boolean;
  failingIndex: number | null;
  reason: string | null;
}> {
  let previous: string | null = null;
  let expectedPosition = 1;

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.chainPosition !== expectedPosition) {
      return { valid: false, failingIndex: index, reason: "chain_position_gap_or_reorder" };
    }
    if (record.previousEventHash !== previous) {
      return { valid: false, failingIndex: index, reason: "previous_hash_mismatch" };
    }
    const { eventHash, ...hashInput } = record;
    const calculated = await computeGovernanceEventHash(hashInput);
    if (calculated !== eventHash) {
      return { valid: false, failingIndex: index, reason: "event_hash_mismatch" };
    }
    previous = eventHash;
    expectedPosition++;
  }

  return { valid: true, failingIndex: null, reason: null };
}
