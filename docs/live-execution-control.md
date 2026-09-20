# Live execution and AI administration

NEXORA exposes two operator-facing control surfaces.

## Live Agent Execution Control

The live execution screen renders server-generated execution events in the same
order the request is evaluated:

1. Identity
2. Permissions
3. PII / secret inspection
4. Prompt-injection and exfiltration detection
5. Budget / request-cost admission
6. Provider selection
7. Tool authorization
8. Execution
9. Audit persistence

Events deliberately exclude raw prompts, raw responses, credentials and tokens.
For model requests, tool authorization is marked not applicable. MCP tool
requests use the same timeline and show the actual grant/policy decision.

The UI polls every second so a buyer can watch a request move through the
control plane without presenting synthetic stage animation as real telemetry.

## AI Administration

Organization administrators can control:

- organization-wide execution
- console execution
- agent execution
- per-request estimated-cost ceiling
- provider lifecycle state
- model lifecycle state
- individual agent lifecycle state
- organization budget limits

The master execution switch fails closed in the server execution path. Provider,
model and agent lifecycle controls are also rechecked by the governed request
path immediately before work is dispatched.

These controls preserve configuration and audit history when execution is
suspended.
