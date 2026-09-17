// Pruebas de las reglas PURAS de la cola de entregas y de la pantalla (F30).
//
// La cola es lo primero que usa el operario con el cliente enfrente: si el ranking falla,
// el asistente no sirve por más rápido que sea. Acá se prueba sin navegador.
//
// Uso:  node tools/node_modules/tsx/dist/cli.mjs tools/queue_test.ts
//       (tsx resuelve los imports TS sin extensión del proyecto; `node` solo no puede)

import { rankQueue, scoreQueueMatch, queueFlags, ACTIVE_QUEUE } from '../src/lib/queue';
import { onlyScreens, screenOk, autoScreen, isCrossBrand, warnsCrossBrand } from '../src/lib/screen-rules';
import type { Service, ScreenCandidate, Product } from '../src/types';

let checks = 0;
let failures = 0;

function ok(label: string, cond: boolean, detail = '') {
  checks++;
  if (!cond) { failures++; console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ''}`); }
}

function eq(label: string, got: unknown, want: unknown) {
  checks++;
  if (got !== want) { failures++; console.log(`  ✗ ${label}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`); }
}

// Órdenes de prueba: como las reales del mostrador
const svc = (over: Partial<Service>): Service => ({
  id: 1, order_num: 'DEV-0001', date_in: '2026-09-16 10:00', client: 'Maria Perez',
  phone: '04141234567', model: 'Redmi Note 11', fault: 'pantalla rota', service_type: 'Cambio pantalla',
  service_types: '["Cambio pantalla"]', amount: 30, payment_method: 'Divisas (USD Cash)',
  date_out: null, status: 'Por entregar', observations: null, bank_fee_percent: 0,
  bank_fee_amount: 0, net_amount: 0, zelle_reference: null, currency: 'USD',
  client_ci: 'V-12345678', client_address: null, device_checklist: null, client_id: 1,
  paid_amount: 0, technician_id: 1, technician: 'Aldri', group_id: null, color: 'Azul',
  printed: 0, screen_product_id: null, discount_amount: 0,
  ...over,
} as Service);

// ── ranking de la cola ────────────────────────────────────────────────────────────────
const a = svc({ id: 1, order_num: 'DEV-0001', client: 'Maria Perez', client_ci: 'V-12345678', phone: '04141234567' });
const b = svc({ id: 2, order_num: 'DEV-0002', client: 'Jose Note', client_ci: 'V-87654321', phone: '04249876543', model: 'Samsung A30' });
const c = svc({ id: 3, order_num: 'DEV-0003', client: 'Ana Rojas', client_ci: 'V-11111111', phone: '04121111111', model: 'Poco X3' });
const cola = [a, b, c];

eq('sin texto → la cola completa, más nueva primero', rankQueue(cola, '').map(s => s.id).join(','), '3,2,1');
eq('sin texto, scoreQueueMatch no inventa coincidencia', scoreQueueMatch(a, ''), null);
eq('por número de orden exacto', rankQueue(cola, 'DEV-0002').map(s => s.id).join(','), '2');
eq('por número de orden parcial', rankQueue(cola, 'dev-000').map(s => s.id).join(','), '3,2,1');
eq('número de orden sin guion (dev0002)', rankQueue(cola, 'dev0002').map(s => s.id).join(','), '2');
eq('número de orden con espacio (DEV 0001)', rankQueue(cola, 'DEV 0001').map(s => s.id).join(','), '1');
eq('por cédula (el operario escribe 12345678)', rankQueue(cola, '12345678').map(s => s.id).join(','), '1');
eq('por cédula con prefijo V-', rankQueue(cola, 'V-87654321').map(s => s.id).join(','), '2');
eq('por teléfono', rankQueue(cola, '04121111111').map(s => s.id).join(','), '3');
eq('por teléfono parcial', rankQueue(cola, '0414').map(s => s.id).join(','), '1');
eq('por nombre (palabra completa al inicio)', rankQueue(cola, 'ana').map(s => s.id).join(','), '3');
eq('por modelo', rankQueue(cola, 'samsung').map(s => s.id).join(','), '2');
eq('lo que no existe no aparece', rankQueue(cola, 'zzzz').length, 0);

// ── acentos: lo que el operario teclea rápido va SIN tilde (bug real detectado en revisión) ──
const acentos = [svc({ id: 30, client: 'JOSÉ PÉREZ', model: 'Redmi Note 11', client_ci: null, phone: null })];
eq('nombre con tilde se encuentra sin tilde (jose)', rankQueue(acentos, 'jose').map(s => s.id).join(','), '30');
eq('nombre con tilde se encuentra con tilde (josé)', rankQueue(acentos, 'josé').map(s => s.id).join(','), '30');
eq('apellido con tilde sin tilde (perez)', rankQueue(acentos, 'perez').map(s => s.id).join(','), '30');
eq('MAYÚSCULAS del operario no fallan', rankQueue(acentos, 'JOSE').map(s => s.id).join(','), '30');
eq('varios términos en cualquier orden (redmi 11)', rankQueue(acentos, 'redmi 11').map(s => s.id).join(','), '30');
eq('varios términos invertidos (11 redmi)', rankQueue(acentos, '11 redmi').map(s => s.id).join(','), '30');
eq('dos palabras de un nombre compuesto (jose perez)', rankQueue(acentos, 'jose perez').map(s => s.id).join(','), '30');
// puntuación distinta a la del catálogo (el operario teclea guiones/puntos y el dato no los tiene)
eq('modelo «Redmi Note 11» buscado como «redmi-note-11»', rankQueue(acentos, 'redmi-note-11').length, 1);
eq('apellido con punto («perez.»)', rankQueue(acentos, 'perez.').map(s => s.id).join(','), '30');
eq('últimos dígitos del nº de orden (0001)', rankQueue(cola, '0001').map(s => s.id).join(','), '1');
// OJO con el puntaje: «0414» es prefijo de celular Y puede aparecer dentro de un nº de orden.
// La orden del cliente que llamó desde 0414 va PRIMERO; la DEV-0414 es un match débil.
eq('el teléfono real gana al nº de orden que lo contiene',
  rankQueue([
    svc({ id: 50, order_num: 'DEV-0414', client: 'Otro Cliente', client_ci: null, phone: null, model: 'Poco X3' }),
    svc({ id: 51, order_num: 'DEV-0001', client: 'Maria', client_ci: null, phone: '04141234567' }),
  ], '0414').map(s => s.id).join(','), '51,50');
eq('modelo con guion buscado sin guion (G51-5G)', rankQueue([svc({ id: 40, model: 'G51 5G', client: 'Zoe', client_ci: null, phone: null })], 'g51-5g').map(s => s.id).join(','), '40');
eq('cédula exacta gana a coincidencia suelta', rankQueue([
  svc({ id: 20, client: 'Cliente 12345678', client_ci: null }),
  svc({ id: 21, client: 'Zoe', client_ci: 'V-12345678' }),
], '12345678')[0].id, 21);
ok('mismo puntaje → la orden más nueva primero',
  rankQueue([svc({ id: 5, client: 'Carlos Uno', client_ci: null }), svc({ id: 7, client: 'Carlos Dos', client_ci: null })], 'carlos').map(s => s.id).join(',') === '7,5');
eq('el número de orden gana a todo', scoreQueueMatch(a, 'DEV-0001'), 0);
ok('un solo dígito NO busca por cédula (evita ruido)',
  scoreQueueMatch(svc({ client: 'Zoe', model: 'Poco X3', client_ci: 'V-12345678' }), '1') === null);

// ── qué le falta a la orden ───────────────────────────────────────────────────────────
const conSaldo = queueFlags(svc({ amount: 30, paid_amount: 10, screen_product_id: null }));
ok('con saldo: debe=true y saldo correcto', conSaldo.debe && conSaldo.saldo === 20, `saldo=${conSaldo.saldo}`);
ok('cambio pantalla sin pantalla elegida → pantallaPendiente', conSaldo.pantallaPendiente);
ok('orden sin imprimir → imprimible', conSaldo.imprimible);
const pagada = queueFlags(svc({ amount: 30, paid_amount: 30, screen_product_id: 4 }));
ok('pagada: debe=false', !pagada.debe);
ok('con pantalla elegida: no falta pantalla', !pagada.pantallaPendiente);
ok('no es un trabajo de pantalla → no exige pantalla',
  !queueFlags(svc({ service_types: '["Software / Formateo"]', service_type: 'Software / Formateo' })).pantallaPendiente);
ok('anulada: la cola marca Devuelto/Cancelado', queueFlags(svc({ status: 'Devuelto' })).anulada);
ok('OJO: Entregado NO es "anulada" (una entregada todavía admite devolución)',
  !queueFlags(svc({ status: 'Entregado' })).anulada);
ok('en taller: ni anulada ni entregada', !queueFlags(svc({ status: 'Por entregar' })).anulada);
eq('identificador de la cola (contrato con el backend)', ACTIVE_QUEUE, '__activos__');

// ── reglas de la pantalla exacta ──────────────────────────────────────────────────────
const prod = (over: Partial<Product>): Product => ({
  id: 1, name: 'Pantalla Redmi Note 11', category_id: 1, brand: 'Xiaomi', model: 'Redmi Note 11',
  variant: '', compatibility: '["Redmi Note 11"]', price_cost: 5, price_sale: 12, stock: 3,
  min_stock: 0, created_at: '', updated_at: '', price_usd: 10, search_text: '',
  ...over,
} as Product);
const cand = (id: number, stock: number, category = 1, brandMatch = true, quality: ScreenCandidate['match_quality'] = 'exacta', brandKnown = true): ScreenCandidate => ({
  product: prod({ id, stock, category_id: category }), in_stock: stock > 0, match_quality: quality,
  brand_match: brandMatch, brand_known: brandKnown,
} as ScreenCandidate);

ok('sin trabajo de pantalla → no exige nada', screenOk(['Software / Formateo'], null, [cand(1, 5)]));
ok('modelo sin pantallas en catálogo → no bloquea', screenOk(['Cambio pantalla'], null, []));
ok('trabajo de pantalla con opciones y SIN elegir → bloquea', !screenOk(['Cambio pantalla'], null, [cand(1, 5)]));
ok('pantalla elegida con stock → ok', screenOk(['Cambio pantalla'], 1, [cand(1, 5)]));
ok('pantalla AGOTADA al entregar → exige confirmación', !screenOk(['Cambio pantalla'], 2, [cand(1, 5), cand(2, 0)], false, 'Entregado'));
ok('pantalla AGOTADA confirmada → ok', screenOk(['Cambio pantalla'], 2, [cand(1, 5), cand(2, 0)], true, 'Entregado'));
ok('al RECIBIR (no entregado) la agotada no exige confirmar', screenOk(['Cambio pantalla'], 2, [cand(2, 0)], false, 'Recibido'));
eq('onlyScreens deja solo categoría 1', onlyScreens([cand(1, 5), cand(2, 5, 2)]).length, 1);

// ── GATE DE MARCA de la pantalla que se elige sola (B2 pre-producción) ────────────────
// Caso real: «Honor 10 Lite» solo tenía con stock la pantalla de un «Infinix Hot 10 Lite»
// y el formulario la elegía sola → el descuento caía en el repuesto equivocado.
eq('una sola con stock y de la marca → se elige sola', autoScreen([cand(1, 3)])?.product.id, 1);
eq('una sola con stock pero de OTRA marca → NO se elige sola',
  autoScreen([cand(1, 3, 1, false)]), null);
eq('la de la marca sin stock + la de otra marca con stock → NO se elige sola',
  autoScreen([cand(1, 0), cand(2, 5, 1, false)]), null);
eq('dos de la marca con stock → decide el operario', autoScreen([cand(1, 3), cand(2, 4)]), null);
eq('la de la marca con stock aunque haya otra de la marca agotada', autoScreen([cand(1, 3), cand(2, 0)])?.product.id, 1);
eq('coincidencia PARCIAL de la misma marca → no se elige sola',
  autoScreen([cand(1, 3, 1, true, 'parcial')]), null);
ok('cand con marca → no es de otra marca', !isCrossBrand(cand(1, 3)));
ok('cand de otra marca → isCrossBrand', isCrossBrand(cand(1, 3, 1, false)));
ok('sin candidata elegida → isCrossBrand false', !isCrossBrand(null));
// MARCA DESCONOCIDA (modelo libre, o texto ambiguo como «A11» = Umidigi A11 y Samsung Galaxy
// A11): NO se avisa «otra marca» —avisar de más entrena a ignorar el aviso— y tampoco se elige
// sola. Antes esta combinación pintaba el Alert rojo sobre una pantalla correcta.
const sinMarca = cand(1, 5, 1, false, 'exacta', false);
ok('marca desconocida → no se avisa «otra marca»', !warnsCrossBrand(sinMarca));
ok('marca desconocida → isCrossBrand false', !isCrossBrand(sinMarca));
eq('marca desconocida → no se auto-elige', autoScreen([sinMarca]), null);
ok('marca conocida y distinta → sí avisa', warnsCrossBrand(cand(1, 5, 1, false, 'exacta', true)));
ok('sin marca conocida la agotada confirmada sigue igual',
  screenOk(['Cambio pantalla'], 2, [cand(2, 0)], true, 'Entregado'));

console.log(`\nqueue + screen-rules: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallos`);
if (failures > 0) process.exit(1);
