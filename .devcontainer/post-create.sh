#!/usr/bin/env bash
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

expected_bun="1.4.2"
current_bun=""

if command -v bun >/dev/null 2>&1; then
  current_bun="$(bun --version 2>/dev/null || true)"
fi

if [[ "$current_bun" != "$expected_bun" ]]; then
  echo "Installing Bun $expected_bun..."
  rm -rf "$BUN_INSTALL"
  curl -fsSL https://bun.sh/install | bash -s "bun-v$expected_bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if [[ "$(bun --version)" != "$expected_bun" ]]; then
  echo "Expected Bun $expected_bun but found $(bun --version)" >&2
  exit 1
fi

# Persist Bun for interactive bash terminals even outside VS Code remoteEnv.
if ! grep -q 'export BUN_INSTALL="$HOME/.bun"' "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<'EOF'

# Bun (Nexora Codespace)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF
fi

# Nexora is Bun-managed. Remove only an untracked npm lockfile that may have
# been created accidentally in a disposable Codespace.
if [[ -f package-lock.json ]] && ! git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
  rm -f package-lock.json
fi

echo "Bun: $(bun --version)"
echo "Node: $(node --version)"

bun install --frozen-lockfile

echo "Nexora Codespace bootstrap complete."
