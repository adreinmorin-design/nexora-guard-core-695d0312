export type AlertSeverity = "warning" | "critical";
export type AlertCategory = "runtime" | "provider" | "billing" | "security";

export type SlackAlert = {
  category: AlertCategory;
  severity: AlertSeverity;
  summary: string;
  route?: string;
  status?: number;
  provider?: string;
  eventType?: string;
};

export type SlackAlertResult = {
  sent: boolean;
  reason?: "not_configured" | "invalid_webhook" | "duplicate" | "delivery_failed";
};

const DEDUPE_WINDOW_MS = 60_000;
const DELIVERY_TIMEOUT_MS = 2_000;
const MAX_VALUE_LENGTH = 180;
const recentAlerts = new Map<string, number>();

function nonEmpty(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function safeValue(value: string): string {
  return Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .trim()
    .slice(0, MAX_VALUE_LENGTH);
}

function configuredSlackWebhook(): { url?: string; reason?: SlackAlertResult["reason"] } {
  const raw = nonEmpty("SLACK_WEBHOOK_URL");
  if (!raw) return { reason: "not_configured" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "invalid_webhook" };
  }

  const trustedHost = url.hostname === "hooks.slack.com" || url.hostname === "hooks.slack-gov.com";
  if (
    url.protocol !== "https:" ||
    !trustedHost ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith("/services/")
  ) {
    return { reason: "invalid_webhook" };
  }

  return { url: url.toString() };
}

function alertKey(alert: SlackAlert): string {
  return [
    alert.category,
    alert.severity,
    alert.summary,
    alert.route ?? "",
    alert.status ?? "",
    alert.provider ?? "",
    alert.eventType ?? "",
  ].join("|");
}

function isDuplicate(alert: SlackAlert): boolean {
  const now = Date.now();
  for (const [key, timestamp] of recentAlerts) {
    if (now - timestamp > DEDUPE_WINDOW_MS) recentAlerts.delete(key);
  }
  const key = alertKey(alert);
  const previous = recentAlerts.get(key);
  if (previous && now - previous < DEDUPE_WINDOW_MS) return true;
  recentAlerts.set(key, now);
  return false;
}

export function buildSlackAlertPayload(alert: SlackAlert) {
  const environment = safeValue(
    nonEmpty("NEXORA_ENVIRONMENT") ?? nonEmpty("NODE_ENV") ?? "unknown",
  );
  const summary = safeValue(alert.summary);
  const fields = [
    { type: "mrkdwn", text: `*Severity*\n${alert.severity.toUpperCase()}` },
    { type: "mrkdwn", text: `*Category*\n${safeValue(alert.category)}` },
    { type: "mrkdwn", text: `*Environment*\n${environment}` },
  ];

  if (alert.status !== undefined) {
    fields.push({ type: "mrkdwn", text: `*Status*\n${alert.status}` });
  }
  if (alert.route) {
    fields.push({ type: "mrkdwn", text: `*Route*\n${safeValue(alert.route)}` });
  }
  if (alert.provider) {
    fields.push({ type: "mrkdwn", text: `*Provider*\n${safeValue(alert.provider)}` });
  }
  if (alert.eventType) {
    fields.push({ type: "mrkdwn", text: `*Event*\n${safeValue(alert.eventType)}` });
  }

  return {
    text: `[NEXORA ${alert.severity.toUpperCase()}] ${summary}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `NEXORA ${alert.severity === "critical" ? "Critical Alert" : "Warning"}`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${summary}*` },
      },
      {
        type: "section",
        fields,
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "No prompts, credentials, request bodies, tenant data, or user identifiers are included.",
          },
        ],
      },
    ],
  };
}

export async function notifySlackAlert(alert: SlackAlert): Promise<SlackAlertResult> {
  const configured = configuredSlackWebhook();
  if (!configured.url) return { sent: false, reason: configured.reason };
  if (isDuplicate(alert)) return { sent: false, reason: "duplicate" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(configured.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSlackAlertPayload(alert)),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      console.warn(`[monitoring] Slack alert delivery failed with status ${response.status}`);
      return { sent: false, reason: "delivery_failed" };
    }
    return { sent: true };
  } catch {
    console.warn("[monitoring] Slack alert delivery failed");
    return { sent: false, reason: "delivery_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
