#!/usr/bin/env bash
# Push the latest committed skill versions into every Claude profile on this machine.
# Run after committing a change here (remember to bump the plugin's version first).
set -euo pipefail

cd "$(dirname "$0")"
PLUGINS=$(python3 -c "import json; print(' '.join(p['name'] for p in json.load(open('.claude-plugin/marketplace.json'))['plugins']))")

run_profile() {
  local label="$1"; shift
  echo "== $label"
  for plugin in $PLUGINS; do
    "$@" claude plugin update "$plugin@downey-skills"
  done
}

run_profile "claude (default)"  env -u CLAUDE_CONFIG_DIR
run_profile "claude-personal"   env CLAUDE_CONFIG_DIR="$HOME/.config/claude-code-personal"
run_profile "claude-skyline"    env CLAUDE_CONFIG_DIR="$HOME/.config/claude-code-skyline"

echo "Done. Restart running Claude sessions to pick up the new versions."
