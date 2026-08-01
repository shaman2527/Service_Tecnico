#!/usr/bin/env bash
# ============================================================
# tools/setup.sh — Setup engineering tools for a new project
# ============================================================
# Run from your project root: bash tools/setup.sh
#
# This script:
#   1. Installs Node.js dependencies needed by the tools
#   2. Verifies required CLI tools (git, node, npm)
#   3. Checks that the tools directory is properly structured
# ============================================================

set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "============================================"
echo "  Harness ENGINEERING — Setup"
echo "============================================"

# ---- Check prerequisites ----
echo ""
echo "📋 Checking prerequisites..."

# Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -ge 20 ]; then
        echo -e "  ${GREEN}✅ Node.js $(node -v)${NC}"
    else
        echo -e "  ${RED}❌ Node.js >= 20 required (found $(node -v))${NC}"
        exit 1
    fi
else
    echo -e "  ${RED}❌ Node.js not found. Install Node.js >= 20${NC}"
    exit 1
fi

# npm
if command -v npm &>/dev/null; then
    echo -e "  ${GREEN}✅ npm $(npm -v)${NC}"
else
    echo -e "  ${RED}❌ npm not found${NC}"
    exit 1
fi

# Git
if command -v git &>/dev/null; then
    echo -e "  ${GREEN}✅ Git $(git --version | cut -d' ' -f3)${NC}"
else
    echo -e "  ${RED}❌ Git not found${NC}"
    exit 1
fi

# ---- Install dependencies ----
echo ""
echo "📦 Installing tools dependencies..."

cd "$PROJECT_ROOT"

if [ -f "tools/package.json" ]; then
    npm install --prefix tools --save-dev typescript tsx vitest zod 2>&1 | sed 's/^/  /'
    echo -e "  ${GREEN}✅ Tools dependencies installed${NC}"
else
    echo -e "  ${YELLOW}⚠️  No tools/package.json found. Skipping dependency install.${NC}"
fi

# ---- Verify key tools are runnable ----
echo ""
echo "🔍 Verifying tools..."

if npx tsx --version &>/dev/null; then
    echo -e "  ${GREEN}✅ tsx available${NC}"
else
    echo -e "  ${RED}❌ tsx not available — run 'npm install' in project root${NC}"
    exit 1
fi

# ---- Check project-specific setup ----
echo ""
echo "📁 Checking project structure..."

if [ -d "src" ]; then
    echo -e "  ${GREEN}✅ src/ directory found${NC}"
else
    echo -e "  ${YELLOW}⚠️  No src/ directory — tools expect Astro project structure${NC}"
fi

if [ -d "supabase/migrations" ]; then
    echo -e "  ${GREEN}✅ supabase/migrations/ directory found${NC}"
else
    echo -e "  ${YELLOW}⚠️  No supabase/migrations/ — tools work without Supabase but migration features limited${NC}"
fi

# Create artifacts directory
if [ ! -d "tools/progress/artifacts" ]; then
    mkdir -p "tools/progress/artifacts"
    echo -e "  ${GREEN}✅ Created tools/progress/artifacts/${NC}"
fi

# ---- Done ----
echo ""
echo "============================================"
echo -e "  ${GREEN}✅ Tools setup complete!${NC}"
echo ""
echo "  Quick start:"
echo "    npx tsx tools/loop/run.ts              # Full engineering loop"
echo "    npx tsx tools/loop/run.ts --goal build-pass  # Quick build check"
echo "    npx tsx tools/governance/run.ts        # Governance engine"
echo "    npx tsx tools/truth/run.ts             # Truth system"
echo ""
echo "  See tools/README.md for full documentation."
echo "============================================"
