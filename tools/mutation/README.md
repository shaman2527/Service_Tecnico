# Mutation Testing — Calidad de Tests

Evalúa la calidad de tu suite de tests introduciendo pequeños bugs
(mutaciones) en el código de producción y verificando si los tests los detectan.

## ¿Qué hace?

```
1. Toma tu código de producción
2. Introduce una mutación (bug pequeño)
3. Ejecuta los tests
4. ¿Test falló? → Mutación detectada ✅
5. ¿Test pasó? → Mutación sobrevivió ❌
```

## Score de supervivencia

| Score | Significado |
|---|---|
| 0-10% | Suite de tests excelente |
| 10-30% | Buena, pero hay áreas sin cubrir |
| 30-50% | Regular, muchas mutaciones sobreviven |
| 50%+ | Mala, los tests no protegen el código |

## Cómo usarlo

```bash
# Ejecutar mutation testing completo
npx tsx mutation/mutation-tester.ts

# Solo ver mutaciones que sobreviven
npx tsx mutation/survivors.ts

# Modo incremental (solo archivos modificados)
npx tsx mutation/incremental.ts
```

## Componentes

| Módulo | Función |
|---|---|
| `mutation-tester.ts` | Orquestador: muta → test → reporta |
| `survivors.ts` | Analiza mutaciones que no fueron detectadas |
| `incremental.ts` | Solo muta archivos cambiados desde último commit |
| `mutate.ts` | Aplica mutaciones al código |
| `incremental.ts` | Modo incremental para CI |

## Relación con el $P Engine

Mutation testing es parte del **Uncle Bob Flow** en el Loop Engineering.
Se ejecuta después del TDD Craftsman para verificar que los tests
realmente protegen el código. Score mínimo requerido: 90%.
