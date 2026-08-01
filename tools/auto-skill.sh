#!/usr/bin/env bash
# ============================================================
# auto-skill.sh — Harness ENGINEERING Skill Recommender
#
# Detecta el stack del proyecto y recomienda las skills
# necesarias para OpenCode / Claude Code.
#
# Uso: bash auto-skill.sh [project-root]
# ============================================================
set -euo pipefail
ROOT="${1:-.}"
SKILLS_DIR="$ROOT/.claude/skills"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { printf "${GREEN}[OK]${NC}      %s\n" "$1"; }
info() { printf "${CYAN}[INFO]${NC}     %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC}    %s\n" "$1"; }

echo ""
echo "======================================="
echo "  Harness ENGINEERING — Skill Scanner"
echo "======================================="
echo ""

# ── Detect stack from package.json ──
if [ -f "$ROOT/package.json" ]; then
  DEPS=$(node -e "const p=require('$ROOT/package.json');console.log(Object.keys({...p.dependencies,...p.devDependencies}).join(' '))" 2>/dev/null || echo "")
  
  if echo "$DEPS" | grep -q "astro"; then
    SKILLS="astro react tailwind-css-patterns supabase zod vitest typescript-advanced-types nodejs-best-practices"
    info "Stack detectado: Astro"
  elif echo "$DEPS" | grep -q "next"; then
    SKILLS="react tailwind-css-patterns supabase zod vitest typescript-advanced-types nodejs-best-practices"
    info "Stack detectado: Next.js"
  elif echo "$DEPS" | grep -q "react"; then
    SKILLS="react tailwind-css-patterns vitest typescript-advanced-types"
    info "Stack detectado: React"
  elif echo "$DEPS" | grep -q "tauri"; then
    SKILLS="rust react tailwind-css-patterns"
    info "Stack detectado: Tauri"
  fi
fi

# ── Detect backend ──
if [ -f "$ROOT/go.mod" ]; then
  SKILLS="$SKILLS go"
  info "Backend detectado: Go"
elif [ -f "$ROOT/Cargo.toml" ]; then
  SKILLS="$SKILLS rust"
  info "Backend detectado: Rust"
elif [ -f "$ROOT/manage.py" ]; then
  SKILLS="$SKILLS supabase-postgres-best-practices"
  info "Backend detectado: Django"
elif [ -f "$ROOT/main.py" ]; then
  SKILLS="$SKILLS fastapi supabase-postgres-best-practices"
  info "Backend detectado: FastAPI"
fi

# ── Skills siempre recomendadas ──
SKILLS="$SKILLS code-reviewer"

echo ""
if [ -n "$SKILLS" ]; then
  echo -e "${CYAN}Skills recomendadas para este proyecto:${NC}"
  for s in $SKILLS; do
    [ -d "$SKILLS_DIR/$s" ] && ok "$s (instalada)" || warn "$s (no instalada — ejecuta: skill use $s)"
  done
else
  warn "No se pudo detectar el stack. Skills por defecto: code-reviewer"
fi

echo ""
echo "======================================="
echo "  Para instalar una skill:"
echo "    skill use <skill-name>"
echo "======================================="
echo ""
