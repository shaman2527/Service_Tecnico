# Loop Engineering — Orquestador Multi-Fase

Orquesta el ciclo completo de desarrollo: 9 fases que se ejecutan secuencialmente
hasta cumplir un goal. Cada iteración = una feature.

## ¿Qué hace?

```
Ejecuta un goal → itera fases → evalúa condiciones → repite o cierra
```

## Goals disponibles

| Goal | Condiciones | Uso |
|---|---|---|
| `build-pass` | build ✅ | Verificación rápida de build |
| `truth-pass` | build + truth + tests + endpoints | Validación completa |
| `mvp-complete` | build + truth + tests + placeholders + endpoints | Cerrar MVP |
| `full-cycle` | todo + deploy_ready | Despliegue a producción |

## Las 9 fases

```
FASE 1: Learning Injector   → Carga patrones de sesiones anteriores
FASE 2: Context Guard        → Verifica scope vs feature activa
FASE 3: Governance           → Detecta placeholders → genera código
FASE 4: Security Gate        → Escanea secrets, debug, RLS
FASE 5: Build                → npm run build
FASE 6: Reviewer             → Revisa convenciones y arquitectura
FASE 7: Truth                → Smoke tests en endpoints
FASE 8: Deploy Readiness     → Env, migrations, debug, RLS, e2e
FASE 9: Feature Closer       → Marca feature "done", actualiza historial
```

## Cómo usarlo

```bash
# Goal por defecto: mvp-complete
npx tsx loop/run.ts

# Goal específico
npx tsx loop/run.ts --goal build-pass

# Reanudar loop anterior
npx tsx loop/run.ts --resume

# Modo verbose
npx tsx loop/run.ts --verbose

# Modo tests forzado
npx tsx loop/run.ts --tests

# Rama + archive
npx tsx loop/run.ts --branch feat/nueva-feature --archive
```

## Uncle Bob Flow (TDD completo)

```
FASE 3a: Spec Partner    → Genera especificación dura
FASE 3b: TDD Craftsman   → Red → Green → Refactor
FASE 3c: Mutation Test   → Mutation score >= 90%
```

```bash
npx tsx loop/run.ts --goal uncle-bob-flow
```

## Persistencia

El loop guarda su estado en `progress/loops/{goalId}.json` para poder reanudar
si se interrumpe. Incluye:

- Iteración actual
- Resultados de cada fase
- Errores encontrados
- Timestamps

## Arquitectura

```
loop/
├── run.ts                   ← CLI entry point
├── loop-engine.ts           ← Orquestador de 9 fases
├── goal-definitions.ts      ← Definiciones de goals y condiciones
├── types.ts                 ← Tipos del loop
└── self-improve.ts          ← Auto-mejora de las tools
```
