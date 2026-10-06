import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// This is a built-server smoke test with synthetic credentials. It is not
// authentication, backend connectivity, provider execution or governance proof.
const build = JSON.parse(await readFile(".output/nexora-build.json", "utf8"));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const sentinel = "sb_secret_runtime_only_portability_sentinel";
const child = spawn(process.execPath, ["scripts/start-portable.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    SUPABASE_SERVICE_ROLE_KEY: sentinel,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk;
});
child.stderr.on("data", (chunk) => {
  logs += chunk;
});
const origin = `http://127.0.0.1:${port}`;
const probes = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Portable server exited before liveness");
    try {
      const r = await fetch(`${origin}/api/live`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* waiting for listener */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "server must start");
  for (const [path, init, status] of [
    ["/api/live", {}, 200],
    ["/auth", {}, 200],
    [
      "/api/agent",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      401,
    ],
    ["/api/mcp", { method: "POST", headers: { Origin: "https://foreign.example" } }, 403],
  ]) {
    const r = await fetch(origin + path, init);
    const body = await r.text();
    assert.equal(r.status, status, path);
    assert.equal(r.headers.get("x-nexora-commit"), build.sha);
    assert.match(r.headers.get("x-nexora-correlation-id") ?? "", /^[a-f0-9-]{36}$/);
    assert.ok(!body.includes(sentinel));
    if (path === "/api/live") assert.equal(JSON.parse(body).sha, build.sha);
    probes.push({
      path,
      status,
      sha: r.headers.get("x-nexora-commit"),
      correlationId: r.headers.get("x-nexora-correlation-id"),
    });
  }
  async function scan(directory) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${file.name}`;
      if (file.isDirectory()) await scan(path);
      else
        assert.ok(
          !(await readFile(path, "utf8")).includes(sentinel),
          "runtime credential must not enter client artifacts",
        );
    }
  }
  await scan(".output/public");
  assert.ok(!logs.includes(sentinel), "runtime credential must not enter logs");
  await mkdir("artifacts/portability", { recursive: true });
  await writeFile(
    "artifacts/portability/smoke.json",
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        kind: "local_built_server_smoke",
        sha: build.sha,
        node: process.versions.node,
        probes,
        secretSentinelAbsent: true,
        limitations: [
          "synthetic backend credentials",
          "no authenticated session",
          "no successful backend or provider call",
          "not production runtime verification",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ result: "PASS", probes: probes.length, sha: build.sha }));
} finally {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  if (child.exitCode === null) await exited;
}
