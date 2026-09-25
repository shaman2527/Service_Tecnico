// Pruebas PURAS de `src/lib/iva.ts` (F74) — el IVA y sus centavos.
//
// Lo que fijan, en orden de importancia:
//   1. **base + iva === total al centavo**, en «incluido» y en «agregado» (el IVA es el residuo).
//   2. **En Bs. cuadra al bolívar**: `baseBs + ivaBs === totalBs` con la tasa del día, y el total se
//      cobra al bolívar entero (es efectivo) — sin esto un arqueo descuadra por 1 Bs.
//   3. **Apagado no cambia NADA**: con el switch en off el total es el importe tal cual.
//   4. **La alícuota viaja con la fila**: cambiar la alícuota hoy NO cambia el IVA de una operación
//      vieja (misma regla que «un cierre guardado no se recalcula»).
//   5. **Sin tasa no se inventa Bs.** (`bs: null`) — invariante de la casa.
//   6. Una configuración rota (JSON basura) deja el IVA APAGADO, nunca un impuesto inventado.
//
// Uso:  node tools/iva_test.ts

import {
  IVA_DEFAULT, IVA_ALICUOTA_MAX, parseIvaConfig, serializeIvaConfig, ivaActivo, tasaDe,
  desgloseIva, desgloseGuardado, totalACobrar, ivaIncluidoEn, ivaDelPeriodo, alicuotaLabel, modoLabel,
  type IvaConfig,
} from '../src/lib/iva.ts';

let checks = 0;
let failures = 0;
function ok(what: string, cond: boolean, detalle = '') {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}${detalle ? ` — ${detalle}` : ''}`); }
}
const cerca = (a: number, b: number, tol = 0.0001) => Math.abs(a - b) < tol;

const incluido: IvaConfig = { activo: true, alicuota: 16, modo: 'incluido' };
const agregado: IvaConfig = { activo: true, alicuota: 16, modo: 'agregado' };
const apagado: IvaConfig = { activo: false, alicuota: 16, modo: 'incluido' };

// ── 1. APAGADO: no cambia absolutamente nada ───────────────────────────────────────────────────
{
  ok('con el IVA apagado no está activo', ivaActivo(apagado) === false);
  for (const importe of [0, 0.05, 1, 30, 145, 1234.56]) {
    const d = desgloseIva(importe, apagado);
    ok(`apagado: $${importe} queda igual (base ${d.base} · iva ${d.iva} · total ${d.total})`,
      d.activo === false && d.iva === 0 && d.total === importe && d.base === importe);
  }
  ok('apagado: el total a cobrar es el importe', totalACobrar(30, apagado) === 30);
  ok('una alícuota 0 con el switch prendido tampoco cobra (exento)',
    ivaActivo({ activo: true, alicuota: 0, modo: 'agregado' }) === false
    && totalACobrar(30, { activo: true, alicuota: 0, modo: 'agregado' }) === 30);
}

// ── 2. AGREGADO: se suma encima y el cliente paga más ──────────────────────────────────────────
{
  const d = desgloseIva(30, agregado);
  ok('agregado: la base es lo cargado', d.base === 30);
  ok('agregado: el IVA del 16% de 30 es 4,80', d.iva === 4.8, String(d.iva));
  ok('agregado: el total a cobrar es 34,80', d.total === 34.8, String(d.total));
  ok('agregado: base + iva === total', cerca(d.base + d.iva, d.total));
  ok('agregado: es lo mismo que devuelve totalACobrar', totalACobrar(30, agregado) === d.total);
  // Un monto con céntimos que NO da un IVA redondo: el total tiene que seguir cuadrando.
  const raro = desgloseIva(12.35, agregado);
  ok('agregado con céntimos: 12,35 + 1,98 = 14,33 al centavo',
    raro.iva === 1.98 && raro.total === 14.33 && cerca(raro.base + raro.iva, raro.total),
    `base ${raro.base} · iva ${raro.iva} · total ${raro.total}`);
}

// ── 3. INCLUIDO: el cliente paga lo mismo y el IVA se desglosa ─────────────────────────────────
{
  const d = desgloseIva(34.8, incluido);
  ok('incluido: el total es lo cargado (el cliente no paga más)', d.total === 34.8);
  ok('incluido: la base se despeja (34,80 / 1,16 = 30,00)', d.base === 30, String(d.base));
  ok('incluido: el IVA es la diferencia (4,80)', d.iva === 4.8, String(d.iva));
  ok('incluido: base + iva === total', cerca(d.base + d.iva, d.total));
  ok('incluido: NO cambia lo que paga el cliente', totalACobrar(34.8, incluido) === 34.8);
  // Ida y vuelta: lo que en «agregado» daba 34,80, en «incluido» se desglosa igual.
  const a = desgloseIva(30, agregado);
  const b = desgloseIva(a.total, incluido);
  ok('los dos modos describen la MISMA plata (base 30 · iva 4,80 · total 34,80)',
    b.base === 30 && b.iva === 4.8 && b.total === 34.8, `base ${b.base} · iva ${b.iva}`);
}

// ── 4. Bs. con la tasa del día: cuadra al bolívar ──────────────────────────────────────────────
{
  const TASA = 853.4993; // una tasa real de la copia de trabajo
  const d = desgloseIva(30, agregado, { tasa: TASA });
  ok('en Bs. se informa la tasa usada', d.tasa === TASA);
  // F74 (pedido del dueño): los montos en Bs. llevan SUS CÉNTIMOS, calculados con la tasa BCV.
  ok('el total en Bs. es el total en $ por la tasa, CON céntimos',
    d.bs!.total === Math.round(d.total * TASA * 100) / 100, `${d.bs!.total} vs ${d.total * TASA}`);
  ok('la base y el IVA en Bs. también llevan céntimos',
    d.bs!.base === Math.round(d.base * TASA * 100) / 100
    && d.bs!.iva === Math.round((d.total * TASA - d.base * TASA) * 100) / 100, JSON.stringify(d.bs));
  ok('base + iva === total en Bs. al céntimo (no queda 1 Bs. de diferencia)',
    Math.abs(d.bs!.base + d.bs!.iva - d.bs!.total) < 0.005, JSON.stringify(d.bs));
  ok('el EFECTIVO en Bs. va al bolívar entero (en la calle no hay céntimos de bolívar)',
    d.bsEfectivo === Math.round(d.total * TASA) && Number.isInteger(d.bsEfectivo),
    `${d.bsEfectivo} vs ${Math.round(d.total * TASA)}`);
  ok('el efectivo es el total con céntimos redondeado al bolívar',
    Math.abs(d.bsEfectivo - d.bs!.total) <= 0.5, `${d.bsEfectivo} vs ${d.bs!.total}`);
  // Y con un total que da céntimos en Bs., el desglose sigue cerrando.
  const raro = desgloseIva(12.35, agregado, { tasa: TASA });
  ok('desglose en Bs. de un monto con céntimos: cierra igual',
    Math.abs(raro.bs!.base + raro.bs!.iva - raro.bs!.total) < 0.005, JSON.stringify(raro.bs));
  // Sin tasa cargada NO se inventa una equivalencia.
  ok('sin tasa del día no hay números en Bs. (`bs: null`)', desgloseIva(30, agregado, { tasa: 0 }).bs === null
    && desgloseIva(30, agregado).bs === null);
  ok('una tasa basura (NaN/negativa) tampoco inventa Bs.',
    desgloseIva(30, agregado, { tasa: NaN }).bs === null && desgloseIva(30, agregado, { tasa: -5 }).bs === null);
  // El IVA en Bs. tampoco se pierde cuando el total es chico.
  const chico = desgloseIva(0.5, agregado, { tasa: TASA });
  ok('un monto chico en Bs. sigue cerrando', Math.abs(chico.bs!.base + chico.bs!.iva - chico.bs!.total) < 0.005, JSON.stringify(chico.bs));
}

// ── 5. Una operación GUARDADA se lee con SU alícuota ───────────────────────────────────────────
{
  // Se cargó con 16% agregado: el monto guardado (total cobrado) es 34,80.
  const g = desgloseGuardado(34.8, 16);
  ok('guardado: base 30,00', g.base === 30, String(g.base));
  ok('guardado: IVA 4,80', g.iva === 4.8, String(g.iva));
  ok('guardado: base + iva === total', cerca(g.base + g.iva, g.total));
  ok('guardado sin IVA (alícuota 0) no desglosa nada', desgloseGuardado(34.8, 0).iva === 0
    && desgloseGuardado(34.8, 0).base === 34.8);
  // LA REGLA: cambiar la alícuota hoy no cambia la operación de ayer.
  const vieja = desgloseGuardado(34.8, 16);
  const hoyConOtraAlicuota = desgloseGuardado(34.8, 8);
  ok('una fila vieja se lee con SU alícuota (16%), no con la de hoy (8%)',
    vieja.iva === 4.8 && hoyConOtraAlicuota.iva !== vieja.iva);
  ok('el IVA incluido de un monto se puede consultar sin cambiar nada',
    JSON.stringify(ivaIncluidoEn(34.8, 16)) === JSON.stringify({ base: 30, iva: 4.8 }));
}

// ── 6. El libro del período (lo que se declara) ───────────────────────────────────────────────
{
  const resumen = ivaDelPeriodo([
    { total: 34.8, iva_rate: 16 },
    { total: 116, iva_rate: 16 },
    { total: 50, iva_rate: 0 },     // una venta sin IVA (cargada antes de activarlo)
  ]);
  // La BASE IMPONIBLE es sólo lo gravado (30 + 100 = 130) y el IVA 4,80 + 16 = 20,80: la venta de $50
  // sin IVA NO entra a la base (inflaría la declaración) y se informa aparte en `sinIva`.
  ok('el libro suma la base imponible y el IVA sólo de lo gravado (130 · 20,80)',
    resumen.base === 130 && resumen.iva === 20.8 && resumen.total === 150.8,
    JSON.stringify(resumen));
  ok('lo que no llevó IVA se informa aparte (50) y NO infla la base', resumen.sinIva === 50, String(resumen.sinIva));
  ok('el libro cierra por residuo (base + iva === total)',
    cerca(resumen.base + resumen.iva, resumen.total), JSON.stringify(resumen));
  ok('el libro cuenta las operaciones que llevaron IVA (2)', resumen.operaciones === 2);
  ok('con una sola alícuota el libro la informa', resumen.alicuota === 16 && resumen.alicuotaMixta === false);
  const mixto = ivaDelPeriodo([{ total: 116, iva_rate: 16 }, { total: 108, iva_rate: 8 }]);
  ok('con dos alícuotas el libro avisa que es mixto', mixto.alicuotaMixta === true && mixto.alicuota === 0);
  ok('un período sin operaciones da todo en 0 (no NaN)',
    JSON.stringify(ivaDelPeriodo([])) === JSON.stringify({ operaciones: 0, base: 0, iva: 0, total: 0, sinIva: 0, alicuota: 0, alicuotaMixta: false }));
  ok('montos basura no rompen el libro',
    Number.isFinite(ivaDelPeriodo([{ total: NaN, iva_rate: 16 }]).base));
}

// ── 7. La configuración: fail-closed y saneada ───────────────────────────────────────────────
{
  ok('la de fábrica está APAGADA', IVA_DEFAULT.activo === false && IVA_DEFAULT.alicuota === 16);
  ok('basura (texto) queda apagada y con 16%',
    JSON.stringify(parseIvaConfig('{no es json')) === JSON.stringify(IVA_DEFAULT));
  ok('basura (null/undefined) queda apagada', parseIvaConfig(null).activo === false && parseIvaConfig(undefined).activo === false);
  ok('un objeto válido se respeta',
    JSON.stringify(parseIvaConfig({ activo: true, alicuota: 8, modo: 'agregado' }))
    === JSON.stringify({ activo: true, alicuota: 8, modo: 'agregado' }));
  ok('el JSON del backend se entiende',
    parseIvaConfig('{"activo":true,"alicuota":16,"modo":"incluido"}').activo === true);
  ok('«activo» sólo si es exactamente true (una cadena no lo prende)',
    parseIvaConfig({ activo: 'si' }).activo === false);
  ok('una alícuota loca se recorta al rango 0…100', parseIvaConfig({ alicuota: 9999 }).alicuota === IVA_ALICUOTA_MAX
    && parseIvaConfig({ alicuota: -3 }).alicuota === 0);
  ok('una alícuota no numérica cae en 16', parseIvaConfig({ alicuota: 'mucho' }).alicuota === 16);
  ok('un modo desconocido cae en «incluido» (el que no cambia lo que paga el cliente)',
    parseIvaConfig({ modo: 'lo-que-sea' }).modo === 'incluido');
  ok('lo que se guarda vuelve saneado', serializeIvaConfig({ activo: true, alicuota: 200, modo: 'agregado' })
    === '{"activo":true,"alicuota":100,"modo":"agregado"}');
  ok('la fracción de la alícuota se calcula bien', tasaDe(16) === 0.16 && tasaDe(8) === 0.08 && tasaDe(0) === 0);
}

// ── 8. Rótulos ───────────────────────────────────────────────────────────────────────────────
{
  ok('el rótulo de la alícuota dice el porcentaje', alicuotaLabel(16) === '16%');
  ok('el rótulo de una alícuota con decimales no arrastra ceros', alicuotaLabel(8.5) === '8.5%');
  ok('la alícuota 0 se rotula «Exento»', alicuotaLabel(0) === 'Exento');
  ok('los modos se explican solos', modoLabel('agregado') === 'Se suma al cobrar'
    && modoLabel('incluido') === 'Ya viene en el precio');
}

console.log(`\niva_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
