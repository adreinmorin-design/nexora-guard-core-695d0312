# Device AI discovery

NEXORA can inventory AI desktop applications and local AI runtimes from an
**enrolled, explicitly connected device agent** on Team and Enterprise plans.

A web page cannot inspect arbitrary processes or installed applications on a
user's desktop. Device discovery therefore uses the NEXORA agent trust boundary
instead of attempting browser-based surveillance.

## What the collector reports

The included collector recognizes a bounded allowlist of common AI desktop apps
and local runtimes from running process names. The report contains only:

- platform (`windows`, `macos`, or `linux`)
- an optional administrator-chosen device label
- product name and vendor
- observation category
- optional product version when a future collector can determine it safely
- whether the product is currently observed
- timestamps maintained by the server

The collector does **not** send command-line arguments, full executable paths,
prompts, files, document names, browser history, page URLs, API keys, cookies,
tokens, or arbitrary process inventories.

Browser-based AI usage cannot be inferred from a normal web application.
A future browser extension, MDM connector, or approved network telemetry source
can report the same bounded observation schema as `browser_extension` or
`configured_provider` observations.

## Enrollment and reporting

1. Connect a NEXORA agent from **Connect agent** and keep the issued bearer token
   on the managed endpoint.
2. Configure:
   - `NEXORA_URL=https://<your-nexora-host>`
   - `NEXORA_AGENT_TOKEN=<agent bearer token>`
   - optionally `NEXORA_DEVICE_LABEL=<friendly managed-device name>`
3. Run:

   ```bash
   bun run desktop:discover
   ```

The collector posts to `/api/agent/inventory`. The server verifies the agent
credential, organization, active Team-or-Enterprise entitlement and report size
before storing any observation.

## Continuous discovery

The script is designed to be run by an administrator-approved scheduler such as
Windows Task Scheduler, launchd, systemd, an MDM tool, or an enterprise endpoint
management platform. NEXORA itself does not silently install or persist a
collector on user devices.
