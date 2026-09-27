// F80 — EDITAR LA FICHA DEL REPUESTO **DESDE EL WIZARD** (reglas PURAS, sin React y sin backend).
//
// Pedido del dueño (2026-09-26): «el cliente me pide, como él usa la master, debería tener un poco más
// de flexibilidad: cuando se hace un registro, para elegir un producto desde el wizard, algo pequeño —
// un icono, por ejemplo, de la pantalla — poder editarla ahí mismo en el wizard… para no ir a
// Inventario, buscar el producto y hacer la modificación. Que tenga esa flexibilidad desde ahí: poder
// editar ese producto, cambiarle el precio, etc. Así el registro va depurando, va cargando el
// inventario.» Y al confirmar el alcance: «que también pueda editar la compatibilidad, se refleje en el
// inventario la edición» + «que me sirva, carga también nuevos stock».
//
// Este módulo es lo único que hay que acertar sin equivocarse, y por eso vive aparte y con pruebas:
//
//   1. LA COMPATIBILIDAD ES UN JSON DE TELÉFONOS que en la ficha se escribe separado por «/». Acá se
//      lee (de las dos formas), se escribe y —lo importante— se AGREGA el modelo del equipo si no está,
//      sin duplicar y sin romper lo que ya había. Es lo que hace que «el registro vaya depurando el
//      catálogo»: el repuesto que sirve para ese teléfono queda anotado como compatible.
//   2. `update_product` RECIBE LA FILA COMPLETA (12 argumentos posicionales): mandar solo lo que se
//      editó BORRA el resto (nombre, marca, compatibilidad, stock…). `argsUpdateProduct` arma esa lista
//      a partir de la fila REAL + lo que el operario tocó, y la prueba fija que lo no tocado sale
//      idéntico. Es el mismo cuidado que documenta `lib/service-update.ts` para las órdenes.
//
// Pruebas: `node tools/product_edit_test.ts`.

// `normPhoneModel` es la MISMA normalización que usa el padrón de teléfonos y el backend
// (`norm_model`): minúsculas, sin acentos, solo alfanuméricos. Con extensión explícita porque la
// prueba corre en Node puro (misma regla que `lib/reminders.ts`).
import { normPhoneModel } from './utils.ts';

/** Tope de teléfonos por ficha (el catálogo del taller ronda los 10-20 por pantalla). */
export const MAX_COMPAT = 60;

/**
 * La compatibilidad tal como se guarda (JSON array) o tal como se escribe en la ficha (`A / B / C`).
 * Siempre devuelve una lista limpia, sin vacíos y sin repetidos (comparando normalizado).
 */
export function compatDesdeCrudo(raw: string | null | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s) return [];
  let partes: string[] = [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) partes = parsed.map(x => String(x ?? ''));
    } catch {
      // JSON roto (dato viejo escrito a mano): se cae al texto plano, nunca se pierde la ficha.
      partes = s.replace(/[[\]"]/g, ' ').split('/');
    }
  } else {
    partes = s.split('/');
  }
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const p of partes) {
    const t = p.trim();
    if (!t) continue;
    const n = normPhoneModel(t);
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    out.push(t);
    if (out.length >= MAX_COMPAT) break;
  }
  return out;
}

/** La lista como se escribe/lee el operario: `Redmi Note 11 / Redmi Note 11S`. */
export function compatTexto(lista: string[]): string {
  return lista.join(' / ');
}

/** ¿Ese teléfono ya figura en la compatibilidad? (comparación normalizada, como el backend) */
export function tieneModelo(lista: string[], modelo: string): boolean {
  const n = normPhoneModel(modelo);
  if (!n) return false;
  return lista.some(m => normPhoneModel(m) === n);
}

/**
 * Suma el modelo del equipo a la compatibilidad. Devuelve la lista nueva y si REALMENTE agregó algo
 * (para poder decirle al operario «ya estaba» en vez de mentirle con un «agregado»).
 * Un modelo vacío no agrega nada: no se inventa compatibilidad.
 */
export function agregarModelo(lista: string[], modelo: string): { lista: string[]; agregado: boolean } {
  const t = (modelo ?? '').trim();
  if (!t || tieneModelo(lista, t)) return { lista, agregado: false };
  // Con la lista en el tope NO entra y se dice la verdad (`agregado: false`): avisar «agregado» y
  // devolver la misma lista sería mentirle al operario (lo cazó la prueba).
  if (lista.length >= MAX_COMPAT) return { lista, agregado: false };
  return { lista: [...lista, t], agregado: true };
}

/** Nombre con el que nace una pantalla registrada desde el wizard (el operario lo puede cambiar). */
export function nombreDePantallaNueva(modelo: string): string {
  const t = (modelo ?? '').trim();
  return t ? `Pantalla ${t}` : 'Pantalla nueva';
}

/** La fila de la ficha, con lo mínimo que este módulo necesita (el resto se reenvía tal cual). */
export interface FichaProducto {
  id: number;
  name: string;
  category_id: number | null;
  brand: string;
  model: string;
  variant: string;
  compatibility: string;
  price_cost: number;
  price_sale: number;
  stock: number;
  min_stock: number;
  price_usd: number;
}

/** Lo que el atajo corto del wizard deja tocar. `undefined` = no se tocó (se conserva). */
export interface PatchFicha {
  priceSale?: number;
  priceUsd?: number;
  stock?: number;
  /** la compatibilidad YA en texto (`A / B`) — se guarda como JSON array */
  compatibility?: string;
}

/**
 * LOS 12 ARGUMENTOS de `api.updateProduct`, en orden, tomando de la fila REAL todo lo que el operario
 * no tocó. Existe para que mandar «solo el precio» no pueda borrar el nombre, la marca, la
 * compatibilidad ni el stock (el error clásico de una llamada posicional incompleta).
 */
export function argsUpdateProduct(f: FichaProducto, patch: PatchFicha): [number, string, number | null, string, string, string, string, number, number, number, number, number] {
  return [
    f.id,
    f.name,
    f.category_id,
    f.brand,
    f.model,
    f.variant,
    patch.compatibility !== undefined ? JSON.stringify(compatDesdeCrudo(patch.compatibility)) : f.compatibility,
    f.price_cost,
    patch.priceSale !== undefined ? patch.priceSale : f.price_sale,
    patch.stock !== undefined ? patch.stock : f.stock,
    f.min_stock,
    patch.priceUsd !== undefined ? patch.priceUsd : f.price_usd,
  ];
}

/**
 * La huella de una compatibilidad: normalizada, sin repetidos y ORDENADA. El orden en que el operario
 * escriba los teléfonos no cambia nada de la ficha, así que no puede contar como «cambio» (si no, el
 * Guardar se ofrecía de gusto y el «Actualizar» quedaba encendido sin motivo).
 */
function huellaCompat(raw: string | null | undefined): string {
  const lista = compatDesdeCrudo(raw).map(normPhoneModel).filter(Boolean);
  return [...new Set(lista)].sort().join('|');
}

/** ¿El operario cambió algo? (con eso se apaga el botón Guardar del atajo: nada de guardados vacíos) */
export function patchTieneCambios(f: FichaProducto, patch: PatchFicha): boolean {
  if (patch.priceSale !== undefined && patch.priceSale !== f.price_sale) return true;
  if (patch.priceUsd !== undefined && patch.priceUsd !== f.price_usd) return true;
  if (patch.stock !== undefined && patch.stock !== f.stock) return true;
  if (patch.compatibility !== undefined) {
    return huellaCompat(patch.compatibility) !== huellaCompat(f.compatibility);
  }
  return false;
}

/**
 * LA COMPATIBILIDAD SE MANDA **SOLO SI CAMBIÓ** (hallazgo MAYOR de la revisión adversarial).
 *
 * `update_product` re-serializa la compatibilidad como JSON array, y hacerlo sin que nadie lo pida
 * DEGRADA las fichas con formato viejo: el catálogo real tiene pantallas cuyo nombre es
 * «Pantalla Alcatel 1B (3 / 4)» y cuya compatibilidad quedó partida en `["Alcatel 1B (3","Alcatel 4)"]`
 * porque el «/» separa teléfonos… y también aparece dentro de un paréntesis. Si el operario solo
 * corrige el PRECIO desde el wizard, esa cadena tiene que viajar TAL CUAL (el invariante «lo que no se
 * toca viaja idéntico»): devolver `undefined` deja que `argsUpdateProduct` reenvíe la cruda.
 */
export function compatSiCambio(f: FichaProducto, textoCompat: string): string | undefined {
  return huellaCompat(textoCompat) !== huellaCompat(f.compatibility) ? textoCompat : undefined;
}

/**
 * ¿Ese nombre de producto ya existe? (para no crear una ficha GEMELA desde el wizard: dos fichas con el
 * mismo nombre parten el stock en dos lugares y el descuento de la entrega cae en una sola).
 * Se compara plegado (sin acentos, sin mayúsculas, espacios colapsados), que es como el catálogo trata
 * los nombres al buscar.
 */
export function plegarNombre(nombre: string): string {
  return (nombre ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** La ficha del catálogo con ese nombre (o null). `catalogo` = filas con `id` y `name`. */
export function fichaConNombre<T extends { id: number; name: string }>(catalogo: T[], nombre: string): T | null {
  const q = plegarNombre(nombre);
  if (!q) return null;
  return catalogo.find(p => plegarNombre(p.name) === q) ?? null;
}
