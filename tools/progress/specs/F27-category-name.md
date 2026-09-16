# F27 — Fix del mapeo posicional de `category_name` (6 SELECT `p.*` en `db.rs`)

- **Feature:** `feature_list.json` id **27** (priority high) · **MODO DEV** (sin release, sin push)
- **Origen:** hallazgo MAYOR de la revisión adversarial de la feature 23 (F3). No lo introdujo F3, pero es una **pérdida
  de datos visible en la UI**: la columna «Categoría» de Inventario → Productos muestra el texto de búsqueda.
- **Estado del spec:** ✅ **implementado y verificado** (2026-09-16, MODO DEV) — evidencia en §5.

## 1. Evidencia (verificada en vivo y en la DB)

- `PRAGMA table_info(products)` → **15 columnas**: `0:id 1:name 2:category_id 3:brand 4:model 5:variant
  6:compatibility 7:price_cost 8:price_sale 9:stock 10:min_stock 11:created_at 12:updated_at 13:price_usd
  **14:search_text**`. La columna `search_text` se agregó con `ALTER TABLE` (queda al FINAL del orden físico).
- Los 6 SELECT usan `SELECT p.*, c.name as category_name ...` → `c.name` cae en el índice **15**, no en el 14.
  El mapeo `category_name: r.get(14)?` lee **`search_text`**.
- Comprobado en vivo (app de dev, IPC directo):
  `get_products('Spark 20')` → `category_id: 1` (correcto) pero
  `category_name: "pantalla infinix hot 30i go 2023 pop 7 spark 10c zte a34 zte a50 zte a54 …"` (basura = search_text).
- Sitios afectados en `src-tauri/src/db.rs`: líneas **1346** (`get_products_page`), **1497**, **1762** (`get_products`),
  **1812** (`get_low_stock_products`), **1833** (`get_reorder_suggestions`), **3455**.
- `phones.rs::get_phone_detail` tenía el mismo patrón y **ya se corrigió** en la feature 23 con lista explícita.

## 2. Fix propuesto

1. Constante única en `db.rs` con la lista **EXPLÍCITA** de columnas (regla del proyecto: nada de `p.*` cuando hay
   migraciones `ALTER TABLE`; el `SELECT s.*` con mapeo posicional ya causó `InvalidColumnType` antes):

   ```rust
   /// Columnas de `products` en orden EXPLÍCITO. `category_name` (del JOIN) va SIEMPRE al final (índice 14).
   pub(crate) const PRODUCT_COLS: &str = "p.id, p.name, p.category_id, p.brand, p.model, p.variant, \
       p.compatibility, p.price_cost, p.price_sale, p.stock, p.min_stock, p.created_at, p.updated_at, \
       p.price_usd, c.name as category_name";
   ```

   Índices resultantes: `0 id … 13 price_usd, 14 category_name` → **los mapeos actuales (`r.get(13)`/`r.get(14)`)
   quedan correctos sin tocarlos** (el diff se limita a la cláusula SELECT).
2. Sustituir en los 6 sitios `"SELECT p.*, c.name as category_name FROM …"` por
   `format!("SELECT {PRODUCT_COLS} FROM products p LEFT JOIN categories c ON p.category_id = c.id …")`
   (los `format!` ya existen en esos métodos; no hay datos de usuario en el esqueleto SQL).
3. Test nuevo `test_product_category_name_is_real_category`: con una categoría «Pantalla» y un producto, verificar
   `get_products`, `get_products_page`, `get_low_stock_products` y `get_reorder_suggestions` devuelven
   `category_name == Some("Pantalla")` (con el código viejo darían el `search_text`).

## 3. Fuera de alcance

- Cualquier otro cambio de inventario (features 24/25/26).
- Indexar/optimizar esas consultas: no hace falta (1083 productos).

## 4. Criterios de aceptación

| # | Criterio | Cómo se verifica |
|---|---|---|
| AC-1 | Los 4 comandos que devuelven productos traen `category_name` = nombre real de la categoría | test Rust nuevo + IPC en vivo (`get_products`, `get_products_page`) |
| AC-2 | La columna «Categoría» de la pestaña Productos muestra «Pantalla» (no la cadena de búsqueda) | CDP en vivo sobre la app de dev |
| AC-3 | Ningún `SELECT p.*` queda en el backend | `Select-String 'SELECT p\.\*'` → 0 resultados |
| AC-4 | `cargo test` verde, `npm run build`, `npm run lint` 0 errores, `harness_security`/`harness_truth` PASS | scripts + gates |
| AC-5 | Ningún otro dato cambia (stock, precios, conteos) | snapshot de KPIs antes/después (mismos 1083 productos / 702 unidades) |
