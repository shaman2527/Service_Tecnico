# Auto-Fix Engine — Auto-Reparación

Cierra el círculo: detecta issues → genera fix → valida → aplica automáticamente.

## ¿Qué hace?

Toma los `ReviewFinding` del reviewer-bus y aplica correcciones automáticas
para issues **mecánicos** (no requieren juicio humano).

## Tipos de fix

### Mecánicos (sin IA)

| Tipo | Descripción | Confidence | Default |
|---|---|---|---|
| `console-log` | Elimina `console.log()` de tests | 0.95 | ✅ Activo |
| `debugger` | Elimina statements `debugger` | 0.99 | ❌ |
| `var-let` | `var` → `let` | 0.9 | ❌ |
| `class-to-className` | `class=` → `className=` en JSX | 0.99 | ❌ |

### AI-generated (requiere ANTHROPIC_API_KEY)

| Tipo | Descripción |
|---|---|
| `fix-import` | Corrige imports rotos |
| `add-type` | Agrega tipos faltantes |
| `fix-async` | Agrega async/await faltante |

## Cómo usarlo

```bash
# Ejecutar auto-fix sobre todo el proyecto
npx tsx auto-fix/engine.ts

# Modo audit: solo listar issues sin corregir
npx tsx auto-fix/audit.ts

# Pre-flight: validar antes de aplicar
npx tsx auto-fix/pre-flight.ts

# Aplicar fixes específicos
npx tsx auto-fix/safe-apply.ts --type console-log,debugger
```

## Configuración en config.ts

```typescript
autoFix: {
  allowedExtensions: [".ts", ".tsx", ".astro", ".js", ".jsx"],
  maxFileSize: 1024 * 100, // 100KB max
}
```

## Agregar un fix nuevo

1. Crear el detector en `auto-fix/engine.ts`
2. Agregar el patrón a `audit.ts`
3. Agregar el safe-apply en `safe-apply.ts`

## Relación con el $P Engine

Auto-fix se ejecuta automáticamente en la **Fase 6 (Reviewer)** del Loop,
después de que el reviewer detecta issues. Cada fix aplicado se registra
en el reporte de la sesión.
