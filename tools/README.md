# Harness ENGINEERING

Stack-agnostic engineering tools for AI-assisted software development.

```
 _   _                     _            _____ _____ _   _ ___________ _   _ _   _  _____ 
| | | |                   | |          |  ___|  ___| \ | |  _  | ___ \ \ | | \ | |/  ___|
| |_| | __ _ _ __ ___   __| | ___ _ __ | |__ | |__ |  \| | | | | |_/ /  \| |  \| |\ `--. 
|  _  |/ _` | '_ ` _ \ / _` |/ _ \ '__||  __||  __|| . ` | | | |    /| . ` | . ` | `--. \
| | | | (_| | | | | | | (_| |  __/ |   | |___| |___| |\  | |/ /| |\ \| |\  | |\  |/\__/ /
\_| |_/\__,_|_| |_| |_|\__,_|\___|_|   \____/\____/\_| \_/___/ \_| \_\_| \_\_| \_/\____/ 
```

**Created by Shaman / Roberth Silva** — [github.com/shaman2527](https://github.com/shaman2527)

---

## ¿Cómo funciona?

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  ⚡ CLI: npx tsx cli/index.ts                            │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
    ┌──────────────────────────┐     ┌──────────────────────────────┐
    │  PROYECTO EXISTENTE      │     │  PROYECTO NUEVO              │
    │                          │     │                              │
    │  1. Escanea docs/        │     │  1. Elige stack:             │
    │     - ARCHITECTURE.md    │     │     🌐 Frontend (Astro,Next) │
    │     - conventions.md     │     │     ⚙️ Backend (Go,Django,   │
    │     - DATABASE.md        │     │            FastAPI,Rust)     │
    │     - feature_list.json  │     │     🖥️ Desktop (Tauri)       │
    │     - AGENTS.md          │     │                              │
    │     - package.json       │     │  2. Elige base de datos      │
    │     - go.mod / Cargo.toml│     │     (Supabase,Postgres,SQLite)│
    │                          │     │                              │
    │  2. Extrae automático:   │     │  3. Elige estructura         │
    │     ✓ projectName        │     │     (monolith, fe+be, cs)    │
    │     ✓ frameworks         │     │                              │
    │     ✓ roles              │     │  4. Scaffold automático      │
    │     ✓ database           │     │     - Astro → create-astro  │
    │     ✓ build/deploy       │     │     - Next → create-next-app │
    │     ✓ estructura         │     │     - Go → go mod init      │
    │                          │     │     - Django → pip + start   │
    │  3. Pre-flight:          │     │     - Rust → cargo init     │
    │     - init.ps1 / setup.sh│     │     - FastAPI → main.py gen │
    │     - npm run build      │     │                              │
    │                          │     │  5. Genera docs base:        │
    │  4. Copia tools/         │     │     ARCHITECTURE.md          │
    │     + crea config.ts     │     │     conventions.md           │
    │                          │     │     verification.md          │
    │  5. Listo para trabajar  │     │     CHECKPOINTS.md           │
    │                          │     │     feature_list.json        │
    └──────────┬───────────────┘     │     AGENTS.md                │
               │                     │                              │
               └──────────┬──────────┘  6. Instala dependencias    │
                          │               7. Copia tools/           │
                          ▼               8. Crea config.ts         │
            ┌─────────────────────────┐  9. Crea .gitignore        │
            │  Tools configuradas     │                              │
            │  tools/config.ts listo  │                              │
            │  tools/ instalado       │                              │
            └──────────┬──────────────┘                              │
                       │                                            │
                       ▼                                            │
            ┌──────────────────────────────────────────────────────┐ │
            │  🚀 Harness ENGINEERING — Listo para trabajar        │ │
            │                                                     │ │
            │  npx tsx tools/governance/run.ts  → validar estado  │ │
            │  npx tsx tools/loop/run.ts        → orquestar MVP   │ │
            │  npx tsx tools/truth/run.ts       → verificar API   │ │
            └──────────────────────────────────────────────────────┘ │
                                                                     │
            CADA SESIÓN = CICLO COMPLETO DEL $P ENGINE               │
            ─────────────────────────────────────────────            │
            El loop itera hasta cumplir el goal del MVP              │
            Aprende de errores pasados (LearningInjector)            │
            Se auto-repara (Auto-Fix)                                │
            Mejora las tools mismas (Improver Agent)                 │
            Cierra features en feature_list.json                     │
```

---

## El $P Engine — Ciclo por Sesión

Cada vez que ejecutas el Loop Engineering, ocurre un ciclo completo:

```
FASE 0: CLI / DETECCIÓN
  ├── ¿Proyecto existe? → Lee docs + detecta stack + pre-flight
  └── ¿Nuevo proyecto?  → Scaffold + instala + configura
        │
        ▼
FASE 1: LEARNING INJECTOR
  ├── Lee progress/patterns.md (errores previos)
  ├── Lee progress/history.md (sesiones anteriores)
  └── Inyecta constraints al agente
        │
        ▼
FASE 2: CONTEXT GUARD
  ├── Lee feature_list.json → feature activa
  ├── Revisa git diff vs scope permitido
  └── Bloquea si hay cambios fuera de alcance
        │
        ▼
FASE 3: GOVERNANCE (P Engine)
  ├── Detecta placeholders en páginas
  ├── Genera código desde plans/ → templates
  │     Por cada página planificada:
  │       ├── .astro / .tsx (página + componente)
  │       ├── API route (GET/POST/PUT/DELETE)
  │       └── Zod schema (validación)
  └── Aplica auto-fix si hay errores mecánicos
        │
        ▼
FASE 4: SECURITY GATE
  ├── Escanea secrets, tokens, debug artifacts
  ├── Verifica RLS en consultas a DB
  └── Revisa imports y dependencias
        │
        ▼
FASE 5: BUILD
  ├── npm run build / go build / cargo build
  └── 0 errores → continúa | falla → auto-fix + reintenta
        │
        ▼
FASE 6: REVIEWER
  ├── Verifica convenciones del proyecto
  ├── Revisa arquitectura vs docs
  └── Sugiere mejoras
        │
        ▼
FASE 7: TRUTH SYSTEM
  ├── Smoke tests en endpoints
  ├── Verifica schemas Zod vs DB
  └── Reporta endpoints fallidos
        │
        ▼
FASE 8: DEPLOY READINESS
  ├── .env.example completo
  ├── Migraciones aplicadas
  ├── Sin debug artifacts
  └── RLS verificado
        │
        ▼
FASE 9: FEATURE CLOSER
  ├── Marca feature como "done" en feature_list.json
  ├── Mueve current.md → history.md
  ├── Actualiza CHECKPOINTS.md
  └── Build final de verificación
        │
        ▼
  🎯 GOAL CUMPLIDO → Siguiente feature
  (El loop se repite hasta que MVP esté completo)
```

---

## Arquitectura del Repo

```
harness-engineering/           ← Repo independiente (clonar en cualquier proyecto)
│
├── cli/                       ← 🆕 Instalador inteligente
│   ├── index.ts               ← Entry point: detecta o pregunta
│   ├── reader.ts              ← Escanea docs + package.json + detecta stack
│   ├── rules.ts               ← Reglas fijas (pre-flight, stacks, scaffold)
│   └── scaffold/              ← Templates para proyectos nuevos
│       ├── docs/              ← ARCHITECTURE.md, conventions.md, verification.md
│       ├── CHECKPOINTS.md
│       ├── feature_list.json
│       ├── AGENTS.md
│       └── init.sh
│
├── p-engine/                  ← Core stack-agnostic
│   ├── core/types.ts          ← PagePlan, Stack interface
│   ├── index.ts               ← PEngine class (generate → build → test → truth)
│   └── stacks/                ← Adaptadores por stack
│       ├── astro/index.ts     ← ✅ Astro (producción)
│       └── next/index.ts      ← 🚧 Next.js (en desarrollo)
│
├── governance/                ← Meta-engine de validación
│   ├── run.ts                 ← Ciclo: estado → detectar → generar → build → docs
│   ├── build-validator.ts     ← Ejecuta build y parsea errores
│   ├── security-validator.ts  ← Escanea secrets, debug, RLS
│   ├── reviewer-bus.ts        ← Revisa convenciones + arquitectura
│   ├── context-guard.ts       ← Valida scope vs feature activa
│   ├── feature-closer.ts      ← Cierra features, mueve historial
│   ├── learning-injector.ts   ← Aprende de errores pasados
│   └── pattern-detector.ts    ← Encuentra placeholders + repeticiones
│
├── loop/                      ← Orquestador multi-fase
│   ├── loop-engine.ts         ← 9 fases: learn → guard → gov → security → build → review → truth → deploy → close
│   ├── run.ts                 ← CLI entry point con goals
│   ├── goal-definitions.ts    ← mvp-complete, build-pass, truth-pass, etc.
│   └── self-improve.ts        ← Mejora las tools mismas
│
├── truth/                     ← Sistema de verificación
│   ├── truth-orchestrator.ts  ← Coordina smoke tests + endpoint checks
│   ├── runtime-smoke.ts       ← Tests de runtime real
│   └── run.ts
│
├── code-generator/            ← Motor de generación template-driven
│   ├── engine.ts              ← generatePage() → 3-4 archivos por página
│   ├── templates/             ← Astro, Admin, Panel, API, Zod
│   └── plans/                 ← ← Tus page plans aquí
│       └── example-plans.ts
│
├── auto-fix/                  ← Auto-reparación
│   ├── engine.ts              ← Detecta issues → genera fix → aplica
│   ├── audit.ts               ← Escanea el proyecto
│   └── safe-apply.ts          ← Aplica fixes con validación
│
├── mutation/                  ← Mutation testing
├── agents/                    ← Sub-agentes (implementer, reviewer, improver, etc.)
├── auto-skill.sh              ← 🆕 Recomienda skills según stack
├── config.example.ts          ← Template de configuración
└── package.json
```

---

## ¿Cómo se adapta a cualquier proyecto?

**Regla #1: El repo no tiene datos de ningún proyecto.**

Cada proyecto que usa Harness ENGINEERING crea sus propios archivos:

```
  📁 mi-proyecto/
  ├── tools/                    ← Clon de harness-engineering
  │   ├── config.ts             ← ← TU configuración (nombre, roles, stack, DB)
  │   └── code-generator/
  │       └── plans/
  │           └── mvp-pages.ts  ← ← TUS page plans (qué construir)
  ├── docs/                     ← TU documentación
  │   ├── ARCHITECTURE.md
  │   ├── conventions.md
  │   └── verification.md
  ├── feature_list.json         ← TUS features (qué falta por hacer)
  ├── CHECKPOINTS.md            ← TUS criterios de finalización
  └── AGENTS.md                 ← Identidad de TU proyecto
```

**Las tools leen `config.ts` y se adaptan:**
- Roles → los que definiste
- Stack → Astro, Next, Go, Rust, etc.
- Database → Supabase, PostgreSQL, SQLite
- Page plans → los que escribiste en `mvp-pages.ts`

---

## ¿Qué pasa en cada sesión de trabajo?

```
SESIÓN 1: CLI configura el proyecto
  ├── Detecta stack, roles, DB
  ├── Crea tools/config.ts
  └── Pre-flight: build pasa ✅
        │
SESIÓN 2: Loop Engineering — Primera feature
  ├── Governance detecta placeholders
  ├── P Engine genera 5 páginas desde plans/
  ├── Build validation
  ├── Truth system verifica endpoints
  └── Feature Closer marca feature #1 "done"
        │
SESIÓN 3: Loop Engineering — Segunda feature
  ├── LearningInjector: "en la sesión 2 el error fue X"
  ├── ContextGuard: "solo puedes tocar estos archivos"
  ├── P Engine genera nuevas páginas
  ├── SecurityGate: "no hay secrets expuestos"
  ├── Build + Tests + Truth
  └── Feature Closer marca feature #2 "done"
        │
  ... (cada sesión = 1 feature, el loop itera automáticamente)
        │
SESIÓN N: MVP Completo
  ├── Todas las features "done"
  ├── CHECKPOINTS.md: todos los checkboxes ✅
  ├── Build + Tests + Truth: todo verde
  └── Proyecto listo para producción
```

---

## ¿Las tools se mejoran a sí mismas?

**Sí.** El sistema tiene 3 niveles de auto-mejora:

| Nivel | Mecanismo | Qué hace |
|---|---|---|
| 🧠 **Learning Injector** | Guarda errores en `progress/patterns.md` | No repites el mismo error dos veces |
| 🔧 **Auto-Fix** | Detecta + corrige issues mecánicos | console.log, imports rotos, tipos faltantes |
| 🚀 **Improver Agent** | Escanea tools vs roadmap | Propone mejoras al sistema de herramientas |

---

## Stacks Soportados

| Categoría | Stack | Estado | Scaffolding |
|---|---|---|---|
| 🌐 Frontend | Astro + React + Tailwind | ✅ Producción | `create-astro` |
| 🌐 Frontend | Next.js + React + Tailwind | ✅ CLI listo | `create-next-app` |
| ⚙️ Backend | Go (Gin/Fiber/Echo) | ✅ CLI listo | `go mod init` |
| ⚙️ Backend | Python Django | ✅ CLI listo | `pip install django` |
| ⚙️ Backend | Python FastAPI | ✅ CLI listo | `pip install fastapi` |
| ⚙️ Backend | Rust (Actix/Axum) | ✅ CLI listo | `cargo init` |
| 🖥️ Desktop | Tauri + Rust + React | ✅ CLI listo | `create-tauri-app` |

---

## Base de Datos

| Motor | Docker | Env Vars |
|---|---|---|
| Supabase (PostgreSQL + Auth) | — | `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| PostgreSQL | `docker compose up -d` | `DATABASE_URL` |
| SQLite | — | `DATABASE_PATH` |

---

*Harness ENGINEERING — Created by Shaman / Roberth Silva*
*https://github.com/shaman2527*
