// AUDITORÍA POR MODELO (F86) — «para cada modelo revisá si tiene que arreglarlo».
//
// Responde, sobre una COPIA de la base, la pregunta del dueño (2026-10-04): «estoy cargando una data
// masiva… debería funcionar en base al modelo que debería ir». Comprueba, teléfono por teléfono, que la
// relación PRODUCTO ↔ MODELO esté coherente y lista lo que hay que arreglar:
//
//   1. Fichas con MODELO pero SIN compatibilidad → NO entran al padrón (no aparecen en «Modelos» ni en
//      «Repuesto por modelo»). Desde F86 la compatibilidad se DERIVA del modelo, así que estas fichas
//      se arreglan solas al re-normalizar (Inventario → Ajustes → ordenar el catálogo).
//   2. Fichas cuya compatibilidad NO incluye su PROPIO modelo (la lista ignora al teléfono principal).
//   3. Modelos que existen como texto en las fichas pero NO están en el padrón.
//   4. Teléfonos del padrón SIN ningún repuesto compatible (aparecen en el selector y no sirven nada).
//   5. Stock: SOLO el de las fichas. Un modelo NO tiene stock propio (F86/D3) — el número que se veía
//      era la suma de sus repuestos y el mismo repuesto cuenta en varios modelos.
//
// SEGURIDAD DE DATOS: solo lee. Nunca apunta a la base del taller sin copiarla antes.
//
// Uso:  node tools/audit_modelos.mjs --db "%LOCALAPPDATA%\Registro Servicio Tecnico\registro.db"

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const iDb = argv.indexOf('--db');
const ruta = iDb >= 0 ? argv[iDb + 1] : path.join(ROOT, 'dev_registro.db');
const dbPath = path.resolve(ruta);
if (!fs.existsSync(dbPath)) {
  console.error(`ABORTADO: no existe el archivo ${dbPath}`);
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const uno = (sql, ...p) => db.prepare(sql).get(...p);
const todos = (sql, ...p) => db.prepare(sql).all(...p);

/** Las categorías que alimentan el padrón (misma regla que catalog.rs: Pantalla, Táctil, Táctil Tablet). */
const CATS_PADRON = [1, 18, 19];
/** Clave del padrón: «marca|modelo» en minúsculas y sin acentos (así las guarda `phones.key`). */
const clave = (marca, modelo) => {
  const limpiar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${limpiar(marca)}|${limpiar(modelo)}`;
};

console.log(`AUDITORÍA POR MODELO · ${path.basename(dbPath)} (solo lectura)`);

// ── 0) los números de arriba ────────────────────────────────────────────────────────────────────
const total = uno(`SELECT COUNT(*) c FROM products`).c;
const conModelo = uno(`SELECT COUNT(*) c FROM products WHERE TRIM(COALESCE(model,''))<>''`).c;
const sinCompat = uno(`SELECT COUNT(*) c FROM products WHERE TRIM(COALESCE(model,''))<>'' AND COALESCE(compatibility,'') IN ('','[]')`).c;
const telefonos = uno(`SELECT COUNT(*) c FROM phones`).c;
const unidades = uno(`SELECT COALESCE(SUM(stock),0) c FROM products`).c;
const negativos = todos(`SELECT id, name, brand, model, stock FROM products WHERE stock < 0 ORDER BY stock`);
console.log(`  fichas: ${total} · con modelo: ${conModelo} · teléfonos en el padrón: ${telefonos} · unidades (solo fichas): ${unidades}`);

// ── 1) fichas con modelo y sin compatibilidad (no entran al padrón) ─────────────────────────────
console.log(`\n1) FICHAS CON MODELO PERO SIN COMPATIBILIDAD (no aparecen en «Modelos» ni en «Repuesto por modelo»): ${sinCompat}`);
for (const r of todos(`SELECT id, name, brand, model, stock FROM products
                       WHERE TRIM(COALESCE(model,''))<>'' AND COALESCE(compatibility,'') IN ('','[]')
                       ORDER BY id LIMIT 10`)) {
  console.log(`   #${r.id} «${String(r.name).slice(0, 46)}» marca=${r.brand} modelo=${r.model} stock=${r.stock}`);
}
if (sinCompat > 10) console.log(`   … y ${sinCompat - 10} más (los arregla «ordenar el catálogo» en Ajustes: la lista se deriva del modelo)`);

// ── 2) fichas cuya compatibilidad no incluye su propio modelo ───────────────────────────────────
const incoherentes = todos(`SELECT id, name, brand, model, compatibility FROM products
                            WHERE TRIM(COALESCE(model,''))<>'' AND COALESCE(compatibility,'') NOT IN ('','[]')`);
const sinSuModelo = incoherentes.filter(r => {
  const lista = String(r.compatibility).toLowerCase();
  const modelo = String(r.model).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return modelo && !lista.split(/[^a-z0-9]+/).join(' ').includes(modelo);
});
console.log(`\n2) FICHAS CUYA COMPATIBILIDAD NO INCLUYE SU PROPIO MODELO: ${sinSuModelo.length}`);
for (const r of sinSuModelo.slice(0, 10)) {
  console.log(`   #${r.id} modelo=«${r.model}» pero la lista dice ${String(r.compatibility).slice(0, 80)}`);
}

// ── 3) modelos del texto de las fichas que NO están en el padrón ────────────────────────────────
const llaves = new Set(todos(`SELECT key FROM phones`).map(r => r.key));
const faltantes = new Map();
for (const r of todos(`SELECT id, name, brand, model FROM products
                       WHERE category_id IN (${CATS_PADRON.join(',')}) AND COALESCE(compatibility,'') NOT IN ('','[]')`)) {
  for (const entrada of (() => { try { const l = JSON.parse(r.compatibility); return Array.isArray(l) ? l : []; } catch { return []; } })()) {
    const texto = String(entrada).trim();
    const partes = texto.split(/\s+/);
    // la entrada es «Marca Modelo» (la marca puede tener varias palabras): se prueban los cortes
    for (let k = 1; k < partes.length; k++) {
      const marca = partes.slice(0, k).join(' ');
      const modelo = partes.slice(k).join(' ');
      if (llaves.has(clave(marca, modelo))) break;
      if (k === partes.length - 1) faltantes.set(texto, (faltantes.get(texto) ?? 0) + 1);
    }
  }
}
console.log(`\n3) TELÉFONOS NOMBRADOS EN LA COMPATIBILIDAD QUE NO ESTÁN EN EL PADRÓN: ${faltantes.size}`);
for (const [texto, n] of [...faltantes].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   «${texto}» en ${n} ficha(s)`);

// ── 4) teléfonos del padrón sin ningún repuesto compatible ─────────────────────────────────────
// OJO con la trampa (medida 2026-10-04): el padrón guarda el modelo CANÓNICO («iphone 11 pro») y la
// compatibilidad del repuesto suele traer la etiqueta corta («Apple 11 Pro»). Comparar por el modelo
// pelado marca como «sin repuesto» a 50 teléfonos que SÍ tienen: el puente son los `aliases` de la
// fila. Un teléfono está servido si el modelo, el nombre o CUALQUIERA de sus alias aparece en la
// compatibilidad de alguna ficha de las categorías del padrón.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const compatDeFichas = todos(`SELECT COALESCE(compatibility,'') c FROM products
                              WHERE category_id IN (${CATS_PADRON.join(',')}) AND COALESCE(compatibility,'') NOT IN ('','[]')`)
  .map(r => norm(r.c)).join(' \u0001 ');
const textos = (r) => {
  let alias = [];
  try { const l = JSON.parse(r.aliases); if (Array.isArray(l)) alias = l; } catch { /* alias roto */ }
  // El MODELO PELADO también cuenta: hay entradas de compatibilidad escritas como modelo suelto
  // («8P» con brand Tecno → teléfono canónico «Tecno 8P»), y sin esto el teléfono parecería vacío.
  return [r.model, r.name, ...alias].map(norm).filter(t => t.length >= 2);
};
const telefonosPadron = todos(`SELECT id, code, brand, name, model, COALESCE(aliases,'[]') aliases FROM phones`);
const sinRepuesto = telefonosPadron.filter(r => !textos(r).some(t => compatDeFichas.includes(t)));
console.log(`\n4) TELÉFONOS DEL PADRÓN SIN NINGÚN REPUESTO COMPATIBLE: ${sinRepuesto.length}`);
for (const r of sinRepuesto.slice(0, 15)) console.log(`   ${r.code} ${r.brand} ${r.name}`);

// ── 5) stock: solo de las fichas, y quién está en faltante ─────────────────────────────────────
console.log(`\n5) FALTANTES (stock negativo en la ficha — es el ÚNICO stock que existe): ${negativos.length}`);
for (const r of negativos.slice(0, 12)) console.log(`   #${r.id} «${String(r.name).slice(0, 44)}» modelo=${r.model} stock=${r.stock}`);

// ── resumen accionable ─────────────────────────────────────────────────────────────────────────
console.log('\nRESUMEN');
console.log(`  · arreglar con «ordenar el catálogo» (Ajustes): ${sinCompat} ficha(s) sin compatibilidad`);
console.log(`  · revisar a mano (dato incoherente): ${sinSuModelo.length} ficha(s) cuya lista ignora su modelo`);
console.log(`  · revisar el padrón (teléfonos sin repuesto): ${sinRepuesto.length}`);
console.log(`  · faltantes reales (ficha en negativo): ${negativos.length}`);
db.close();
process.exit(0);
