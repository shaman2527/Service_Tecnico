// F74 — EL IVA (regla pura, sin React): cuánto es base, cuánto es IVA y cuánto se cobra.
//
// Pedido del dueño (2026-09-25): «incluye el IVA que se pueda activar o desactivar… todo listo para
// producción, que tome sus centavos sincronizado con la tasa del día BCV».
//
// DECISIONES (confirmadas por el dueño):
//   · El IVA se puede **activar o desactivar** (con el switch apagado NADA cambia: los precios de hoy
//     quedan como están).
//   · La alícuota es **configurable** (16% por defecto, la general de Venezuela).
//   · El modo es **configurable**: «incluido» (el precio ya trae el IVA: el cliente paga lo mismo y la
//     factura desglosa base + IVA) o «agregado» (se suma el % al cobrar).
//   · Aplica a **ventas y servicios**.
//
// LAS TRES REGLAS DE ORO DE LA PLATA (por qué esto no puede romper la caja):
//   1. **El monto guardado es SIEMPRE lo que paga el cliente** (`sales.total` / `services.amount`).
//      El IVA no crea un segundo total: la caja, el arqueo y los saldos siguen mirando el mismo número.
//   2. **La alícuota viaja con la operación.** Cada fila guarda con qué alícuota y en qué modo se
//      cargó: un reporte de IVA de un período cerrado NO cambia porque después se mueva la alícuota
//      (misma regla que «un cierre guardado no se recalcula»).
//   3. **Los céntimos cuadran solos:** `base + iva === total` SIEMPRE, en $ y en Bs. (el IVA es el
//      residuo, no un número redondeado aparte). En bolívares el total se lleva al **bolívar entero**
//      (es efectivo) y el IVA en Bs. es `totalBs − baseBs`, así el desglose nunca deja 1 Bs. de
//      diferencia — que es exactamente lo que hace descuadrar un arqueo.
//
// Pruebas: `node tools/iva_test.ts` (puras, sin navegador).

import { redondearCentavos, redondearBolivar } from './money.ts';

export type IvaModo = 'incluido' | 'agregado';

export interface IvaConfig {
  /** ¿El negocio cobra IVA? Con `false` no se toca ningún monto (los precios quedan como están). */
  activo: boolean;
  /** Alícuota en porcentaje (16 = 16%). Editable; 0 = exento. */
  alicuota: number;
  /** «incluido» = el precio ya lo trae · «agregado» = se suma al cobrar. */
  modo: IvaModo;
}

/** Configuración de fábrica: IVA APAGADO y 16% listo para cuando lo prendan. */
export const IVA_DEFAULT: IvaConfig = { activo: false, alicuota: 16, modo: 'incluido' };

export const IVA_ALICUOTA_MAX = 100;

/**
 * Lee la configuración guardada (JSON del backend, o basura de una base vieja) y la deja SANA.
 * Fail-closed en lo que importa: si algo no se entiende, el IVA queda **apagado** (nunca se inventa un
 * impuesto que el dueño no activó) y la alícuota cae en 16.
 */
export function parseIvaConfig(raw: unknown): IvaConfig {
  let o: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try { o = JSON.parse(raw) as Record<string, unknown>; } catch { o = {}; }
  } else if (raw && typeof raw === 'object') {
    o = raw as Record<string, unknown>;
  }
  const n = Number(o.alicuota);
  const alicuota = Number.isFinite(n) ? Math.min(Math.max(n, 0), IVA_ALICUOTA_MAX) : IVA_DEFAULT.alicuota;
  const modo: IvaModo = o.modo === 'agregado' ? 'agregado' : 'incluido';
  return { activo: o.activo === true, alicuota, modo };
}

/** La configuración como la guarda el backend (una sola forma de escribirla). */
export function serializeIvaConfig(cfg: IvaConfig): string {
  return JSON.stringify(parseIvaConfig(cfg));
}

/** ¿Esta configuración cobra IVA de verdad? (activa y con alícuota > 0). */
export function ivaActivo(cfg: IvaConfig): boolean {
  return cfg.activo === true && cfg.alicuota > 0;
}

/** La alícuota como fracción (16 → 0,16). */
export const tasaDe = (alicuota: number) => (Number.isFinite(alicuota) ? alicuota : 0) / 100;

export interface DesgloseIva {
  /** ¿Entró IVA en esta cuenta? (si no, base = total e iva = 0). */
  activo: boolean;
  alicuota: number;
  modo: IvaModo;
  /** Base imponible en $ (sobre esto se calcula el IVA). */
  base: number;
  /** IVA en $ (es el RESIDUO: base + iva === total, al centavo). */
  iva: number;
  /** Lo que paga el cliente en $ (es el monto que se guarda en la operación). */
  total: number;
  /** Tasa BCV usada para la equivalencia (0 = no hay tasa del día). */
  tasa: number;
  /**
   * Equivalencia EXACTA en Bs. del día, **con sus céntimos** (base, IVA y total): es la cuenta que se
   * muestra y se imprime en bolívares multiplicando por la tasa BCV del turno. Null si no hay tasa:
   * NUNCA se inventa un número en Bs.
   */
  bs: { base: number; iva: number; total: number } | null;
  /**
   * El monto a COBRAR EN EFECTIVO en Bs.: al **bolívar entero** (en la calle no hay céntimos de
   * bolívar, y el arqueo cuenta contra la tolerancia de 0,5 Bs.). Es el número que se guarda cuando
   * el cliente paga en efectivo Bs. — así lo que dice la pantalla es lo que entra a la caja.
   * 0 si no hay tasa.
   */
  bsEfectivo: number;
}

/**
 * El desglose de lo que el operario está cargando AHORA (antes de guardar).
 *   · «incluido»: `importe` ES el total (el precio ya trae el IVA).
 *   · «agregado»: `importe` es la base y el IVA se suma (el total a cobrar es mayor).
 *   · IVA apagado: todo igual al importe (nada cambia).
 */
export function desgloseIva(importe: number, cfg: IvaConfig, opts: { tasa?: number } = {}): DesgloseIva {
  const bruto = redondearCentavos(importe);
  const r = tasaDe(cfg.alicuota);
  const tasa = Number.isFinite(opts.tasa) && (opts.tasa as number) > 0 ? (opts.tasa as number) : 0;
  if (!ivaActivo(cfg)) {
    return { activo: false, alicuota: cfg.alicuota, modo: cfg.modo, base: bruto, iva: 0, total: bruto, tasa, bs: enBolivares(bruto, bruto, tasa), bsEfectivo: bsEfectivoDe(bruto, tasa) };
  }
  if (cfg.modo === 'agregado') {
    const base = bruto;
    const iva = redondearCentavos(base * r);
    const total = redondearCentavos(base + iva);
    return { activo: true, alicuota: cfg.alicuota, modo: cfg.modo, base, iva, total, tasa, bs: enBolivares(base, total, tasa), bsEfectivo: bsEfectivoDe(total, tasa) };
  }
  // «incluido»: el importe es el total y la base sale de despejar (base = total / (1 + r)).
  const total = bruto;
  const base = redondearCentavos(total / (1 + r));
  const iva = redondearCentavos(total - base);
  return { activo: true, alicuota: cfg.alicuota, modo: cfg.modo, base, iva, total, tasa, bs: enBolivares(base, total, tasa), bsEfectivo: bsEfectivoDe(total, tasa) };
}

/**
 * El desglose de una operación YA GUARDADA. El monto guardado es el **total cobrado** y la alícuota
 * quedó anotada en la fila, así que la relación `total = base × (1 + r)` se despeja igual en los dos
 * modos (en «agregado» el operario cargó la base, en «incluido» cargó el total: el total guardado es
 * el mismo número y el desglose también).
 */
export function desgloseGuardado(total: number, ivaRate: number, opts: { tasa?: number; modo?: IvaModo } = {}): DesgloseIva {
  const t = redondearCentavos(total);
  const r = tasaDe(ivaRate);
  const tasa = Number.isFinite(opts.tasa) && (opts.tasa as number) > 0 ? (opts.tasa as number) : 0;
  const modo = opts.modo ?? 'incluido';
  if (!(ivaRate > 0) || r <= 0) {
    return { activo: false, alicuota: ivaRate, modo, base: t, iva: 0, total: t, tasa, bs: enBolivares(t, t, tasa), bsEfectivo: bsEfectivoDe(t, tasa) };
  }
  const base = redondearCentavos(t / (1 + r));
  const iva = redondearCentavos(t - base);
  return { activo: true, alicuota: ivaRate, modo, base, iva, total: t, tasa, bs: enBolivares(base, t, tasa), bsEfectivo: bsEfectivoDe(t, tasa) };
}

/**
 * La equivalencia en Bs. del día, **con céntimos** (la cuenta que se muestra y se imprime: monto ×
 * tasa BCV del turno). El IVA en Bs. es el RESIDUO (`totalBs − baseBs`) para que el desglose cierre al
 * céntimo. Aparte se informa el monto a cobrar en EFECTIVO, que va al bolívar entero (en la calle no
 * hay céntimos de bolívar y el arqueo se cuenta contra 0,5 Bs.).
 */
function enBolivares(base: number, total: number, tasa: number): DesgloseIva['bs'] {
  if (!(tasa > 0)) return null;
  const totalBs = redondearCentavos(total * tasa);
  const baseBs = redondearCentavos(base * tasa);
  return { base: baseBs, iva: redondearCentavos(totalBs - baseBs), total: totalBs };
}

/** El monto a cobrar en EFECTIVO Bs. (al bolívar entero) de un total en $ con la tasa del día. */
export const bsEfectivoDe = (total: number, tasa: number) => (tasa > 0 ? redondearBolivar(total * tasa) : 0);

/** Lo que paga el cliente por un importe cargado (el número que se guarda en la operación). */
export function totalACobrar(importe: number, cfg: IvaConfig): number {
  return desgloseIva(importe, cfg).total;
}

/** El IVA ya incluido en un monto y su base (para mostrar sin cambiar nada). */
export function ivaIncluidoEn(total: number, alicuota: number): { base: number; iva: number } {
  const d = desgloseGuardado(total, alicuota);
  return { base: d.base, iva: d.iva };
}

/** Una fila del libro de IVA: el monto guardado y con qué alícuota se cargó. */
export interface FilaIva {
  total: number;
  iva_rate: number;
}

export interface ResumenIva {
  /** Cuántas operaciones llevaron IVA. */
  operaciones: number;
  /** Base IMPONIBLE: sólo lo que llevó IVA (es lo que se declara, no toda la facturación). */
  base: number;
  /** El IVA a pagar del período. */
  iva: number;
  /** Lo cobrado por las operaciones CON IVA (base + IVA). */
  total: number;
  /**
   * Lo cobrado SIN IVA (alícuota 0: lo cargado antes de prenderlo, o lo exento). Se informa aparte
   * porque NO es base imponible: mezclarlo inflaría la declaración (y el «total cobrado» del período
   * no cuadraría con el libro del día). F74 (medido en vivo): la primera versión sumaba las dos cosas.
   */
  sinIva: number;
  /** La alícuota de las filas gravadas (0 si ninguna llevó IVA). */
  alicuota: number;
  /** ¿Hay más de una alícuota distinta en el período? (entonces no se puede decir «16%» a secas) */
  alicuotaMixta: boolean;
}

/**
 * El IVA de un período (el libro que se necesita para declarar). Suma fila por fila con la alícuota
 * de CADA fila (nunca con la de hoy) y cierra por residuo para que los centavos cuadren.
 * `base`/`iva`/`total` son SOLO de las operaciones gravadas; lo que no llevó IVA va en `sinIva`.
 */
export function ivaDelPeriodo(filas: FilaIva[]): ResumenIva {
  return sumarIva(filas.map(f => ({ total: redondearCentavos(f.total), iva_rate: f.iva_rate, operaciones: 1 })));
}

/** El acumulador común (lo usan las filas sueltas y los grupos que devuelve el backend). */
function sumarIva(filas: { total: number; iva_rate: number; operaciones: number }[]): ResumenIva {
  let base = 0;
  let iva = 0;
  let total = 0;
  let sinIva = 0;
  let operaciones = 0;
  const alicuotas = new Set<number>();
  for (const f of filas) {
    const cuantas = Math.max(0, Number(f.operaciones) || 0);
    if (cuantas === 0) continue;
    const t = redondearCentavos(f.total);
    const d = desgloseGuardado(t, f.iva_rate);
    if (!d.activo) { sinIva = redondearCentavos(sinIva + t); continue; }
    total = redondearCentavos(total + t);
    base = redondearCentavos(base + d.base);
    iva = redondearCentavos(iva + d.iva);
    operaciones += cuantas;
    alicuotas.add(d.alicuota);
  }
  const lista = [...alicuotas];
  return {
    operaciones,
    base,
    iva,
    total,
    sinIva,
    alicuota: lista.length === 1 ? lista[0] : 0,
    alicuotaMixta: lista.length > 1,
  };
}

/** El rótulo corto de la alícuota para pantalla, recibo y reportes: «16%» o «Exento». */
export function alicuotaLabel(alicuota: number): string {
  return alicuota > 0 ? `${Number(alicuota.toFixed(2))}%` : 'Exento';
}

/** El texto de cómo se está cobrando el IVA (lo usa Ajustes y el pie del formulario). */
export function modoLabel(modo: IvaModo): string {
  return modo === 'agregado' ? 'Se suma al cobrar' : 'Ya viene en el precio';
}

/**
 * Una fila AGRUPADA del libro de IVA: lo que devuelve el backend (una fila por alícuota con el total
 * sumado y cuántas operaciones la usaron). Agrupar en SQL y hacer la cuenta acá deja UNA sola
 * implementación del desglose (esta regla pura) en vez de repetir la matemática en Rust.
 */
export interface GrupoIva {
  iva_rate: number;
  total: number;
  operaciones: number;
}

/** El libro de IVA del período a partir de los grupos que devuelve el backend. */
export function ivaDeGrupos(grupos: GrupoIva[]): ResumenIva {
  return sumarIva(grupos.map(g => ({
    total: Number(g.total) || 0,
    iva_rate: Number(g.iva_rate) || 0,
    operaciones: Math.max(0, Number(g.operaciones) || 0),
  })));
}
