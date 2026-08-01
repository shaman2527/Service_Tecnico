# Governance — Meta-Engine (Nivel 1+2 del $P)

## ¿Qué es?

El sistema de gobernanza es el **meta-engine** del patrón $P. Mientras que `tools/code-generator/` (Nivel 0) genera código de páginas, `tools/governance/` (Nivel 1+2) **observa, analiza, decide y mejora** el propio generador.

## Ciclo: Estado → Razón → Actuar → Observar → Reflexionar

```
[Estado] → Lee AGENTS.md + file system + planes actuales
    │
[Razón]  → Pattern Detector busca placeholders, repeticiones, templates faltantes
    │
[Actuar] → Crea templates nuevos o ejecuta el code-generator
    │
[Observar] → Build validator corre npm run build, parsea errores
    │
[Reflexionar] → Docs-sync actualiza AGENTS.md con el resultado
```

## Arquitectura

```
tools/governance/
├── run.ts                ← Orquestador: ejecuta el ciclo completo
├── types.ts              ← Tipos compartidos (PatternMatch, BuildResult, SessionState)
├── pattern-detector.ts   ← Escanea el proyecto, busca placeholders/repeticiones
├── template-generator.ts ← Escribe templates nuevos en code-generator/templates/
├── build-validator.ts    ← Corre npm run build, parsea errores TypeScript
├── docs-sync.ts          ← Lee/actualiza AGENTS.md, genera reportes de sesión
└── README.md             ← Este archivo
```

## Cómo usarlo

```bash
# Ciclo completo (detectar + generar + build + docs)
npx tsx tools/governance/run.ts

# Solo detectar patrones, sin generar ni build
npx tsx tools/governance/run.ts --detect-only

# Solo correr build validation
npx tsx tools/governance/run.ts --build-only

# Preview sin escribir archivos
npx tsx tools/governance/run.ts --dry-run

# Saltar archivos existentes
npx tsx tools/governance/run.ts --skip
```

## Patrones que detecta

| Patrón | Confianza | Acción |
|--------|-----------|--------|
| Páginas con "Pendiente de implementación" | 0.95 | Ejecutar code-generator |
| ≥3 páginas con misma estructura repetitiva | 0.85 | Crear template especializado |
| Tabla definida en schema pero sin código generado | 0.90 | Ejecutar code-generator |
| Layout PanelLayout sin template especializado | 0.80 | Crear panel-component + panel-api |

## Cómo extenderlo

1. **Nuevo detector**: editar `pattern-detector.ts`, agregar un nuevo `PatternKind` en `types.ts`
2. **Nuevo generador de template**: editar `template-generator.ts`, agregar función generadora
3. **Nuevo validador**: editar `build-validator.ts` (ej: correr tests además de build)
4. **Ciclo personalizado**: editar `run.ts` para agregar pasos al bucle

## Relación con el $P original

| Componente $P | tools/governance |
|---------------|-----------------|
| Engine (bucle ciego) | `run.ts` — itera: detecta → decide → actúa → observa |
| Tools/Registry | `pattern-detector.ts` + `template-generator.ts` + `build-validator.ts` |
| State/Config | `types.ts` + `AGENTS.md` |
| Output | Templates nuevos, AGENTS.md actualizado, session report |

## Replicabilidad

Todo `tools/governance/` es auto-contenido y no depende de archivos del proyecto específico (más allá de `tools/code-generator/types.ts` y `AGENTS.md`). Para usarlo en otro proyecto:

1. Copiar `tools/governance/` 
2. Asegurar que exista `tools/code-generator/` con types compatibles
3. Asegurar que exista `AGENTS.md` en la raíz
4. Opcional: adaptar `pattern-detector.ts` para el stack del proyecto
