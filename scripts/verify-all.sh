#!/usr/bin/env bash
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 1

OUT_DIR="$ROOT/artifacts/verification"
REPORT="$OUT_DIR/summary.md"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.log "$REPORT"

PASS=0
FAIL=0
ROWS=""

run_check() {
  local slug="$1"
  local label="$2"
  shift 2

  local logfile="$OUT_DIR/$slug.log"

  echo
  echo "=================================================="
  echo "CHECK: $label"
  echo "COMMAND: $*"
  echo "=================================================="

  "$@" 2>&1 | tee "$logfile"
  local rc=${PIPESTATUS[0]}

  if [[ "$rc" -eq 0 ]]; then
    PASS=$((PASS + 1))
    ROWS+="| $label | PASS | $slug.log |"$'\n'
  else
    FAIL=$((FAIL + 1))
    ROWS+="| $label | FAIL ($rc) | $slug.log |"$'\n'
  fi
}

run_check "audit" "Bun dependency audit (high)" bun audit --audit-level=high
run_check "format" "Prettier" bun run format:check
run_check "lint" "ESLint" bun run lint
run_check "typecheck" "TypeScript" bunx tsc --noEmit
run_check "build" "Production build" bun run build
run_check "security" "Security tests" bun run test:security
run_check "agents" "Agent integration tests" bun run test:agents
run_check "providers" "Provider tests" bun run test:providers
run_check "paddle" "Paddle tests" bun run test:paddle
run_check "billing" "Billing tests" bun run test:billing
run_check "gateway" "Gateway tests" bun run test:gateway
run_check "governance" "Governance core tests" bun run test:governance
run_check "database" "Database migration tests" bun run test:database
run_check "hardening" "Hardening/auth runtime tests" bun run test:hardening
run_check "monitoring" "Monitoring tests" bun run test:monitoring
run_check "email" "Email tests" bun run test:email

commit="${GITHUB_SHA:-$(git rev-parse HEAD)}"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$REPORT" <<EOF
# Nexora Verification Summary

- Commit: $commit
- Generated: $timestamp
- Bun: $(bun --version)
- Node: $(node --version)
- Passed: **$PASS**
- Failed: **$FAIL**

| Check | Result | Log |
| --- | --- | --- |
$ROWS
EOF

cat "$REPORT"

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
