#!/usr/bin/env bash
set -euo pipefail

# Idempotent: only append if not already present, so rebuilds don't stack duplicates.
if ! grep -q 'ship()' "$HOME/.zshrc" 2>/dev/null; then
  cat >> "$HOME/.zshrc" <<'EOF'

# Launch Claude inside a durable tmux session (survives VS Code/SSH disconnect).
# Usage: `ship` to start/reattach the autonomous run; plain `claude` for interactive.
ship() {
  tmux attach -t ship 2>/dev/null || tmux new -s ship 'claude'
}
EOF
fi