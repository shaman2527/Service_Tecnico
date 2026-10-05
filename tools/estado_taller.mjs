import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const p = path.join(process.env.LOCALAPPDATA, 'Registro Servicio Tecnico', 'registro.db');
const db = new DatabaseSync(p, { readOnly: true });
const j = (x) => JSON.stringify(x);
console.log(`BASE DEL TALLER (solo lectura): ${p}`);
console.log('  productos:', db.prepare('SELECT COUNT(*) n FROM products').get().n,
  '| stock:', db.prepare('SELECT COALESCE(SUM(stock),0) n FROM products').get().n,
  '| teléfonos:', db.prepare('SELECT COUNT(*) n FROM phones').get().n);
const hot = db.prepare('SELECT code, compatibility FROM products WHERE id=1025').get();
console.log('  Hot 30i:', hot?.code, j(JSON.parse(hot?.compatibility ?? '[]')));
console.log('  ventas:', db.prepare('SELECT COUNT(*) n FROM sales').get().n,
  '| servicios:', db.prepare('SELECT COUNT(*) n FROM services').get().n,
  '| turnos abiertos:', db.prepare('SELECT COUNT(*) n FROM daily_closings WHERE is_closed=0').get().n);
