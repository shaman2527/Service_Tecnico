// Abre el día (turno de caja) en la base que está usando la app EN VIVO, por la misma vía del
// frontend (`open_day`). Sirve para las verificaciones que exigen un día abierto (cobros, cierres,
// precios de pantalla) cuando la copia de trabajo no lo tiene.
//
// Uso:  app abierta con CDP 9222 y REGISTRO_DB=<copia>  →  node tools/abrir_dia.mjs [tasaBCV] [tasaEUR]
// Es de SOLO ESCRITURA en la copia: NUNCA apuntarlo a la base de la tienda.

import { evalx } from './cdp_driver.mjs';

const bcv = Number(process.argv[2] ?? 40);
const eur = Number(process.argv[3] ?? 45);

const r = await evalx(`(async () => {
  const I = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const antes = await I('get_active_day');
  if (antes && !antes.is_closed) {
    return { ya: true, fecha: antes.close_date, tasa: antes.tasa_bcv };
  }
  await I('open_day', { initialCashUsd: 0, tasaBcv: ${bcv}, tasaEur: ${eur} });
  const act = await I('get_active_day');
  return { ya: false, fecha: act?.close_date ?? null, tasa: act?.tasa_bcv ?? null };
})()`);

console.log(r?.ya
  ? `El día ${r.fecha} ya estaba abierto (tasa BCV ${r.tasa}). No se tocó nada.`
  : `Día ${r?.fecha} ABIERTO con tasa BCV ${r?.tasa} (sobre la base que usa la app).`);
process.exit(0); // el websocket de CDP deja el proceso vivo: se corta a mano
