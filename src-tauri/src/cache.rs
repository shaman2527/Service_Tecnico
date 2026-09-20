//! MEMORIA CORTA DEL CATÁLOGO — feature 41: que el Inventario sea RÁPIDO en cada pestaña.
//!
//! Todo lo que el módulo Inventario muestra se DERIVA de dos tablas (`products` y `phones`), y
//! hasta ahora se recalculaba ENTERO en cada pestaña. Medido en release con los datos reales
//! (1087 productos / 1135 teléfonos, `test_manual_inventory_bench`):
//!
//!   índice de repuestos por teléfono (recorre el catálogo y parsea el JSON de
//!     compatibilidad de cada producto) .......................... 118 ms
//!   totales de los 1135 teléfonos (uno por uno) ................. ~140 ms
//!   KPIs del inventario (vuelve a normalizar los 1126 productos) . 113 ms
//!   catálogo con la compatibilidad parseada (buscador de repuesto) 240 ms
//!
//! Abrir «Modelos» costaba ~550 ms de CPU (KPIs + lista, y cada uno rehacía su parte) y volver
//! a la pestaña lo volvía a pagar.
//!
//! LA CLAVE: no hay que acordarse de avisar. La versión de los datos la da SQLite con DOS
//! números que se complementan (ver `version_of`): `SELECT total_changes()` (lo que escribió
//! ESTA conexión) y `PRAGMA data_version` (lo que escribió OTRA). Si ninguno cambió, NADA se
//! escribió y lo calculado sigue valiendo. Un contador propio se olvidaría en el próximo write
//! point (esa clase de bug ya nos pasó); los de SQLite no se pueden olvidar.
//!
//! POR QUÉ DOS Y NO UNO (hallazgo de la revisión adversarial): `total_changes()` es POR CONEXIÓN.
//! Con dos ventanas de la app abiertas (no hay guard de instancia única) o con una herramienta
//! de `tools/` cargando inventario mientras la app está abierta, una escritura ajena NO movía el
//! contador y esta memoria habría servido números viejos toda la jornada (el desplegable de
//! pantalla ofreciendo una pantalla ya instalada, y `apply_service_stock` descontando otra cosa).
//! `PRAGMA data_version` cambia en cada commit ajeno y no cambia con las escrituras propias:
//! juntos cubren las dos fuentes.
//!
//! INVARIANTE: la memoria NUNCA cambia un número. Devuelve exactamente lo mismo que el cálculo
//! directo (mismos valores, mismo orden); sólo evita repetirlo. Los tests
//! `test_catalog_cache_is_invalidated_by_writes`,
//! `test_catalog_cache_sees_writes_from_another_connection` y
//! `test_cached_catalog_keeps_the_repair_search_semantics` lo fijan.

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::{Connection, Result as SqlResult};

use crate::db::{InventoryStats, ParsedProduct};
use crate::phones::Idx;

/// Lo calculado a partir del catálogo, guardado mientras la base no cambie.
#[derive(Default)]
pub struct CatalogCache {
    /// versión de la base (ver `version_of`) con la que se calculó lo de abajo
    version: Option<(i64, i64)>,
    phone_index: Option<Arc<HashMap<String, Idx>>>,
    phone_rows: Option<Arc<Vec<crate::phones::PhoneListRow>>>,
    phone_totals: Option<Arc<HashMap<String, (i64, i64)>>>,
    stats: Option<Arc<InventoryStats>>,
    products: Option<Arc<Vec<ParsedProduct>>>,
    /// para el informe de rendimiento: cuántas veces se reconstruyó cada cosa
    builds: u32,
}

/// Versión de la base según SQLite, con DOS números que se complementan:
///   - `SELECT total_changes()`: suma 1 por cada fila que ESTA conexión inserta/actualiza/borra.
///   - `PRAGMA data_version`: sube en cada commit de OTRA conexión u otro proceso, y NO cambia
///     con las escrituras propias.
/// Se piden por SQL (rusqlite 0.31 no expone `total_changes()`); son funciones del motor, no
/// recorren ninguna tabla, así que cuestan microsegundos.
fn version_of(conn: &Connection) -> SqlResult<(i64, i64)> {
    let propias: i64 = conn.query_row("SELECT total_changes()", [], |r| r.get(0))?;
    let ajenas: i64 = conn.query_row("PRAGMA data_version", [], |r| r.get(0))?;
    Ok((propias, ajenas))
}

impl CatalogCache {
    /// Si la base cambió desde la última vez, tira todo lo calculado y anota la versión nueva.
    fn sync(&mut self, conn: &Connection) -> SqlResult<()> {
        let v = version_of(conn)?;
        if self.version == Some(v) {
            return Ok(());
        }
        self.phone_index = None;
        self.phone_rows = None;
        self.phone_totals = None;
        self.stats = None;
        self.products = None;
        self.version = Some(v);
        Ok(())
    }

    /// Cuántas veces se reconstruyó algo (lo usa el bench: si sube en cada consulta, la
    /// memoria no está sirviendo de nada).
    pub fn builds(&self) -> u32 {
        self.builds
    }

    /// Índice `teléfono -> repuestos` (lo comparten la pestaña Modelos y el buscador).
    pub(crate) fn phone_index(&mut self, conn: &Connection) -> SqlResult<Arc<HashMap<String, Idx>>> {
        self.sync(conn)?;
        if let Some(v) = &self.phone_index {
            return Ok(v.clone());
        }
        let built = Arc::new(crate::phones::build_index(conn)?);
        self.phone_index = Some(built.clone());
        self.builds += 1;
        Ok(built)
    }

    /// TODAS las filas del padrón con sus repuestos, stock y categorías (lo que muestran la
    /// pestaña Modelos y su franja de números).
    pub fn phone_rows(&mut self, conn: &Connection) -> SqlResult<Arc<Vec<crate::phones::PhoneListRow>>> {
        self.sync(conn)?;
        if let Some(v) = &self.phone_rows {
            return Ok(v.clone());
        }
        let idx = self.phone_index(conn)?;
        let built = Arc::new(crate::phones::build_rows(conn, &idx)?);
        self.phone_rows = Some(built.clone());
        self.builds += 1;
        Ok(built)
    }

    /// Repuestos y stock de CADA teléfono del padrón, por CLAVE (`clave -> (repuestos, stock)`).
    /// Se DERIVA de las filas ya calculadas: el selector de modelo del servicio y la pestaña
    /// Modelos miran así el mismo número (antes cada uno lo calculaba por su cuenta).
    pub fn phone_totals(&mut self, conn: &Connection) -> SqlResult<Arc<HashMap<String, (i64, i64)>>> {
        self.sync(conn)?;
        if let Some(v) = &self.phone_totals {
            return Ok(v.clone());
        }
        let rows = self.phone_rows(conn)?;
        let built = Arc::new(
            rows.iter().map(|r| (r.key.clone(), (r.products, r.stock))).collect::<HashMap<_, _>>(),
        );
        self.phone_totals = Some(built.clone());
        self.builds += 1;
        Ok(built)
    }

    /// KPIs del inventario (franja de números de la pestaña Productos).
    pub fn inventory_stats(&mut self, conn: &Connection) -> SqlResult<Arc<InventoryStats>> {
        self.sync(conn)?;
        if let Some(v) = &self.stats {
            return Ok(v.clone());
        }
        let built = Arc::new(crate::db::build_inventory_stats(conn)?);
        self.stats = Some(built.clone());
        self.builds += 1;
        Ok(built)
    }

    /// Catálogo con la compatibilidad YA PARSEADA (lo que evita re-parsear el JSON de cada
    /// producto en cada consulta del buscador de repuestos).
    pub(crate) fn products(&mut self, conn: &Connection) -> SqlResult<Arc<Vec<ParsedProduct>>> {
        self.sync(conn)?;
        if let Some(v) = &self.products {
            return Ok(v.clone());
        }
        let built = Arc::new(crate::db::build_parsed_products(conn)?);
        self.products = Some(built.clone());
        self.builds += 1;
        Ok(built)
    }
}
