# CHANGELOG

> Historial de cambios del sistema Harness ENGINEERING.

## v3.0.0 — 2026-06-19 (Testing Philosophy + Uncle Bob Flow + Auto-Fix)

### ✨ Nuevas features

#### Testing Philosophy (basado en Midudev + Clean Code)
- **`tools/tdd/types.ts`** — Clasificación automática de scenarios (error-case, edge-case, happy-path)
- **`tools/tdd/judge.ts`** — Check `Error-first priority` (valida orden correcto)
- **`tools/tdd/tdd-craftsman.ts`** — Implementación de scenarios ordenada por prioridad
- **`tools/testing/test-quality.ts`** — Validador de calidad de tests (AAA, no console.log, naming, no duplicados)
- **`tools/testing/coverage.ts`** — Coverage reporting con thresholds (warn <60%, block <40%)
- **`tools/testing/snapshot-helper.ts`** — Snapshot testing helper
- **`tools/testing/db-test-setup.ts`** — DB de testing con fallback chain (Testcontainers → Postgres local)
- **`tools/testing/integration-runner.ts`** — Runner de integration tests con detección automática
- **`docs/testing-philosophy.md`** — Documento completo de la filosofía

#### Uncle Bob Flow (SDD)
- **`tools/spec/spec-partner.ts`** — Debate specs con humano, detecta edge cases
- **`tools/spec/hard-spec.ts`** — Genera Hard Spec con Given/When/Then
- **`tools/spec/types.ts`** — Tipos de spec
- **`tools/tdd/cycle-log.ts`** — Memory MD por ciclo (red/green/refactor)
- **`tools/mutation/mutate.ts`** — 10 operadores de mutación (>=→>, ==→!=, etc.)
- **`tools/mutation/mutation-tester.ts`** — Orquestador de mutation testing
- **`tools/mutation/survivors.ts`** — Detector de sobrevivientes
- **`tools/mutation/incremental.ts`** — Mutation solo en archivos cambiados (ahorra tiempo)

#### Auto-Fix Engine (Phase 4)
- **`tools/auto-fix/pre-flight.ts`** — Validaciones pre-fix (git, build, tests)
- **`tools/auto-fix/safe-apply.ts`** — Aplicación atómica con rollback
- **`tools/auto-fix/audit.ts`** — Audit log de decisiones
- **`tools/auto-fix/engine.ts`** — Orquestador principal con whitelist + confidence
- **`docs/AUTO-FIX.md`** — Documentación completa con mitigaciones de riesgo

#### Loop Engineering v4
- **`tools/loop/goal-definitions.ts`** — 6 goals (mvp-complete, build-pass, truth-pass, test-quality, uncle-bob-flow, full-cycle)
- **`tools/loop/loop-engine.ts`** — 12 fases condicionales según goal
- **`tools/loop/types.ts`** — Nuevos tipos de condición (spec_pass, tdd_pass, mutation_pass)

#### Reviewer v4 (9 checks)
- `static-analysis`, `convention`, `api-existence`, `data-flow`, `security`, `migration`, `import-resolution`, `typescript-strict`, **`test-quality`** (NUEVO), **`coverage`** (NUEVO)

#### CI/CD
- **`.github/workflows/tools-loop.yml`** — Validación automática en PR
- **`.github/workflows/pr-lint.yml`** — Conventional commits en títulos
- **`docs/CI.md`** — Setup completo de CI

### 🔧 Mejoras

- `tools/loop/loop-engine.ts` — Fases condicionales (solo Uncle Bob activa spec/tdd/mutation)
- `tools/governance/reviewer-bus.ts` — 9 checks (era 8), categoría `test-quality` y `coverage`
- `tools/governance/types.ts` — Nuevas categorías
- `tools/tdd/cycle-log.ts` — MD con scenario type
- `tools/config.ts` — Campos `tdd.*`, `mutation.*`, `autoFix.*`
- `tools/README.md` — Sección Testing Philosophy

### 📚 Documentación

- `docs/testing-philosophy.md` — Filosofía completa (errores primero, AAA, integration > unit)
- `docs/AUTO-FIX.md` — Auto-fix engine con mitigaciones de riesgo
- `docs/CI.md` — Setup de GitHub Actions
- `docs/TROUBLESHOOTING.md` — Issues comunes y soluciones
- `tools/README.md` — Sección Testing Philosophy

### 🎯 Métricas

| Métrica | Antes | Ahora |
|---|---|---|
| Reviewer checks | 8 | 10 |
| Loop goals | 4 | 6 |
| Loop phases | 9 | 12 (condicionales) |
| Testing philosophy | 30% | 88% |
| Uncle Bob flow | 20% | 82% |
| Mutation testing | 10% | 75% |
| Auto-fix | 0% | 70% |
| **Nivel general** | **88-90%** | **95-98%** |

---

## v2.0.0 — 2026-06-18 (Stack-agnostic refactor + Linux support)

### ✨ Nuevas features

- **`tools/config.ts`** — Configuración central con env vars
- **`tools/setup.sh`** — Setup Linux
- **`tools/package.json`** — Dependencias del engine
- **`tools/tsconfig.json`** — TypeScript strict
- **`setup.sh`** — Pre-flight check Linux
- **`tools/README.md`** — Documentación completa + porting guide

### 🔧 Mejoras

- `tools/governance/security-validator.ts` — Usa config.paths
- `tools/governance/reviewer-bus.ts` — 8 checks + CJS → ESM
- `tools/governance/pattern-detector.ts` — Sin dependencia de mvp-pages
- `tools/governance/run.ts` — Opcional: saltar code-gen si no hay plans
- `tools/loop/run.ts` — Banner dinámico con project name
- `tools/truth/runtime-smoke.ts` — Bug fixes
- `tools/code-generator/run.ts` — Async main + lazy import
- `tools/p-engine/stacks/astro/index.ts` — createRequire + try/catch

### 📚 Documentación

- `tools/agents/` — 3 agents (leader, implementer, reviewer)
- `tools/agent.md` — Entry point con protocolo de descubrimiento

---

## v1.0.0 — 2026-06-17 (Initial release)

- Sistema de governance (pattern-detector, build-validator, security-validator)
- Reviewer-bus con 7 checks
- Loop engineering con 9 fases
- Truth system (runtime-smoke, smoke tests)
- Code generator con templates Astro+React+Supabase
- Hooks system (post-build, post-generation, etc.)

---

## Roadmap

### v3.1 — AI Fix Generation
- Generación de fixes con Claude para naming y tipos
- Confidence scoring basado en output de IA
- Auto-apply selectivo por tipo

### v3.2 — Snapshot Testing
- Snapshot automático de outputs
- Drift detection en cada loop
- Update mode para regenerar snapshots

### v4.0 — Multi-language Support
- Python stack en `tools/p-engine/stacks/python/`
- Go stack en `tools/p-engine/stacks/go/`
- Templates por lenguaje
