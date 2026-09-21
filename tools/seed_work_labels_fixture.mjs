#!/usr/bin/env node
// ============================================================================
// FIXTURE DE TRABAJOS (F56/F57/F58) — base de DESARROLLO con desorden deliberado.
//
// POR QUÉ EXISTE: el dueño mandó una captura de Servicios (2026-09-21) pidiendo que la pantalla no
// se vea «abrumadora con ese poco de types». La base real del cliente NO está en este checkout
// (registro.db tiene 5 órdenes y la instalada 0), así que hace falta una copia de desarrollo para
// medir el antes/después y verificar la UI sin tocar ninguna base real.
//
// HONESTIDAD SOBRE LOS NÚMEROS (importante): el reparto por trabajo de este archivo es
// REPRESENTATIVO, no una transcripción de la captura — la captura no se pudo leer con certeza (el
// modelo de esta sesión no acepta imágenes y OCR no está disponible en el entorno). Lo que SÍ es
// seguro, porque sale del código y no de la foto: la pantalla dibuja un chip por CADA etiqueta
// distinta que exista en la lista (canónicas + las escritas a mano en «Otro»), así que con una base
// con muchos sinónimos la barra se vuelve un muro. El número que MANDA es el que mida
// `tools/audit_work_labels.mjs` sobre la base real del cliente.
//
//   node tools/seed_work_labels_fixture.mjs [--out backup/f56_fixture.db] [--force]
//
// Qué arma (todo determinista: el mismo script da siempre los mismos números):
//   · 603 órdenes con los trabajos canónicos y una cola larga de etiquetas libres (sinónimos,
//     faltas de ortografía y cosas que no son trabajos) — el caso que hay que poder mostrar bien;
//   · la tajada de HOY, explícita y verificable: 18 recibidos hoy y 11 entregados hoy,
//     con su desglose por trabajo (ver TODAY_RECIBIDOS / TODAY_ENTREGADOS);
//   · un día ABIERTO de hoy (para poder probar también el alta de servicios);
//   · clientes/modelos/fechas/montos plausibles, con estados repartidos entre taller,
//     entregados y anulados (los tres buckets de `workBucket`).
//
// NO toca registro.db (solo lo usa como plantilla de catálogo/estados/config) y NO abre la
// app: es solo el sembrado. Uso típico después:
//
//   $env:REGISTRO_DB="C:\...\registro\backup\f56_fixture.db"
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
//   npx tauri dev
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const SRC = path.resolve(ROOT, arg('--src', 'registro.db'));
const OUT = path.resolve(ROOT, arg('--out', path.join('backup', 'f56_fixture.db')));
const FORCE = argv.includes('--force');
const TASA = 748.79;

// ── HOY (fecha local del local, nunca UTC) ────────────────────────────────────────────────────
const now = new Date();
const hoy = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const day = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (date, hh, mm) => `${date} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

// ── La tajada de HOY (explícita: la verificación en vivo asume estos números) ─────────────────
const TODAY_RECIBIDOS = [
  'Cambio pantalla', 'Cambio pantalla', 'Cambio pantalla', 'Cambio pantalla',
  'Pin de Carga', 'Pin de Carga',
  'Cambio batería', 'Cambio batería',
  'Software / Formateo', 'Software / Formateo',
  'Revisión', 'Revisión',
  'Limpieza / Mantenimiento',
  'Cambio flex',
  'Placa de carga',
  'garantía',
  'VENTA',
  'bateria',
]; // 18 equipos recibidos hoy

const TODAY_ENTREGADOS = [
  'Cambio pantalla', 'Cambio pantalla', 'Cambio pantalla',
  'Pin de Carga', 'Pin de Carga',
  'Revisión', 'Revisión',
  'Cambio batería',
  'Software / Formateo',
  'Cambio conector / puerto',
  'flex power',
]; // 11 equipos entregados hoy

// ── REPARTO POR TRABAJO = EL REAL DEL CLIENTE (asignaciones, no equipos) ──────────────────────
// Esta lista la pasó el DUEÑO el 2026-09-21 (en texto): es EXACTAMENTE lo que muestra la pantalla de
// su local — 603 equipos, 49 trabajos + «Todos», con la cola larga de etiquetas escritas a mano.
// Con esto el fixture calca producción y el «antes/después» es comparable número por número.
// Los canónicos van primero (mismo orden que SERVICE_TYPES) y después las libres, como las dibuja la UI.
const REPARTO_DE_DESARROLLO = [
  // canónicos
  ['Cambio pantalla', 323], ['Cambio batería', 27], ['Cambio flex', 5], ['Pin de Carga', 75],
  ['Placa de carga', 5], ['Pegado de pantalla', 5], ['Reemplazo de botones', 11],
  ['Preparación de carcasa', 2], ['Cambio de bandeja SIM', 2], ['Reparación (placa)', 1],
  ['Limpieza / Mantenimiento', 18], ['Software / Formateo', 21], ['Cambio cámara', 1],
  ['Cambio parlante / micrófono', 2], ['Revisión', 66], ['Otro', 65],
  // libres (texto de «Otro»): sinónimos, faltas y cosas que no son trabajos
  ['Cambio conector / puerto', 18], ['garantía', 8], ['flex power', 5], ['VENTA', 3],
  ['baño quimico', 2], ['bateria', 2], ['BANDEJA SIM', 1], ['Boton encendido', 1],
  ['boton power', 1], ['CABLE', 1], ['CARCASA', 1], ['correo', 1], ['cristal de camara', 1],
  ['devolucion por faltante', 1], ['falla de pantalla arreglada', 1], ['flex main', 1], ['fps', 1],
  ['MANTENIMIENTO', 1], ['pegado de pantalla, botón', 1], ['pegado de tapa tracera', 1],
  ['pila mas bandeja', 1], ['placa', 1], ['recuperacion de correos', 1], ['RELACIÓN A REINICIO', 1],
  ['REPARACIÓN DE BATTERIA', 1], ['reparación de marco', 1], ['RETIRO DE CHIP', 1],
  ['revision, cornetas', 1], ['se mojó', 1], ['sensor', 1], ['sustitución de targeta logica', 1],
  ['tubo de bocina', 1], ['venta de pantalla', 1],
];

const TOTAL_EQUIPOS = 603; // «Todos 603»: el total real de la pantalla del cliente

const CLIENTES = [
  'Ana Pérez', 'Luis Rodríguez', 'María González', 'José Hernández', 'Carmen Díaz',
  'Pedro Ramírez', 'Rosa Martínez', 'Juan Silva', 'Yulimar Torres', 'Carlos Mendoza',
  'Gabriela Rojas', 'Rafael Suárez', 'Daniela Flores', 'Miguel Ángel Vera', 'Yorleny Campos',
  'Eduardo Blanco', 'Norkys Peña', 'Alexander Gil', 'Beatriz Lozada', 'Wilmer Ochoa',
];
const MODELOS = [
  'Samsung A15 A155', 'Samsung A32 A325', 'Xiaomi Redmi 9A', 'Xiaomi Redmi Note 11',
  'Honor X7b', 'Honor X8a', 'Tecno SPARK 10 PRO', 'Infinix Hot 40i', 'iPhone 11',
  'iPhone 13 Pro Max', 'ZTE Blade A53', 'Alcatel 1B', 'Realme C53', 'Vivo Y17s',
  'Motorola Moto G23', 'LG K61', 'Lifephone L60',
];
const TECNICOS = [
  { id: null, name: 'Roberth' }, { id: null, name: 'Jhonny' }, { id: null, name: 'Anderson' },
];

// PRNG determinista (mulberry32): mismo script → mismos datos.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260921);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

// ── Reparto de asignaciones en órdenes ────────────────────────────────────────────────────────
// Se arma la bolsa de asignaciones (los totales de la captura), se le restan las de HOY y lo que
// sobra se reparte: 1 trabajo por orden y, con las que queden, un 2º trabajo en las primeras
// órdenes (un equipo con varios trabajos: el caso que el reporte tiene que contar en cada chip).
function buildBag() {
  const bag = new Map();
  for (const [label, n] of REPARTO_DE_DESARROLLO) bag.set(label, (bag.get(label) ?? 0) + n);
  for (const label of [...TODAY_RECIBIDOS, ...TODAY_ENTREGADOS]) {
    const cur = bag.get(label);
    if (cur === undefined) throw new Error(`Etiqueta de HOY fuera del plan: ${label}`);
    if (cur < 1) throw new Error(`Sin asignaciones para la etiqueta de HOY: ${label}`);
    bag.set(label, cur - 1);
  }
  return bag;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`No existe la plantilla ${SRC}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (fs.existsSync(OUT)) {
    if (!FORCE) {
      console.error(`Ya existe ${OUT} — usá --force para rehacerlo (es una COPIA de desarrollo).`);
      process.exit(1);
    }
    fs.rmSync(OUT);
  }

  // 1) Copia consistente de la plantilla (incluye el WAL) y limpieza de órdenes.
  const src = new DatabaseSync(SRC, { readOnly: true });
  src.exec(`VACUUM INTO '${OUT.replace(/'/g, "''")}'`);
  src.close();

  const db = new DatabaseSync(OUT);
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DELETE FROM service_payments');
  db.exec('DELETE FROM services');

  // Día ABIERTO de hoy (permite probar el alta real de servicios contra el fixture).
  db.prepare('DELETE FROM daily_closings WHERE close_date = ?').run(hoy);
  db.prepare(
    'INSERT INTO daily_closings (close_date, is_closed, tasa_bcv, tasa_eur, opened_at, initial_cash_usd, notes) VALUES (?,0,?,?,?,?,?)',
  ).run(hoy, TASA, 0, at(hoy, 8, 5), 0, 'Fixture F56/F57/F58 (desarrollo)');

  const insert = db.prepare(
    `INSERT INTO services (order_num, date_in, client, phone, model, fault, amount, payment_method,
       date_out, status, observations, service_type, service_types, paid_amount, currency, color,
       printed, discount_amount, photo_in_at, photo_out_at, pay_intent, technician)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const bag = buildBag();
  let seq = 1;
  const nextNum = () => `DEV-${String(seq++).padStart(4, '0')}`;

  const mkRow = ({ label, second, dateIn, dateOut, status, hh, mm }) => {
    const tipo = label;
    const tipos = second ? [label, second] : [label];
    const model = pick(MODELOS);
    const amount = between(3, 60) * 5; // 15..300 en pasos de 5
    const pagado = status === 'Entregado' ? amount : (rand() < 0.25 ? Math.round(amount / 2) : 0);
    const color = pick(['', 'negro', 'azul', 'rojo', 'verde', 'morado', 'blanco']);
    const tech = pick(TECNICOS);
    insert.run(
      nextNum(),
      at(dateIn, hh, mm),
      pick(CLIENTES),
      `04${between(10, 99)}-${between(1000000, 9999999)}`,
      model,
      pick(['Pantalla rota', 'No carga', 'Se mojó', 'No enciende', 'Batería dura poco', 'Se reinicia', 'No da señal', 'Falla el táctil']),
      amount,
      pick(['Divisas (USD Cash)', 'Pago Móvil', 'Transferencia Zelle', 'Punto de Venta ($)']),
      dateOut ? at(dateOut, between(9, 18), between(0, 59)) : '',
      status,
      '',
      tipo,
      JSON.stringify(tipos),
      pagado,
      'USD',
      color,
      status === 'Entregado' ? 1 : 0,
      0,
      status === 'Entregado' ? at(dateOut ?? dateIn, 9, 0) : at(dateIn, 9, 0),
      status === 'Entregado' && dateOut ? at(dateOut, 10, 0) : '',
      status === 'Entregado' ? pick(['', 'ahora', 'al_retirar']) : '',
      tech.name,
    );
  };

  // 2) HOY: 18 recibidos (en taller) + 11 entregados (fecha de ENTREGA de hoy).
  TODAY_RECIBIDOS.forEach((label, i) => {
    mkRow({ label, dateIn: hoy, dateOut: '', status: i % 3 === 0 ? 'Recibido' : 'En reparación', hh: 8 + (i % 9), mm: between(0, 59) });
  });
  TODAY_ENTREGADOS.forEach((label, i) => {
    // Recibidos días atrás y entregados HOY: es el caso que la captura del dueño destaca
    // («recibido la semana pasada y entregado hoy» no aparecía con el filtro por recibo).
    mkRow({ label, dateIn: day(-between(3, 25)), dateOut: hoy, status: 'Entregado', hh: 9, mm: between(0, 59) });
  });

  // 3) El resto del historial (hasta llegar a 603 equipos) con las asignaciones que quedan.
  const slots = [];
  for (const [label, n] of bag) for (let i = 0; i < n; i++) slots.push(label);
  // Mezcla determinista para que las etiquetas queden repartidas en el tiempo.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const restantes = TOTAL_EQUIPOS - TODAY_RECIBIDOS.length - TODAY_ENTREGADOS.length; // 574
  for (let i = 0; i < restantes; i++) {
    const label = slots[i];
    // El 2º trabajo de las primeras órdenes sale de la cola que sobra (equipos con 2 trabajos).
    const second = i < slots.length - restantes ? slots[restantes + i] : null;
    // Al menos 5 días atrás: así una fila histórica NUNCA cae en la tajada de HOY
    // (los «entregados hoy» tienen que ser exactamente los 11 del plan, no más).
    const dias = between(5, 260);
    const dateIn = day(-dias);
    const r = rand();
    let status = 'Entregado';
    let dateOut = day(-Math.max(1, dias - between(1, 4)));
    if (r < 0.18) { status = pick(['Recibido', 'En reparación', 'Esperando repuesto', 'Por entregar']); dateOut = ''; }
    else if (r < 0.24) { status = pick(['Devuelto', 'Cancelado / Devuelto']); dateOut = day(-Math.max(0, dias - between(1, 3))); }
    mkRow({ label, second: second && second !== label ? second : null, dateIn, dateOut, status, hh: between(8, 18), mm: between(0, 59) });
  }

  // 4) Reporte del sembrado: tiene que calcar la captura del cliente.
  const total = db.prepare('SELECT COUNT(*) c FROM services').get().c;
  // Plegado IDÉNTICO al de la pantalla (`normPhoneModel`): minúsculas, sin acentos y lo
  // no-alfanumérico reemplazado por UN ESPACIO (no borrado) — así «Cambio pantalla» → `cambio pantalla`.
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const crudas = new Set();
  const plegadas = new Map(); // clave plegada → equipos (lo que la UI dibuja hoy como un chip)
  let asignaciones = 0;
  for (const row of db.prepare('SELECT service_types FROM services').all()) {
    for (const t of JSON.parse(row.service_types)) {
      crudas.add(t);
      asignaciones++;
      plegadas.set(fold(t), (plegadas.get(fold(t)) ?? 0) + 1);
    }
  }
  const recHoy = db.prepare("SELECT COUNT(*) c FROM services WHERE date(date_in) = ?").get(hoy).c;
  const entHoy = db.prepare("SELECT COUNT(*) c FROM services WHERE date(date_out) = ?").get(hoy).c;
  const abierto = db.prepare('SELECT COUNT(*) c FROM daily_closings WHERE is_closed = 0').get().c;
  db.close();

  const unaSola = [...plegadas.values()].filter(n => n === 1).length;
  console.log(`Fixture: ${OUT}`);
  console.log(`  equipos (órdenes):        ${total}   (base grande de desarrollo)`);
  console.log(`  etiquetas CRUDAS:         ${crudas.size}   (lo guardado, con sus sinónimos)`);
  console.log(`  etiquetas PLEGADAS:       ${plegadas.size}   (= chips que dibuja la UI de hoy: un chip por etiqueta distinta)`);
  console.log(`  …de esas, de 1 equipo:    ${unaSola}   (el ruido que el cliente ve como «poco profesional»)`);
  console.log(`  asignaciones de trabajo:  ${asignaciones}`);
  console.log(`  recibidos HOY (${hoy}):    ${recHoy}`);
  console.log(`  entregados HOY (${hoy}):   ${entHoy}`);
  console.log(`  turnos abiertos:          ${abierto}`);
  if (total !== TOTAL_EQUIPOS) console.warn(`  AVISO: se esperaban ${TOTAL_EQUIPOS} equipos.`);
  if (recHoy !== TODAY_RECIBIDOS.length) console.warn(`  AVISO: se esperaban ${TODAY_RECIBIDOS.length} recibidos hoy.`);
  if (entHoy !== TODAY_ENTREGADOS.length) console.warn(`  AVISO: se esperaban ${TODAY_ENTREGADOS.length} entregados hoy.`);
}

main();
