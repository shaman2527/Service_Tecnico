# Code Generator — Template-Driven Engine

Genera páginas, componentes, APIs y schemas desde templates. Cada llamada a
`generatePage()` produce 3-4 archivos por página.

## ¿Qué genera?

```
Por cada página en mvp-pages.ts:
  ├── .astro / .tsx       → Página con layout (AdminLayout/PanelLayout)
  ├── Componente React     → CRUD / Read-only / Dashboard / Operations
  ├── API route            → GET (listar con search) + POST/PUT/DELETE
  └── Zod schema           → Validación (solo si pageType === "crud")
```

## Cómo usarlo

```bash
# Generar todas las páginas desde mvp-pages.ts
npx tsx code-generator/run.ts

# Opciones
npx tsx code-generator/run.ts --dry-run     # Preview sin escribir
npx tsx code-generator/run.ts --page /admin/usuarios  # Solo una página
npx tsx code-generator/run.ts --skip        # No sobrescribir existentes
npx tsx code-generator/run.ts --incremental # Solo cambiar lo nuevo
```

## Templates disponibles

| Template | Archivo | Uso |
|---|---|---|
| Astro Page | `templates/astro-page.ts` | Página .astro con layout y componente |
| Admin CRUD | `templates/admin-crud-component.tsx` | CRUD completo con toolbar + search + form + inline edit |
| Admin Read-only | `templates/admin-readonly-component.tsx` | Solo tabla con búsqueda y paginación |
| Admin Dashboard | `templates/admin-dashboard-component.tsx` | Dashboard con stats cards |
| Admin API | `templates/admin-api.ts` | API REST: GET/POST/PUT/DELETE con auth |
| Panel API | `templates/panel-api.ts` | API solo GET filtrada por tenant (apartamento_id) |
| Panel CRUD | `templates/panel-crud-component.tsx` | CRUD para propietarios |
| Zod Schema | `templates/zod-schema.ts` | Validación de datos |
| Placeholder | `templates/placeholder-component.tsx` | "Pendiente de implementación" |

## Cómo crear un template nuevo

1. Crear `code-generator/templates/mi-template.ts`
2. Exportar una función que reciba `PageConfig` y retorne `string`
3. Conectarlo en `code-generator/engine.ts` dentro de `generatePage()`

## PageConfig

```typescript
interface PageConfig {
  route: string;           // /admin/usuarios
  role: string;            // admin, user
  title: string;           // "Usuarios"
  layout: "AdminLayout" | "PanelLayout";
  pageType: "crud" | "readonly" | "dashboard" | "operations";
  table: string;           // tabla en BD
  listFields: string[];    // columnas a mostrar
  formFields: string[];    // campos del formulario
  apiEndpoint: string;     // /api/admin/usuarios
}
```

## Estructura de archivos

```
code-generator/
├── engine.ts              ← Orquestador: itera pages → llama templates
├── run.ts                 ← CLI entry point
├── types.ts               ← ColumnDef, TableSchema, PageConfig, getTableSchema()
├── lib/
│   └── file-writer.ts     ← writeFile con modos (overwrite, skip, hash)
├── plans/
│   ├── mvp-pages.ts       ← ← TUS page plans (se genera desde example)
│   └── example-plans.ts   ← Ejemplo para copiar
└── templates/             ← Templates de código
    ├── astro-page.ts
    ├── admin-crud-component.ts
    ├── admin-readonly-component.ts
    ├── admin-api.ts
    └── ... (10 templates total)
```
