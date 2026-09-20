// PRUEBA POR COMPORTAMIENTO de tools/verify_migracion_datos.mjs.
//
// Uso: node tools/verify_migracion_negativa.mjs [--db <base>]   (por defecto usa una copia de agosto)
//
// La lección del falso verde (revisión adversarial 2026-09-18) es que una prueba que «siempre pasa»
// no prueba nada. Acá se hace lo que el proyecto ya hizo con el gate de seguridad: INYECTAR EL FALLO
// y comprobar que la verificación lo detecta. Se corre una copia del script con una «migración» que
// rompe datos a propósito (borra una venta, toca un stock, descuadra el arqueo de un cierre cerrado
// y mueve el saldo de una orden) y se exige que la prueba FALLE — por cada daño, con su mensaje.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL = join(ROOT, 'tools', 'verify_migracion_datos.mjs');
const TEMP = join(ROOT, 'backup', '_prueba_mutacion.mjs');
const DB = process.argv[2] || 'backup/registro_backup_20260804_000039.db';

const fuente = readFileSync(ORIGINAL, 'utf-8');
const ancla = "// ── 4) Fotografía después y comparación";
if (!fuente.includes(ancla)) { console.error('no encuentro el ancla en el script: cambió de estructura'); process.exit(2); }

// La «migración dañina»: exactamente el tipo de cosas que la prueba tiene que cazar.
const mutacion = `
// ---- MUTACIÓN DE PRUEBA (solo en esta copia) ----
{
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(COPIA);
  const ventas = d.prepare('SELECT id FROM sales ORDER BY id LIMIT 1').get();
  if (ventas) d.prepare('DELETE FROM sales WHERE id = ?').run(ventas.id);
  d.prepare('UPDATE products SET stock = stock + 7 WHERE id = (SELECT MIN(id) FROM products)').run();
  d.prepare('UPDATE services SET paid_amount = COALESCE(paid_amount,0) + 500 WHERE id = (SELECT MIN(id) FROM services)').run();
  const cierre = d.prepare('SELECT id, total_usd FROM daily_closings WHERE is_closed=1 ORDER BY id LIMIT 1').get();
  if (cierre) {
    // El ARQUEO contado y la DIFERENCIA son columnas que NO pueden cambiar: la migración recalcula el
    // total derivado (total_usd) pero el cajón que contó el cajero no lo toca nadie.
    d.prepare('UPDATE daily_closings SET actual_cash_usd = actual_cash_usd + 99, difference = difference + 99 WHERE id = ?').run(cierre.id);
  }
  d.prepare("INSERT INTO clients (name) VALUES ('Cliente Inventado')").run();
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  d.close();
  console.log('MUTACIÓN aplicada (borré una venta, sumé stock, moví un saldo, descuadré un arqueo y agregué un cliente)');
}
`;

writeFileSync(TEMP, fuente.replace(ancla, mutacion + '\n' + ancla));

let salida = '';
let codigo = 0;
try {
  salida = execFileSync(process.execPath, [TEMP, '--db', DB, '--debug'], {
    cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20 * 60 * 1000,
  });
} catch (e) {
  salida = `${e.stdout || ''}\n${e.stderr || ''}`;
  codigo = e.status ?? 1;
}
for (const f of ['_prueba_mutacion.mjs', '_prueba_mutacion.log', '_prueba_mutacion.mark']) {
  const p = join(ROOT, 'backup', f);
  if (existsSync(p)) unlinkSync(p);
}

const lineas = salida.split(/\r?\n/).filter(l => l.startsWith('FAIL') || /comprobaciones/.test(l));
console.log(lineas.join('\n'));

const ESPERADOS = [
  ['borré una venta', /sales: ninguna fila se perdió/],
  ['sumé stock', /products: el STOCK de cada ficha/],
  ['moví el saldo de una orden', /services\.paid_amount .*no mueve el SALDO/],
  ['descuadré el arqueo de un cierre cerrado', /daily_closings: \d+ fila\(s\) con sus columnas intactas/],
  ['agregué un cliente', /clients: no aparecieron filas nuevas/],
];

// NOTA (honesta): la regla «un total de un cierre cerrado no cambia de SIGNO» no se puede disparar
// con una mutación de este tipo porque esos totales son DERIVADOS y la propia migración los recalcula
// (la mutación queda sobrescrita). Es un guardián por si el recálculo mismo invirtiera un signo; el
// daño equivalente que SÍ es reproducible —y que por eso se prueba arriba— es tocar el arqueo contado
// y la diferencia, que son datos del cajero y no se recalculan nunca.

let fallos = 0;
console.log('');
for (const [que, re] of ESPERADOS) {
  const detectado = lineas.some(l => l.startsWith('FAIL') && re.test(l));
  console.log(`${detectado ? 'PASS' : 'FALLA'}  la prueba detecta que ${que}`);
  if (!detectado) fallos += 1;
}
console.log(`${codigo !== 0 ? 'PASS' : 'FALLA'}  la prueba sale con error (exit ${codigo}) cuando la migración daña datos`);
if (codigo === 0) fallos += 1;

console.log(fallos === 0
  ? '\nLa prueba por comportamiento está OK: los 5 daños se detectan y el veredicto es FAIL.'
  : `\n${fallos} daño(s) NO detectado(s): la prueba todavía puede dar un falso verde.`);
process.exit(fallos === 0 ? 0 : 1);
