// Pruebas PURAS del bus de sincronización (F76) — `src/lib/sync.ts`.
//
// Lo que fijan:
//   1. QUÉ comandos avisan: los de ESCRITURA sí, los de LECTURA no (si una lectura avisara, cada
//      consulta dispararía un refresco y se armaría un bucle).
//   2. El aviso es COALESCIDO: una ráfaga de escrituras (guardar una orden multi-equipo escribe N
//      filas) produce UN solo refresco, no N.
//   3. Los oyentes se pueden dar de baja (si no, cada montaje de pantalla dejaría uno colgado).
//   4. `sinAvisar` suspende los avisos y SIEMPRE reanuda, incluso si la función falla.
//   5. El rótulo del indicador («hace un momento», «hace 3 min») no miente.
//
// Uso:  node tools/sync_test.ts

import {
  comandoEscribe, dataVersion, onDataChanged, bumpDataVersion, sinAvisar, reiniciarSync,
  ultimoAviso, haceCuanto, COALESCE_MS,
} from '../src/lib/sync.ts';

let checks = 0;
let failures = 0;
function ok(what: string, cond: boolean, detalle = '') {
  checks++;
  if (!cond) { failures++; console.log(`FALLA · ${what}${detalle ? ` — ${detalle}` : ''}`); }
}
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── 1. Qué comandos avisan ─────────────────────────────────────────────────────────────────────
{
  const escriben = [
    'add_sale', 'add_service_order', 'update_service', 'update_service_payment_date', 'set_tax_config',
    'set_service_policy', 'delete_expense', 'void_sale', 'reopen_day', 'close_day', 'open_day',
    'mark_service_printed', 'import_data', 'apply_load_list', 'restore_backup', 'backup_now',
    'recalc_paid_amount', 'mark_purchase_order_received', 'set_phone_in_use',
  ];
  for (const c of escriben) ok(`«${c}» avisa (escribe)`, comandoEscribe(c) === true);

  const leen = [
    'get_sales', 'get_services', 'get_daily_totals', 'get_products', 'get_tax_config', 'get_iva_groups',
    'get_active_day', 'get_bcv_rate', 'list_com_ports', 'search_clients', 'suggest_products',
    'export_daily_report_xlsx', 'export_data', 'check_health', 'verify_pin', 'preview_load_list',
    'list_windows_printers', 'get_dashboard_analytics', 'test_ticket',
  ];
  for (const c of leen) ok(`«${c}» NO avisa (es lectura)`, comandoEscribe(c) === false);

  ok('un nombre vacío o raro no avisa (fail-closed hacia el ruido)',
    comandoEscribe('') === false && comandoEscribe('cualquier_cosa') === false);
  ok('no distingue mayúsculas', comandoEscribe('ADD_SALE') === true && comandoEscribe('Get_Sales') === false);
}

// ── 2. El bus: avisa, coalesce y no avisa de más ────────────────────────────────────────────────
{
  reiniciarSync();
  const vistos: number[] = [];
  const baja = onDataChanged(v => vistos.push(v));
  const v0 = dataVersion();

  // Una ráfaga: 5 escrituras de golpe (como una orden multi-equipo) → UN solo aviso.
  for (let i = 0; i < 5; i++) bumpDataVersion(`escritura ${i}`);
  await dormir(COALESCE_MS + 80);
  ok('una ráfaga de 5 escrituras produce UN solo aviso', vistos.length === 1, JSON.stringify(vistos));
  ok('la versión subió una vez', dataVersion() === v0 + 1, `${v0} → ${dataVersion()}`);

  // Un aviso inmediato (volver a la app) no espera.
  bumpDataVersion('volviste a la app', { inmediato: true });
  ok('el aviso inmediato llega al toque', vistos.length === 2 && dataVersion() === v0 + 2);

  // Darse de baja: deja de escuchar (y no rompe al bus).
  baja();
  bumpDataVersion('después de la baja');
  await dormir(COALESCE_MS + 80);
  ok('un oyente dado de baja no recibe más avisos', vistos.length === 2);
  ok('…pero la versión sigue subiendo para los demás', dataVersion() === v0 + 3);

  // Varios oyentes a la vez (varias pantallas montadas).
  const a: number[] = []; const b: number[] = [];
  const bajaA = onDataChanged(v => a.push(v));
  const bajaB = onDataChanged(v => b.push(v));
  bumpDataVersion('dos pantallas', { inmediato: true });
  ok('los dos oyentes reciben el aviso', a.length === 1 && b.length === 1 && a[0] === b[0]);
  bajaA(); bajaB();
}

// ── 3. `sinAvisar` (una recarga que escribe algo no se dispara a sí misma) ──────────────────────
{
  reiniciarSync();
  const vistos: number[] = [];
  onDataChanged(v => vistos.push(v));
  await sinAvisar(async () => { bumpDataVersion('dentro de sinAvisar'); await dormir(COALESCE_MS + 60); });
  ok('dentro de `sinAvisar` NO se avisa', vistos.length === 0, JSON.stringify(vistos));
  bumpDataVersion('después', { inmediato: true });
  ok('al salir de `sinAvisar` el aviso vuelve a funcionar', vistos.length === 1);

  // Si la función falla, los avisos se reanudan igual (no queda la app muda).
  reiniciarSync();
  const vistos2: number[] = [];
  onDataChanged(v => vistos2.push(v));
  await sinAvisar(async () => { throw new Error('boom'); }).catch(() => {});
  bumpDataVersion('después del error', { inmediato: true });
  ok('si la función falla, los avisos se reanudan igual', vistos2.length === 1);
  ok('el motivo y la hora del último aviso quedan anotados',
    ultimoAviso().motivo === 'después del error' && ultimoAviso().cuando > 0);
}

// ── 4. El rótulo del indicador ────────────────────────────────────────────────────────────────
{
  const ahora = 1_700_000_000_000;
  ok('recién actualizado dice «hace un momento»', haceCuanto(ahora - 2_000, ahora) === 'hace un momento');
  ok('a los 30 s dice los segundos', haceCuanto(ahora - 30_000, ahora) === 'hace 30 s');
  ok('a los 3 min dice los minutos', haceCuanto(ahora - 180_000, ahora) === 'hace 3 min');
  ok('a las 2 h dice las horas', haceCuanto(ahora - 7_200_000, ahora) === 'hace 2 h');
  ok('un reloj raro no rompe el rótulo', haceCuanto(ahora + 5_000, ahora) === 'hace un momento');
}

reiniciarSync();
console.log(`\nsync_test: ${checks - failures}/${checks} OK${failures ? ` — ${failures} FALLAN` : ''}`);
process.exit(failures ? 1 : 0);
