/**
 * NEXORA Guard — deterministic content inspection.
 *
 * These detectors are pattern based and are intentionally NOT perfect.
 * Every detection carries a confidence score and a detection source so the
 * console can present it honestly. This module is pure and is only ever
 * imported by server-side code.
 */

export type DetectionCategory =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "iban"
  | "ip_address"
  | "api_key"
  | "private_key"
  | "jwt"
  | "password"
  | "connection_string"
  | "prompt_injection"
  | "system_prompt_extraction"
  | "data_exfiltration";

export type Detection = {
  category: DetectionCategory;
  label: string;
  match: string;
  start: number;
  end: number;
  confidence: number;
  source: "regex" | "heuristic";
  severity: "critical" | "high" | "medium" | "low" | "info";
};

type Rule = {
  category: DetectionCategory;
  label: string;
  pattern: RegExp;
  confidence: number;
  severity: Detection["severity"];
  source: Detection["source"];
  validate?: (value: string) => boolean;
};

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const PII_RULES: Rule[] = [
  {
    category: "ssn",
    label: "US Social Security Number",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.95,
    severity: "critical",
    source: "regex",
  },
  {
    category: "credit_card",
    label: "Payment card number",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    confidence: 0.9,
    severity: "critical",
    source: "regex",
    validate: luhn,
  },
  {
    category: "iban",
    label: "IBAN / bank identifier",
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,26}\b/g,
    confidence: 0.7,
    severity: "high",
    source: "regex",
  },
  {
    category: "email",
    label: "Email address",
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g,
    confidence: 0.92,
    severity: "medium",
    source: "regex",
  },
  {
    category: "phone",
    label: "Phone number",
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]?\d{3,4}[\s.-]?\d{2,4}\b/g,
    confidence: 0.6,
    severity: "medium",
    source: "regex",
  },
  {
    category: "ip_address",
    label: "IP address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    confidence: 0.55,
    severity: "low",
    source: "regex",
  },
];

const SECRET_RULES: Rule[] = [
  {
    category: "private_key",
    label: "Private key material",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|$)/g,
    confidence: 0.99,
    severity: "critical",
    source: "regex",
  },
  {
    category: "api_key",
    label: "Provider API key",
    pattern:
      /\b(?:sk-[A-Za-z0-9-_]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z\-_]{20,})\b/g,
    confidence: 0.96,
    severity: "critical",
    source: "regex",
  },
  {
    category: "jwt",
    label: "Bearer / JWT token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    confidence: 0.9,
    severity: "high",
    source: "regex",
  },
  {
    category: "connection_string",
    label: "Database connection string",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,
    confidence: 0.9,
    severity: "critical",
    source: "regex",
  },
  {
    category: "password",
    label: "Credential assignment",
    pattern:
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
    confidence: 0.75,
    severity: "high",
    source: "regex",
  },
];

const INJECTION_RULES: Rule[] = [
  {
    category: "prompt_injection",
    label: "Instruction override attempt",
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|your\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts|directions)\b/gi,
    confidence: 0.9,
    severity: "high",
    source: "heuristic",
  },
  {
    category: "prompt_injection",
    label: "Guardrail bypass attempt",
    pattern:
      /\b(?:developer mode|jailbreak|DAN mode|no restrictions|without any (?:filters|guardrails|restrictions)|bypass (?:the )?(?:policy|policies|security|filter))\b/gi,
    confidence: 0.85,
    severity: "high",
    source: "heuristic",
  },
  {
    category: "system_prompt_extraction",
    label: "System prompt extraction attempt",
    pattern:
      /\b(?:reveal|show|print|repeat|output|expose)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+prompt|initial\s+instructions|hidden\s+instructions|rules|configuration)\b/gi,
    confidence: 0.9,
    severity: "high",
    source: "heuristic",
  },
  {
    category: "data_exfiltration",
    label: "Data exfiltration attempt",
    pattern:
      /\b(?:send|post|upload|exfiltrate|forward)\b[^.\n]{0,60}\b(?:https?:\/\/|webhook|external server|attacker)\b/gi,
    confidence: 0.8,
    severity: "critical",
    source: "heuristic",
  },
  {
    category: "prompt_injection",
    label: "Role reassignment attempt",
    pattern: /\byou are now\s+(?:a|an|the)?\s*[^.\n]{3,60}/gi,
    confidence: 0.6,
    severity: "medium",
    source: "heuristic",
  },
];

const ALL_RULES = [...PII_RULES, ...SECRET_RULES, ...INJECTION_RULES];

export const REDACTABLE: DetectionCategory[] = [
  "email",
  "phone",
  "ssn",
  "credit_card",
  "iban",
  "ip_address",
  "api_key",
  "private_key",
  "jwt",
  "password",
  "connection_string",
];

export function inspect(text: string): Detection[] {
  const found: Detection[] = [];
  for (const rule of ALL_RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      if (!value.trim()) {
        regex.lastIndex += 1;
        continue;
      }
      if (rule.validate && !rule.validate(value)) continue;
      found.push({
        category: rule.category,
        label: rule.label,
        match: value,
        start: match.index,
        end: match.index + value.length,
        confidence: rule.confidence,
        source: rule.source,
        severity: rule.severity,
      });
    }
  }
  // Deduplicate overlapping matches, keeping the highest-confidence detection.
  found.sort((a, b) => a.start - b.start || b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const detection of found) {
    const overlaps = kept.some(
      (k) =>
        detection.start < k.end && k.start < detection.end && k.category === detection.category,
    );
    if (!overlaps) kept.push(detection);
  }
  return kept;
}

/** Replaces every redactable detection with a category token. */
export function redact(text: string, detections: Detection[]): string {
  const targets = detections
    .filter((d) => REDACTABLE.includes(d.category))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  // Merge overlaps before replacement: replacing one match changes offsets and
  // can otherwise leave fragments of a nested credential or corrupt its token.
  const spans: Array<{ start: number; end: number; category: string }> = [];
  for (const d of targets) {
    const previous = spans[spans.length - 1];
    if (previous && d.start < previous.end) previous.end = Math.max(previous.end, d.end);
    else spans.push({ start: d.start, end: d.end, category: d.category });
  }
  let cursor = 0;
  let output = "";
  for (const span of spans) {
    output += text.slice(cursor, span.start) + `[REDACTED:${span.category.toUpperCase()}]`;
    cursor = span.end;
  }
  return output + text.slice(cursor);
}

export function maskPreview(text: string, detections: Detection[], limit = 400): string {
  return redact(text, detections).slice(0, limit);
}
