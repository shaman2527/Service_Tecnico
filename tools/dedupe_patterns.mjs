// Deduplica tools/progress/patterns.md.
//
// EL PROBLEMA (medido 2026-09-18): el consolidador de aprendizajes del harness DUPLICA el archivo en
// cada corrida (crecimiento exponencial). El archivo llegó a 310 MB / 563.404 líneas con solo 20
// aprendizajes ÚNICOS: uno repetido 524.288 veces (2^19), otro 32.768, otro 4.096… Todos los backticks
// de escape también se acumularon (`` `- `- `- `… ``). Además 14 de esos 20 aprendizajes NO estaban en
// la versión que git tenía commiteada, así que revertir a mano habría borrado conocimiento real.
//
// QUÉ HACE: lee el archivo una sola vez (streaming, sin cargarlo entero), se queda con la PRIMERA
// aparición de cada aprendizaje, limpia los backticks/guiones acumulados, reconstruye el documento
// (cabecera + secciones por severidad, un aprendizaje cada uno con su evidencia) y lo escribe.
//
// Uso: node tools/dedupe_patterns.mjs [--dbg <archivo>] [--out <archivo>] [--dry]

import { createReadStream, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const argDe = (n, def) => (args.includes(n) ? args[args.indexOf(n) + 1] : def);
const ARCHIVO = argDe('--dbg', 'tools/progress/patterns.md');
const OUT = argDe('--out', ARCHIVO);
const DRY = args.includes('--dry');

if (!existsSync(ARCHIVO)) { console.error(`no existe ${ARCHIVO}`); process.exit(2); }

/** Saca los backticks de escape y los guiones acumulados de una línea. */
function limpiar(linea) {
  let s = linea.replace(/`+/g, '');
  // ``- `- `- `- texto`` → el texto real empieza después del último «- » repetido
  const indent = (linea.match(/^\s*/) || [''])[0];
  s = s.trim();
  if (s.startsWith('-')) {
    s = s.replace(/^(?:-\s*)+/, '');   // colapsa «- - - - » en nada
  }
  return indent + s;
}

const bullets = new Map();   // clave → { nivel, texto, evidencia: [] }
let lineas = 0;
let ultimoNivel = null;
let claveActual = null;      // a qué aprendizaje pertenecen las líneas de evidencia que vienen

const rl = createInterface({ input: createReadStream(ARCHIVO, { encoding: 'utf-8' }), crlfDelay: Infinity });
for await (const linea of rl) {
  lineas += 1;
  const t = linea.trim();
  if (!t) continue;
  if (t.startsWith('#')) continue;                       // cabecera: se reescribe abajo
  if (t.startsWith('>')) continue;
  if (/^---+$/.test(t)) continue;
  if (/^###\s+/.test(t)) { ultimoNivel = t.replace(/^###\s+/, ''); continue; }

  const esBullet = /^-\s*`?\[/.test(t);
  if (esBullet) {
    const m = t.match(/^-\s*`?\[([A-Z]+)\]`?\s*(.*)$/);
    if (!m) continue;
    const [, nivel, textoCrudo] = m;
    const texto = limpiar(textoCrudo);
    const clave = `${nivel}|${texto}`;
    if (!bullets.has(clave)) bullets.set(clave, { nivel, texto, evidencia: new Set(), seccion: ultimoNivel });
    claveActual = clave;
  } else if (claveActual) {
    // Evidencia del aprendizaje en curso: se guarda UNA vez, limpia.
    const limpia = limpiar(linea).trim();
    if (limpia !== '' && limpia !== '-') bullets.get(claveActual).evidencia.add(limpia);
  }
}

const ORDEN = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const aprendizajes = [...bullets.values()].sort((a, b) =>
  (ORDEN[a.nivel] ?? 9) - (ORDEN[b.nivel] ?? 9) || a.texto.localeCompare(b.texto));

const fecha = new Date().toISOString();
const partes = [
  '# Codebase Patterns',
  '',
  '> Auto-consolidated learnings from loop iterations.',
  `> Last updated: ${fecha}`,
  '>',
  '> NOTA (2026-09-18): este archivo había llegado a 310 MB porque el consolidador DUPLICABA el',
  '> contenido en cada corrida (20 aprendizajes únicos, uno repetido 524.288 veces). Se deduplicó con',
  '> `node tools/dedupe_patterns.mjs` conservando TODOS los aprendizajes únicos. Si vuelve a crecer,',
  '> correr ese script otra vez y arreglar la consolidación (no borrar aprendizajes a mano).',
  '',
  '---',
  '',
];

for (const nivel of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
  const grupo = aprendizajes.filter(a => a.nivel === nivel);
  if (!grupo.length) continue;
  partes.push(`### ${nivel === 'CRITICAL' ? 'Errores Recurrentes (CRITICAL)' : nivel}`);
  partes.push('');
  for (const a of grupo) {
    partes.push(`- \`[${a.nivel}]\` ${a.texto}`);
    const ev = [...a.evidencia].slice(0, 8);
    for (const e of ev) partes.push(`  - ${e}`);
    partes.push('');
  }
}

const nuevo = partes.join('\n');
if (DRY) {
  console.log(`(dry run) quedaría en ${nuevo.length} bytes · ${nuevo.split('\n').length} líneas · ${aprendizajes.length} aprendizajes`);
  console.log(nuevo.slice(0, 1200));
} else {
  if (OUT === ARCHIVO) renameSync(ARCHIVO, `${ARCHIVO}.grande.bak`);   // respaldo por si algo salió mal
  writeFileSync(OUT, nuevo);
  console.log(`leídas ${lineas.toLocaleString('es')} líneas → ${aprendizajes.length} aprendizajes únicos → ${OUT} (${(nuevo.length / 1024).toFixed(1)} KB)`);
  const porNivel = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    .map(n => `${n}: ${aprendizajes.filter(a => a.nivel === n).length}`).join(' · ');
  console.log(`   ${porNivel}`);
  if (OUT === ARCHIVO) console.log(`   (el archivo viejo quedó en ${ARCHIVO}.grande.bak)`);
}
