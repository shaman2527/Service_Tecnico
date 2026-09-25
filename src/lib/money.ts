// F73 — LA MÁSCARA DE DINERO (regla pura, sin React): lo que se escribe en un campo de plata y lo
// que vale ese texto.
//
// EL BUG QUE ARREGLA (medido en vivo, 2026-09-25): la implementación vieja (dentro de
// `components/ui/money-input.tsx`) tomaba los dígitos **sin separador** como **CENTAVOS** cuando
// pasaban de dos: escribir «145» (queriendo decir $145) dejaba **«1,45»**. Para cargar $145 había que
// teclear «14500» — una trampa en TODOS los campos de dinero de la app (arqueo del cajón, gastos,
// apertura del día, liquidar el Punto), y la causa de tres comprobaciones rojas de
// `verify_arqueo_f69.mjs` que parecían del arqueo.
//
// LA REGLA, ahora, es la que espera cualquiera que use un POS:
//   · Sin separador decimal, los dígitos son la **PARTE ENTERA**: «145» → 145; «1450» → «1.450».
//   · Con «,» o «.» lo de la derecha son **DECIMALES** (máximo 2): «145,5» → 145,50; «0,05» → 0,05.
//   · Un «.» seguido de EXACTAMENTE 3 dígitos y sin «,» se lee como **separador de MILES** al pegar
//     («1.234» → 1.234, no 1,23): evita el error de 1000× al copiar un monto.
//   · El separador que se muestra es SIEMPRE la coma (es-VE), aunque el operario teclee punto.
//   · Los céntimos NO se inventan ni se pierden: lo que muestra el campo es lo que vale
//     (`parseMoneyInput(formatMoneyInput(x))` es estable).
//
// Pruebas: `node tools/money_test.ts` (puras) y `node tools/verify_money_input.mjs` (en vivo por CDP).

/** Decimales que acepta un monto en esta app ($ y Bs. se muestran con dos). */
export const MONEY_DECIMALS = 2;

const SOLO_DIGITOS = /[^0-9]/g;
const soloDigitos = (s: string) => s.replace(SOLO_DIGITOS, '');
/** Miles con punto, como se escribe en Venezuela: 1234567 → «1.234.567». */
const agruparMiles = (entero: string) => entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const nf = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: MONEY_DECIMALS,
  maximumFractionDigits: MONEY_DECIMALS,
});

/** ¿El texto termina en separador? (el operario está por escribir los decimales: «145,») */
const terminaEnSeparador = (limpio: string) => /[.,]$/.test(limpio);

/** El último separador del texto y sus dos lados (en dígitos). */
function partes(limpio: string) {
  const ultima = Math.max(limpio.lastIndexOf(','), limpio.lastIndexOf('.'));
  if (ultima < 0) return { haySeparador: false, entero: soloDigitos(limpio), decimales: '', esMiles: false };
  const separador = limpio[ultima];
  const antes = soloDigitos(limpio.slice(0, ultima));
  const despues = soloDigitos(limpio.slice(ultima + 1));
  // «1.234» (punto + exactamente 3 dígitos, sin coma) = separador de MILES, no decimales.
  const esMiles = separador === '.' && !limpio.includes(',') && despues.length === 3;
  return {
    haySeparador: true,
    entero: esMiles ? `${antes}${despues}` : antes,
    decimales: esMiles ? '' : despues.slice(0, MONEY_DECIMALS),
    esMiles,
  };
}

/**
 * Lo que hay que MOSTRAR en el campo mientras se escribe. Es idempotente: aplicarlo dos veces da lo
 * mismo (importante: el componente lo llama en cada tecla).
 */
export function formatMoneyInput(raw: string): string {
  const limpio = String(raw ?? '').replace(/[^0-9.,]/g, '');
  if (!limpio) return '';
  const { haySeparador, entero, decimales, esMiles } = partes(limpio);
  // Sin separador: TODO es parte entera (acá estaba el bug de los centavos).
  if (!haySeparador) return agruparMiles(soloDigitos(limpio).replace(/^0+(?=\d)/, ''));
  if (esMiles) return agruparMiles(entero.replace(/^0+(?=\d)/, ''));
  const int = entero.replace(/^0+(?=\d)/, '') || (decimales || terminaEnSeparador(limpio) ? '0' : '');
  if (!int) return '';
  if (terminaEnSeparador(limpio) && !decimales) return `${agruparMiles(int)},`;
  return decimales ? `${agruparMiles(int)},${decimales}` : agruparMiles(int);
}

/**
 * El número que VALE el texto de un campo de dinero. Se le pasa lo que el campo muestra (o lo que el
 * operario escribió): acepta «1.234,56», «145,5», «145», «1.234» y «0,05». Un texto vacío o raro vale
 * 0 (nunca NaN: el monto de una operación no puede quedar en NaN).
 */
export function parseMoneyInput(text: string): number {
  const limpio = String(text ?? '').replace(/[^0-9.,]/g, '');
  if (!limpio) return 0;
  const { entero, decimales } = partes(limpio);
  const n = Number(`${entero || '0'}.${decimales || '0'}`);
  return Number.isFinite(n) ? n : 0;
}

/** Lo que se muestra cuando el campo NO está enfocado: siempre con los dos decimales. */
export function formatMoneyDisplay(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return nf.format(v);
}

/** Redondeo a CENTAVOS (la unidad contable del $). Todo monto que se guarde o se muestre pasa por acá. */
export function redondearCentavos(n: number): number {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round(v * 100) / 100;
}

/**
 * Redondeo al BOLÍVAR ENTERO. Es la regla del mostrador para el efectivo en Bs. (los billetes no
 * tienen céntimos): las ventas en Bs. se cobran así (`Sales.tsx`) y el IVA en Bs. también.
 */
export function redondearBolivar(n: number): number {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round(v);
}
