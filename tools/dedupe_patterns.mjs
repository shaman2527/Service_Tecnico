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
import { dirname, resolve, basename } from 'node:path';

const args = process.argv.slice(2);
const argDe = (n, def) => (args.includes(n) ? args[args.indexOf(n) + 1] : def);
const ARCHIVO = argDe('--dbg', 'tools/progress/patterns.md');
const OUT = argDe('--out', ARCHIVO);
const DRY = args.includes('--dry');

if (!existsSync(ARCHIVO)) { console.error(`no existe ${ARCHIVO}`); process.exit(2); }
const MAX_EVIDENCIA = 8;   // evidencia por aprendizaje (se avisa si se recorta, no se pierde en silencio)

/** Saca SOLO el escapado acumulado del consolidador, no los backticks del texto original.
 *  Cada corrida envolvía la línea y le anteponía «- `»: `` `- `- `- texto`` `` → `texto`.
 *  Un `code` que ya estaba en el texto se conserva (antes se borraban TODOS los backticks). */
function limpiar(linea) {
  const indent = (linea.match(/^\s*/) || [''])[0];
  let s = linea.trim();
  s = s.replace(/^(?:-\s*`)*-\s*/, '');   // prefijos «- `» repetidos
  s = s.replace(/`+$/, '');                // backticks de cierre acumulados
  s = s.replace(/^`+/, '');
  return indent + s.trim();
}

const bullets = new Map();   // clave → { nivel, texto, evidencia: [] }
let lineas = 0;
let ultimoNivel = null;
let claveActual = null;      // a qué aprendizaje pertenecen las líneas de evidencia que vienen
let evidenciasRecortadas = 0;

const rl = createInterface({ input: createReadStream(ARCHIVO, { encoding: 'utf-8' }), crlfDelay: Infinity });
for await (const linea of rl) {
  lineas += 1;
  const t = linea.trim();
  // Una línea en blanco corta la evidencia: sin esto, la prosa que viene después (o de otra sección)
  // se pegaba como evidencia del último aprendizaje.
  if (!t) { claveActual = null; continue; }
  if (t.startsWith('#')) continue;                       // cabecera: se reescribe abajo
  if (t.startsWith('>')) continue;
  if (/^---+$/.test(t)) { claveActual = null; continue; }
  if (/^###\s+/.test(t)) { ultimoNivel = t.replace(/^###\s+/, ''); claveActual = null; continue; }

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
    if (limpia !== '' && limpia !== '-') {
      const b = bullets.get(claveActual);
      if (b.evidencia.size < MAX_EVIDENCIA) b.evidencia.add(limpia);
      else evidenciasRecortadas += 1;
    }
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

// Se escriben TODOS los niveles presentes, incluidos los que no sean los 4 conocidos: antes un
// `[WARNING]` o `[INFO]` se descartaba en silencio (y el resumen ni cerraba).
const ORDEN_CONOCIDO = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const nivelesPresentes = [...new Set(aprendizajes.map(a => a.nivel))];
const niveles = [
  ...ORDEN_CONOCIDO.filter(n => nivelesPresentes.includes(n)),
  ...nivelesPresentes.filter(n => !ORDEN_CONOCIDO.includes(n)).sort(),
];
for (const nivel of niveles) {
  const grupo = aprendizajes.filter(a => a.nivel === nivel);
  partes.push(`### ${nivel === 'CRITICAL' ? 'Errores Recurrentes (CRITICAL)' : nivel}`);
  partes.push('');
  for (const a of grupo) {
    partes.push(`- \`[${a.nivel}]\` ${a.texto}`);
    for (const e of a.evidencia) partes.push(`  - ${e}`);
    partes.push('');
  }
}

const escritos = niveles.reduce((n, nivel) => n + aprendizajes.filter(a => a.nivel === nivel).length, 0);
if (escritos !== aprendizajes.length) {
  console.error(`ATENCIÓN: ${aprendizajes.length - escritos} aprendizaje(s) no se escribieron — NO se sobrescribe el archivo`);
  process.exit(3);
}

const nuevo = partes.join('\n');
if (DRY) {
  console.log(`(dry run) quedaría en ${nuevo.length} bytes · ${nuevo.split('\n').length} líneas · ${aprendizajes.length} aprendizajes`);
  console.log(nuevo.slice(0, 1200));
} else {
  // El respaldo va a `backup/` (gitignored): si quedaba en tools/progress/ con 300+ MB, el propio
  // chequeo de higiene del gate de release bloqueaba la próxima publicación.
  const respaldo = resolve(dirname(ARCHIVO), '..', 'backup', `${basename(ARCHIVO)}.grande.bak`);
  if (OUT === ARCHIVO) renameSync(ARCHIVO, respaldo);
  writeFileSync(OUT, nuevo);
  console.log(`leídas ${lineas.toLocaleString('es')} líneas → ${aprendizajes.length} aprendizajes únicos → ${OUT} (${(nuevo.length / 1024).toFixed(1)} KB)`);
  console.log('   ' + niveles.map(n => `${n}: ${aprendizajes.filter(a => a.nivel === n).length}`).join(' · '));
  if (evidenciasRecortadas) console.log(`   (evidencia recortada a ${MAX_EVIDENCIA} líneas por aprendizaje: ${evidenciasRecortadas} línea(s) fuera)`);
  if (OUT === ARCHIVO) console.log(`   (el archivo viejo quedó en ${respaldo})`);
}
