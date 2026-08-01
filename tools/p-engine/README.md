# $P Engine — Core Stack-Agnostic

Motor generador de código agnóstico al stack. Es el corazón de Harness ENGINEERING.

## ¿Qué hace?

Toma **PagePlans** (descripciones de páginas) y los convierte en código real usando
el adaptador del stack correspondiente (Astro, Next.js, etc.). Luego ejecuta
build + tests + truth en ciclo completo.

```
PagePlan[] → Stack.generate() → Archivos .tsx, .astro, .api, schema
                                  ↓
                            Stack.build() → npm run build
                                  ↓
                            Stack.test()  → npm test
```

## Cómo usarlo

```typescript
import { PEngine } from "./p-engine";
import { astroStack } from "./p-engine/stacks/astro";
import { plans } from "./code-generator/plans/mvp-pages";

const engine = new PEngine({
  stack: astroStack,
  plans,
  progressDir: "tools/progress",
});

// Solo generar
await engine.generate();

// Ciclo completo: generar → build → test → truth
await engine.runFullCycle({ runTests: true });
```

## Stack Interface

Cada stack implementa:

```typescript
interface Stack {
  id: string;
  name: string;
  description: string;
  build(timeoutMs?: number): BuildResult;
  generate(plans: PagePlan[], options?: GenerateOptions): EngineState;
  test?(timeoutMs?: number): BuildResult;
}
```

## Stacks existentes

| Stack | Archivo | Estado |
|---|---|---|
| Astro + React + Tailwind | `stacks/astro/index.ts` | ✅ Producción |
| Next.js + React + Tailwind | `stacks/next/index.ts` | 🚧 Esqueleto |

## Agregar un stack nuevo

1. Crear `p-engine/stacks/mi-stack/index.ts`
2. Implementar la interfaz `Stack`
3. Usar `code-generator/engine.ts` para generar archivos
4. Agregar el stack a `cli/rules.ts` para que el CLI lo ofrezca

## Tipos principales

| Tipo | Propósito |
|---|---|
| `PagePlan` | Qué construir (ruta, título, API, columnas) |
| `PageConfig` | Plan expandido con layout, rol, pageType |
| `Stack` | Interfaz que cada stack debe implementar |
| `BuildResult` | Resultado del build (éxito, errores, duración) |
| `EngineState` | Resultado de generación (archivos generados, errores) |
