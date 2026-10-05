// Estado de la base del taller (solo LEE). Útil para responder «¿qué quedó cargado?».
//
// OJO CON LA COMPARACIÓN (lección 2026-10-05): la compatibilidad guarda la etiqueta CON marca
// («Infinix Hot 30i») y el operario escribe el modelo pelado («Hot 30i»). Comparar por igualdad
// normalizada daba **0 pantallas** con la red cargada de verdad: hay que comparar sin la marca.
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('C:\\Users\\ROBER\\AppData\\Local\\Registro Servicio Tecnico\\registro.db', { readOnly: true });
const q = (s) => db.prepare(s).all();
console.log('fichas / stock:', JSON.stringify(q('SELECT count(*) fichas, sum(stock) stock FROM products')[0]));
console.log('movimientos de carga masiva:', JSON.stringify(q("SELECT count(*) c FROM inventory_movements WHERE reason LIKE 'Carga masiva%'")[0]));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const MARCAS = ['infinix', 'tecno', 'samsung', 'xiaomi', 'redmi', 'motorola', 'huawei', 'honor', 'apple', 'oppo', 'realme', 'vivo', 'zte', 'alcatel', 'tcl', 'blu', 'itel', 'umidigi', 'google', 'nokia', 'lifephone', 'krip', 'yezz', 'blackview', 'hyundai', 'lg'];
const pelado = (s) => { const n = norm(s); for (const b of MARCAS) if (n.startsWith(b)) return n.slice(b.length); return n; };
const pantallas = (modelo) => q('SELECT id, name, code, compatibility FROM products WHERE category_id = 1')
  .filter(p => { let l = []; try { l = JSON.parse(p.compatibility ?? '[]'); } catch { l = []; } return l.some(x => pelado(x) === pelado(modelo)); })
  .map(p => `${p.code} ${p.name}`);
for (const modelo of ['Hot 30i', 'Hot 40i', 'Spark Go 2023', 'Pop 7', 'Spark 20 Pro', 'Spark Go 2022']) {
  const lista = pantallas(modelo);
  console.log(`\npantallas de «${modelo}»: ${lista.length}`);
  for (const n of lista) console.log('   · ' + n);
}
const dup = q("SELECT UPPER(TRIM(code)) c, count(*) n FROM products WHERE code IS NOT NULL AND trim(code) <> '' GROUP BY c HAVING n > 1");
const dupNom = q("SELECT lower(TRIM(name)) n, count(*) c FROM products GROUP BY n HAVING c > 1");
console.log('\ncódigos repetidos:', JSON.stringify(dup), '· nombres repetidos:', JSON.stringify(dupNom));
console.log('ventas:', JSON.stringify(q('SELECT count(*) c FROM sales')[0]), '· servicios:', JSON.stringify(q('SELECT count(*) c FROM services')[0]));
db.close();
