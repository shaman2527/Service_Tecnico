# Truth System — Verificación de Extremo a Extremo

Sistema de smoke tests, verificación de endpoints y chequeos de runtime.
Valida que el sistema realmente funcione, no solo que compile.

## ¿Qué hace?

```
Ejecuta tests reales contra:
  - Endpoints HTTP (GET, POST, PUT, DELETE)
  - Schemas Zod vs base de datos real
  - Migraciones SQL
  - Estado del servidor (dev/prod)
```

## Cómo usarlo

```bash
# Truth completo (incluye servidor de prueba)
npx tsx truth/run.ts

# Truth sin servidor (solo chequeos de esquema y migraciones)
npx tsx truth/run.ts --skip-server

# Solo verificar endpoints
npx tsx truth/run.ts --skip-server --skip-tests
```

## Tipos de verificación

| Tipo | Qué verifica | Ejemplo |
|---|---|---|
| **Smoke test** | Endpoint responde 200 | `GET /api/usuarios → 200` |
| **Schema check** | Zod schema coincide con DB | `usuarios.id es UUID` |
| **Auth check** | Endpoint requiere sesión | `DELETE /api/usuarios → 401 sin auth` |
| **Migration check** | Migraciones aplicadas | `0022_empleados aplicada` |
| **Server health** | Servidor responde | `localhost:4321/health → 200` |

## Arquitectura

```
truth/
├── run.ts                   ← CLI entry point
├── truth-orchestrator.ts    ← Coordina todas las verificaciones
├── runtime-smoke.ts         ← Pruebas de runtime real
├── types.ts                 ← Tipos del truth system
└── agent.md                 ← Instrucciones para el agente
```

## Cómo agregar un test nuevo

1. Editar `runtime-smoke.ts`
2. Agregar un nuevo chequeo usando `checkEndpoint()`:

```typescript
const result = await checkEndpoint("/api/mi-endpoint", {
  method: "GET",
  expectStatus: 200,
  expectBody: (body) => Array.isArray(body),
});
```

## Relación con el $P Engine

El Truth System es la **Fase 7** del Loop Engineering. Se ejecuta automáticamente
después del build y el reviewer. Si el truth falla, el loop no avanza a deploy
readiness.
