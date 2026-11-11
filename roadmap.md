# NEXORA minimal repair and verification

- [ ] Add evidence-grounded failed-request summaries via AI Gateway; test sanitization/access boundaries and verify the authenticated detail flow; update verification docs.

- [x] Restore installable dependency declarations and apply the targeted security update.
- [x] Run existing regression suites; correct only reproduced minimal defects (68/68 pass).
- [x] Exercise the actual authenticated gateway and read persisted evidence (subscription BLOCK, not successful provider execution).
- [x] Update current-state and verification ledger without removing historical evidence.
- [ ] Migrate to the personal backend: blocked by missing authorized destination connection and Cloud database export. Keep the existing Cloud backend intact.
- [ ] Complete live MCP, billing, tenant-isolation and budget proofs: dependent on appropriate real fixtures, sessions and service configuration; no simulated production results.
- [ ] Successful provider execution: blocked by inactive subscription; no entitlement bypass.
- [ ] Reconcile live schema/audit linkage: requires historical schema reconciliation before safe migration; requests.intent_id absent and blocked execution audit links incomplete.
- [ ] Complete security sign-off: remaining package advisories require separately validated compatibility upgrades.
