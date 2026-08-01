#!/bin/bash
# Sync tools/ to harness-engineering repo
# Usage: ./sync-to-harness-engineering.sh [commit-message]
# Run from project root (where tools/ lives).

set -euo pipefail

HARNESS_REPO="${HARNESS_REPO:-git@github.com:shaman2527/harness-engineering.git}"
TMP_DIR=$(mktemp -d)

MSG="${1:-chore: sync tools/ from $(basename "$(pwd)")}"

echo "=== Harness ENGINEERING Sync ==="
echo "  Source: $(pwd)/tools"
echo "  Target: $HARNESS_REPO"
echo ""

# Clone fresh copy of harness-engineering
echo "Cloning harness-engineering..."
git clone --depth=1 "$HARNESS_REPO" "$TMP_DIR/harness-engineering"

# Remove everything except .git
echo "Cleaning target..."
find "$TMP_DIR/harness-engineering" -mindepth 1 -not -path "$TMP_DIR/harness-engineering/.git" \
  -not -path "$TMP_DIR/harness-engineering/.git/*" -delete 2>/dev/null || true

# Ensure empty
rm -rf "$TMP_DIR/harness-engineering"/*
rm -rf "$TMP_DIR/harness-engineering"/.* 2>/dev/null || true

# Copy tools/ contents into harness-engineering
echo "Copying tools/ -> harness-engineering..."
cp -r "$(pwd)/tools/"* "$TMP_DIR/harness-engineering/"
cp -r "$(pwd)/tools/".* "$TMP_DIR/harness-engineering/" 2>/dev/null || true

# Create root-level files for harness-engineering
cat > "$TMP_DIR/harness-engineering/package.json" << 'PKGEOF'
{
  "name": "harness-engineering",
  "version": "2.0.0",
  "private": true,
  "description": "Harness ENGINEERING -- Stack-agnostic tools for AI-assisted software engineering: P Engine, Governance, Loop, Code Generator, Truth, Auto-Fix, Mutation Testing.",
  "type": "module",
  "scripts": {
    "harness": "tsx cli/index.ts",
    "generate": "tsx code-generator/run.ts",
    "govern": "tsx governance/run.ts",
    "loop": "tsx loop/run.ts",
    "truth": "tsx truth/run.ts",
    "p-engine": "tsx p-engine/index.ts"
  },
  "dependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsx": "^4.16.0",
    "zod": "^3.23.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
PKGEOF

cat > "$TMP_DIR/harness-engineering/.gitignore" << 'GIEOF'
node_modules/
progress/
dist/
.env
*.log
GIEOF

# Commit and push
cd "$TMP_DIR/harness-engineering"
git add -A
if git diff --cached --quiet; then
  echo "No changes to sync."
else
  git commit -m "$MSG"
  echo "Pushing..."
  git push origin main
  echo ""
  echo "=== Sync complete! ==="
  echo "  Commit: $MSG"
fi

# Cleanup
rm -rf "$TMP_DIR"
