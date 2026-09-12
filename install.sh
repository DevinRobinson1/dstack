#!/usr/bin/env bash
# Install the Dstack skill for Claude Code (macOS / Linux).
#   ./install.sh          symlink (repo stays source of truth; git pull updates it)
#   ./install.sh --copy   independent copy
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$REPO_DIR/skill"
DEST_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$DEST_DIR/dstack"
MODE="${1:-symlink}"

if [ ! -f "$SRC/SKILL.md" ]; then
  echo "error: $SRC/SKILL.md not found." >&2
  echo "The skill is not built yet in this checkout. See docs/plans for what builds it." >&2
  exit 1
fi
mkdir -p "$DEST_DIR"

if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  echo "removing existing $DEST"
  rm -rf "$DEST"
fi

if [ "$MODE" = "--copy" ]; then
  cp -R "$SRC" "$DEST"
  echo "installed (copy) -> $DEST"
else
  ln -s "$SRC" "$DEST"
  echo "installed (symlink) -> $DEST -> $SRC"
fi

echo
echo "Checking what Dstack can route to:"
for cli in node codex grok gemini gh; do
  if command -v "$cli" >/dev/null 2>&1; then
    printf '  %-7s %s\n' "$cli" "$("$cli" --version 2>&1 | head -1)"
  else
    printf '  %-7s not found (that route will be skipped, never silently passed)\n' "$cli"
  fi
done

if [ -f "$SRC/scripts/verify.cjs" ] && command -v node >/dev/null 2>&1; then
  echo
  echo "Verifying the installed skill is internally consistent:"
  (cd "$SRC" && node scripts/verify.cjs) || { echo "  verifier FAILED, the skill is not safe to use" >&2; exit 1; }
fi

echo
echo "Done. Start Claude Code and run: /dstack intake <what you want built>"
echo "Then copy dstack.config.example.json into your project as dstack.config.json."
