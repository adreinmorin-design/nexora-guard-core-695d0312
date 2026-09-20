#!/usr/bin/env node
/**
 * NEXORA desktop AI discovery collector.
 *
 * Explicitly run this on an enrolled device. It reports only bounded product
 * metadata for recognized AI desktop apps/local runtimes. It does NOT collect
 * command-line arguments, file paths, prompts, document names, browser history,
 * page URLs, credentials, or arbitrary process names.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const endpoint = (process.env.NEXORA_URL || "").replace(/\/$/, "");
const token = process.env.NEXORA_AGENT_TOKEN || "";

if (!endpoint || !token) {
  console.error("Set NEXORA_URL and NEXORA_AGENT_TOKEN before running discovery.");
  process.exit(1);
}

const signatures = [
  { match: /chatgpt/i, name: "ChatGPT", vendor: "OpenAI", kind: "desktop_app" },
  { match: /claude/i, name: "Claude", vendor: "Anthropic", kind: "desktop_app" },
  { match: /copilot/i, name: "Copilot", vendor: "Microsoft", kind: "desktop_app" },
  { match: /cursor/i, name: "Cursor", vendor: "Anysphere", kind: "desktop_app" },
  { match: /windsurf|codeium/i, name: "Windsurf", vendor: "Codeium", kind: "desktop_app" },
  { match: /ollama/i, name: "Ollama", vendor: "Ollama", kind: "local_runtime" },
  { match: /lm[ -]?studio/i, name: "LM Studio", vendor: "LM Studio", kind: "local_runtime" },
  { match: /gpt4all/i, name: "GPT4All", vendor: "Nomic AI", kind: "local_runtime" },
  { match: /jan(?:\.exe)?$/i, name: "Jan", vendor: "Jan", kind: "local_runtime" },
];

async function runningProcessNames() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^"([^"]+)"/)?.[1] ?? "")
      .filter(Boolean);
  }

  const { stdout } = await execFileAsync("ps", ["-A", "-o", "comm="], {
    maxBuffer: 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split("/").at(-1) ?? "")
    .filter(Boolean);
}

const platform =
  process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const deviceId = createHash("sha256")
  .update([os.hostname(), os.platform(), os.arch()].join("|"), "utf8")
  .digest("hex");

const names = await runningProcessNames();
const found = new Map();
for (const processName of names) {
  const signature = signatures.find((entry) => entry.match.test(processName));
  if (!signature) continue;
  const key = signature.kind + ":" + signature.vendor + ":" + signature.name;
  found.set(key, {
    kind: signature.kind,
    name: signature.name,
    vendor: signature.vendor,
    active: true,
  });
}

const response = await fetch(endpoint + "/api/agent/inventory", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    device_id: deviceId,
    ...(process.env.NEXORA_DEVICE_LABEL
      ? { device_label: process.env.NEXORA_DEVICE_LABEL.slice(0, 80) }
      : {}),
    platform,
    idempotency_key: randomUUID(),
    observations: [...found.values()],
  }),
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error("NEXORA discovery report failed:", body.error || response.statusText);
  process.exit(1);
}
console.log(`NEXORA accepted ${body.observations ?? 0} AI observations.`);
