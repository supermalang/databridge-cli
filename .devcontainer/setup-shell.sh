#!/usr/bin/env bash
# .devcontainer/setup-shell.sh
# Provisions the durable-tmux "ship" workflow and a sane tmux config.
# Idempotent: safe to run on every container rebuild (postCreateCommand).
set -euo pipefail

ZSHRC="$HOME/.zshrc"
TMUX_CONF="$HOME/.tmux.conf"

# ---------------------------------------------------------------------------
# 1. tmux config — resilient defaults for long-running Claude sessions.
# ---------------------------------------------------------------------------
cat > "$TMUX_CONF" <<'EOF'
# --- databridge dev: durable session defaults ---
set -g history-limit 50000          # deep scrollback for long task logs
set -g mouse on                     # scroll + pane select with the mouse
set -g remain-on-exit on            # keep pane visible if the command exits/crashes
set -g base-index 1
setw -g pane-base-index 1
set -g default-terminal "tmux-256color"
set -sg escape-time 10
set -g status-right "#[fg=cyan]#S #[default]| %H:%M"
set -g status-style "bg=colour236,fg=white"
EOF

# ---------------------------------------------------------------------------
# 2. `ship` / `ships` helpers — durable Claude sessions owned by init (tini),
#    not the terminal. Survive VS Code close + SSH drops; resume across
#    container recreation via the persisted ~/.claude volume.
# ---------------------------------------------------------------------------
BEGIN_MARK="# >>> databridge ship helper >>>"
END_MARK="# <<< databridge ship helper <<<"

if [ -f "$ZSHRC" ] && grep -qF "$BEGIN_MARK" "$ZSHRC"; then
  sed -i "/$BEGIN_MARK/,/$END_MARK/d" "$ZSHRC"
fi

cat >> "$ZSHRC" <<EOF
$BEGIN_MARK
# ship [name]  → create-or-attach a durable tmux session (default: "claude").
#   setsid detaches the tmux server from this shell's process group, so a
#   VS Code teardown or SSH drop can't signal it — it reparents to tini
#   (PID 1; requires "init": true in devcontainer.json). Detach with Ctrl-b d.
#   On a FRESH session it runs 'claude --continue' to resume the most recent
#   conversation in this directory (state persisted in the ~/.claude volume),
#   falling back to a new 'claude' if there's nothing to resume.
ship() {
  local session="\${1:-claude}"
  if ! tmux has-session -t "\$session" 2>/dev/null; then
    setsid tmux new-session -d -s "\$session"
    tmux send-keys -t "\$session" 'claude --continue 2>/dev/null || claude' C-m
  fi
  tmux attach -t "\$session"
}

# ships → list durable sessions without attaching.
ships() {
  tmux ls 2>/dev/null || echo "no durable sessions running"
}
$END_MARK
EOF

echo "setup-shell.sh: tmux config + ship/ships helpers provisioned."