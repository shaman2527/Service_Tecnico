// F69 — EL CAJÓN, EXPLICADO ANTES DE CONTARLO (módulo PURO, sin React).
//
// El hallazgo central de la auditoría de entrega (`AUDITORIA_ENTREGA.md`, A1): el cierre del día pedía
// contar el cajón contra un «esperado» que **no incluía el fondo de caja ni los gastos pagados del
// cajón**. Resultado medido en el local: un día perfecto cerraba «faltando» exactamente lo que se pagó
// del cajón, y «sobrando» el fondo que se dejó al abrir. El operario dejaba de creerle al número.
//
// Este módulo arma el desglose que el cierre muestra ANTES de pedir un solo conteo, y juzga cada línea
// contada con la tolerancia de SU moneda (`cash-closing.ts`).
//
// DOS REGLAS QUE NO SE NEGOCIAN:
//
//  1. **LAS DEVOLUCIONES NO SE RESTAN ACÁ.** Una devolución se guarda como un cobro NEGATIVO con el
//     método por el que salió la plata, así que el neto por método (`cash_bs`, `usd_cash_total`) YA
//     viene con ella adentro. Restarla otra vez descontaba la misma plata dos veces: una orden de $50
//     devuelta entera daba un «faltante» de $50 con el cajón cuadrado (lo cazó el test Rust
//     `test_refund_ledger_full`). Se informa, no se resta.
//  2. **UN NÚMERO SIN CONTAR NO ES UN NÚMERO.** Ningún campo del arqueo (efectivo, Punto, Zelle, Pago
//     Móvil, transferencia) puede entrar al cierre «porque el sistema lo dice»: la segunda mitad del
//     hallazgo A1 era que el diálogo precargaba los cobros digitales con el esperado, así que su
//     diferencia daba 0 SIEMPRE y nadie verificaba el banco. Acá cada línea tiene que quedar
//     confirmada por un acto humano (`lineasSinConfirmar`).

import { TOL_BS, TOL_USD } from './cash-closing.ts';

/** Clave de cada línea del arqueo. Estable: la usan el estado de la UI y las pruebas. */
export type ClaveArqueo = 'usd' | 'bs' | 'pos_usd' | 'pos_bs' | 'zelle' | 'pago_movil' | 'trans_bs';

export type Moneda = 'USD' | 'VES';

export interface LineaArqueo {
  clave: ClaveArqueo;
  etiqueta: string;
  /** De dónde sale el número (lo que el operario necesita saber para juzgarlo). */
  detalle: string;
  /** Monto en la moneda de la línea. */
  monto: number;
  moneda: Moneda;
  /** true = está en el cajón (se cuenta con las manos); false = se verifica en el banco/app. */
  enCajon: boolean;
}

/** Lo que ajusta el cajón ese día: viene del backend (`getDrawerAdjustments`). */
export interface AjusteCajon {
  fondo_usd: number;
  gastos_usd: number;
  gastos_bs: number;
  devoluciones_usd: number;
  devoluciones_bs: number;
  /** Gastos sin método declarado: NO se descuentan y se avisan. */
  sin_metodo: number;
}

export const AJUSTE_CERO: AjusteCajon = {
  fondo_usd: 0, gastos_usd: 0, gastos_bs: 0, devoluciones_usd: 0, devoluciones_bs: 0, sin_metodo: 0,
};

/** Lo esperado del día por método (lo que devuelve `getDailyTotals`), en lo que acá importa. */
export interface EsperadoDelDia {
  cash_usd: number;
  usd_cash_total: number;
  cash_bs: number;
  zelle_total: number;
  pago_movil_total: number;
  transfer_bs_total: number;
  pos_charged_usd: number;
  pos_charged_bs: number;
}

export interface LineaAjuste {
  etiqueta: string;
  detalle: string;
  /** Positivo = SUMA al cajón; negativo = RESTA del cajón. */
  monto: number;
  /** F69 (revisión adversarial): la moneda de la línea. Sin esto el panel imprimía «Gastos pagados
   *  del cajón (Bs.) − $500.00» con el formato del dólar, o sea mezclaba monedas justo en el número
   *  contra el que se cuenta la plata. */
  moneda: Moneda;
}

export interface DesgloseCajon {
  /** Lo que debe haber en el cajón, en dólares y en bolívares, ya ajustado. */
  esperado_usd: number;
  esperado_bs: number;
  /** Las líneas del ajuste, en orden de lectura (cobrado → fondo → gastos → esperado). */
  lineas: LineaAjuste[];
  /** Lo DEVUELTO del cajón ese día: ya está restado en lo cobrado (informativo). */
  devuelto_usd: number;
  devuelto_bs: number;
}

const r2 = (v: number) => Math.round((v ?? 0) * 100) / 100;

/** Los métodos que son PLATA FÍSICA en el cajón (los únicos que un gasto puede bajar del esperado). */
export const METODOS_DE_CAJON = ['Divisas (USD Cash)', 'Efectivo Bs'] as const;

/** ¿La plata de este método sale del cajón? (los digitales se concilian por banco). */
export function esDeCajon(method: string): boolean {
  return (METODOS_DE_CAJON as readonly string[]).includes((method ?? '').trim());
}

/**
 * El desglose del cajón: lo cobrado en efectivo (neto, ya con las devoluciones adentro) + el fondo de
 * caja − los gastos que se pagaron del cajón. Da EXACTAMENTE el mismo número que guarda `close_day`
 * en `cash_usd + usd_cash_total + fondo − gastos` (una sola regla, dos lados).
 */
export function desgloseCajon(esperado: EsperadoDelDia, ajuste: AjusteCajon = AJUSTE_CERO): DesgloseCajon {
  const cobradoUsd = (esperado.cash_usd ?? 0) + (esperado.usd_cash_total ?? 0);
  const cobradoBs = esperado.cash_bs ?? 0;
  const fondo = ajuste.fondo_usd ?? 0;
  const gastosUsd = ajuste.gastos_usd ?? 0;
  const gastosBs = ajuste.gastos_bs ?? 0;
  const lineas: LineaAjuste[] = [
    {
      etiqueta: 'Cobrado en efectivo ($)',
      detalle: 'Divisas del día, ya sin lo que se devolvió del cajón',
      monto: r2(cobradoUsd),
      moneda: 'USD',
    },
    {
      etiqueta: 'Fondo de caja',
      detalle: 'Lo que se dejó al abrir el día',
      monto: r2(fondo),
      moneda: 'USD',
    },
    {
      etiqueta: 'Gastos pagados del cajón ($)',
      detalle: 'Plata que salió del cajón para pagar algo',
      monto: r2(-gastosUsd),
      moneda: 'USD',
    },
  ];
  if (Math.abs(gastosBs) > 0.005) {
    lineas.push({
      etiqueta: 'Gastos pagados del cajón (Bs.)',
      detalle: 'Plata que salió del cajón para pagar algo',
      monto: r2(-gastosBs),
      moneda: 'VES',
    });
  }
  return {
    esperado_usd: r2(cobradoUsd + fondo - gastosUsd),
    esperado_bs: r2(cobradoBs - gastosBs),
    lineas,
    devuelto_usd: r2(ajuste.devoluciones_usd ?? 0),
    devuelto_bs: r2(ajuste.devoluciones_bs ?? 0),
  };
}

/**
 * TODAS las líneas que hay que confirmar antes de cerrar, con su esperado.
 *
 * F69 (revisión adversarial) — **EL CAJÓN SE CUENTA SIEMPRE, EN LAS DOS MONEDAS.** Las dos líneas de
 * efectivo (divisas y bolívares) están siempre, aunque el esperado sea 0: el arqueo empieza por contar
 * el cajón con las manos, y si en el cajón hay Bs. 500 que el día no explica, la diferencia tiene que
 * VERSE («sobran Bs. 500,00») en vez de quedar en un 0 asumido. Además, hoy el fondo de caja sólo se
 * declara en dólares (no hay `initial_cash_bs`): contar los bolívares siempre es lo que hace visible un
 * sobrante de Bs que no viniera de ventas del día.
 *
 * Las líneas del Punto y de los bancos (Zelle, Pago Móvil, Transferencia) sí dependen del día: no se
 * pide verificar un banco por el que no entró nada. Se incluyen con `|monto| > 0.005` (los negativos
 * también: un Punto en negativo por una devolución HAY que confirmarlo — si no, el cierre queda
 * imposible, que fue un bloqueante de la revisión).
 */
export function lineasDelArqueo(esperado: EsperadoDelDia, d: DesgloseCajon): LineaArqueo[] {
  const todas: LineaArqueo[] = [
    {
      clave: 'usd', etiqueta: 'Divisas contadas ($)', enCajon: true, moneda: 'USD',
      detalle: 'Contá los dólares del cajón (fondo incluido)', monto: d.esperado_usd,
    },
    {
      clave: 'bs', etiqueta: 'Efectivo en bolívares contado (Bs.)', enCajon: true, moneda: 'VES',
      detalle: 'Contá los bolívares del cajón', monto: d.esperado_bs,
    },
    {
      clave: 'pos_usd', etiqueta: 'Punto: monto impreso ($)', enCajon: false, moneda: 'USD',
      detalle: 'El total que imprimió la máquina del Punto', monto: esperado.pos_charged_usd ?? 0,
    },
    {
      clave: 'pos_bs', etiqueta: 'Punto: monto impreso (Bs.)', enCajon: false, moneda: 'VES',
      detalle: 'El total que imprimió la máquina del Punto', monto: esperado.pos_charged_bs ?? 0,
    },
    {
      clave: 'zelle', etiqueta: 'Zelle verificado en el banco ($)', enCajon: false, moneda: 'USD',
      detalle: 'Lo que de verdad entró por Zelle', monto: esperado.zelle_total ?? 0,
    },
    {
      clave: 'pago_movil', etiqueta: 'Pago Móvil verificado (Bs.)', enCajon: false, moneda: 'VES',
      detalle: 'Lo que de verdad entró por Pago Móvil', monto: esperado.pago_movil_total ?? 0,
    },
    {
      clave: 'trans_bs', etiqueta: 'Transferencia Bs. verificada (Bs.)', enCajon: false, moneda: 'VES',
      detalle: 'Lo que de verdad entró por transferencia', monto: esperado.transfer_bs_total ?? 0,
    },
  ];
  return todas.filter(l => l.enCajon || Math.abs(l.monto) > 0.005);
}

/**
 * QUÉ FALTA CONFIRMAR. Devuelve la etiqueta de cada línea con algo que verificar que todavía nadie
 * contó/verificó. Con esto vacío, el cierre se puede guardar; con algo adentro, el diálogo no deja y
 * lo dice con el nombre de la línea (nunca un «completá los datos»).
 */
export function lineasSinConfirmar(lineas: LineaArqueo[], confirmadas: Partial<Record<ClaveArqueo, boolean>>): LineaArqueo[] {
  return lineas.filter(l => !confirmadas[l.clave]);
}

/** Texto para el operario cuando intenta cerrar sin contar algo. */
export function faltaConfirmar(faltantes: LineaArqueo[]): string {
  if (faltantes.length === 0) return '';
  const nombres = faltantes.map(l => l.etiqueta);
  if (nombres.length === 1) return `Falta contar/verificar: ${nombres[0]}.`;
  return `Falta contar/verificar: ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}.`;
}

export type EstadoLinea = 'sin_contar' | 'cuadrado' | 'sobra' | 'falta';

export interface DiferenciaLinea {
  /** Contado − esperado, en la moneda de la línea. */
  dif: number;
  ok: boolean;
  estado: EstadoLinea;
  /** Texto corto y en la moneda real: «Cuadrado», «sobran $2.00», «faltan Bs. 1.000,00». */
  texto: string;
}

const miles = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formato de la moneda de la línea (mismo signo-antes-de-la-moneda que el Libro Diario). */
export function formatoMoneda(v: number, moneda: Moneda): string {
  const signo = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  return moneda === 'USD' ? `${signo}$${abs.toFixed(2)}` : `${signo}Bs. ${miles(abs)}`;
}

/**
 * La diferencia de UNA línea. `contado === null` = nadie contó: no se inventa un 0 (ese 0 es lo que
 * hacía que un cierre sin arqueo pareciera «faltó todo el cajón»), se dice «sin contar».
 */
export function diferenciaLinea(l: LineaArqueo, contado: number | null): DiferenciaLinea {
  if (contado === null) {
    return { dif: 0, ok: false, estado: 'sin_contar', texto: 'Sin contar' };
  }
  const tol = l.moneda === 'USD' ? TOL_USD : TOL_BS;
  const dif = r2(contado - l.monto);
  if (Math.abs(dif) < tol) {
    return { dif, ok: true, estado: 'cuadrado', texto: 'Cuadrado' };
  }
  return {
    dif,
    ok: false,
    estado: dif > 0 ? 'sobra' : 'falta',
    texto: `${dif > 0 ? 'sobran' : 'faltan'} ${formatoMoneda(Math.abs(dif), l.moneda)}`,
  };
}

/**
 * El valor que se manda al backend para una línea: lo contado si se contó, y el esperado si no había
 * nada que contar (esperado 0 → mandar 0 es la verdad, no una suposición). Nunca se manda el esperado
 * «porque sí»: eso es exactamente lo que hacía que la diferencia diera 0 siempre.
 */
export function valorParaCerrar(l: LineaArqueo, contado: number | null): number {
  if (Math.abs(l.monto) <= 0.005) return 0;
  return contado ?? 0;
}
