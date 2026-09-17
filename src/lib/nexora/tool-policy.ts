import { inspect, redact } from "./dlp";
import { evaluate, type PolicyRecord } from "./policy-engine";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

const sensitiveKey = /^(?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization)$/i;
function leafTexts(value: unknown, key = "", depth = 0): string[] {
  if (depth > 32) throw new Error("Tool arguments are nested too deeply.");
  if (typeof value === "string") return [sensitiveKey.test(key) ? `password=${value}` : value];
  if (Array.isArray(value)) return value.flatMap((v) => leafTexts(v, key, depth + 1));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leafTexts(v, k, depth + 1));
  return [];
}

export function redactToolData(value: unknown, key = "", depth = 0): any {
  if (depth > 32) throw new Error("Tool data is nested too deeply.");
  if (sensitiveKey.test(key) && value !== null) return "[REDACTED:CREDENTIAL]";
  if (typeof value === "string") return redact(value, inspect(value));
  if (Array.isArray(value)) return value.map((v) => redactToolData(v, key, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactToolData(v, k, depth + 1)]),
    );
  return value;
}

export function toolDecision(
  policies: PolicyRecord[],
  value: unknown,
  toolKey: string,
  stage: "request" | "response",
  approvedPolicies?: PolicyRecord[],
) {
  const detections = leafTexts(value).flatMap(inspect);
  const current =
    stage === "request"
      ? policies.map((p) =>
          p.action === "REQUIRE_APPROVAL" &&
          approvedPolicies?.some((a) => canonicalJson(a) === canonicalJson(p))
            ? { ...p, action: "LOG" as const }
            : p,
        )
      : policies;
  const decision = evaluate(current, {
    detections,
    modelKey: toolKey,
    modelClassification: "tool",
    provider: "mcp",
    estimatedCostUsd: 0,
    monthlySpendUsd: 0,
    actorType: "agent",
    stage,
  });
  const sanitized = redactToolData(value);
  if (decision.action === "REDACT" && canonicalJson(value) === canonicalJson(sanitized))
    throw new Error("Tool redaction cannot be performed.");
  return { decision, sanitized };
}
