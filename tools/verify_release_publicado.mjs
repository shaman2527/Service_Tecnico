// Verificación de lo PUBLICADO. Uso: node tools/verify_release_publicado.mjs [version]
// Comprueba: release en GitHub, manifiesto del updater desde el endpoint público, y que la plantilla
// empaquetada en el build sea la LIMPIA (sin datos del taller, sin día abierto, con el PIN inicial).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = process.argv[2]
  || JSON.parse(readFileSync(resolve(ROOT, 'src-tauri/tauri.conf.json'), 'utf-8')).version;

let fallos = 0;
const ok = (t, d = '') => console.log(`PASS  ${t}${d ? `  ->  ${d}` : ''}`);
const bad = (t, d = '') => { fallos += 1; console.log(`FAIL  ${t}${d ? `  ->  ${d}` : ''}`); };

// ── 1) La release existe en GitHub y es la última ───────────────────────────────────────────
const j = JSON.parse(execFileSync('gh', ['release', 'view', `v${VERSION}`, '--repo', 'shaman2527/Service_Tecnico',
  '--json', 'tagName,isDraft,isPrerelease,assets'], { encoding: 'utf-8' }));
console.log(`release: ${j.tagName} · draft: ${j.isDraft} · prerelease: ${j.isPrerelease}`);
for (const a of j.assets) console.log(`   asset: ${a.name} (${(a.size / 1024 / 1024).toFixed(2)} MB)`);
const nombres = j.assets.map(a => a.name);
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
ok(`la release v${VERSION} está publicada`, j.tagName === `v${VERSION}` ? '' : `tag ${j.tagName}`);
ok('subió el instalador', nombres.some(n => new RegExp(`${escapar(VERSION)}_x64-setup\\.exe$`).test(n)), nombres.join(', '));
ok('subió la firma .sig', nombres.some(n => n.endsWith('.exe.sig')));
ok('subió latest.json', nombres.includes('latest.json'));
ok('no quedó como borrador ni prerelease', j.isDraft === false && j.isPrerelease === false);

// ── 2) El endpoint del updater (lo que consultan las PC del local) ──────────────────────────
const url = 'https://github.com/shaman2527/Service_Tecnico/releases/latest/download/latest.json';
const r = await fetch(url, { redirect: 'follow' });
ok('el endpoint del updater responde 200', r.status === 200, `status ${r.status}`);
const manifiesto = await r.json();
ok(`el manifiesto anuncia la ${VERSION} (o sea: es la release más reciente)`, manifiesto.version === VERSION, `version ${manifiesto.version}`);
const plataforma = manifiesto.platforms?.['windows-x86_64'];
ok('la plataforma windows-x86_64 trae url + firma', Boolean(plataforma?.url && plataforma?.signature));
ok('la url del manifiesto coincide con el asset subido',
  typeof plataforma?.url === 'string' && plataforma.url.includes(VERSION) && plataforma.url.endsWith('setup.exe'),
  plataforma?.url ?? '(sin url)');
ok('la firma del manifiesto es minisign', String(plataforma?.signature).startsWith('dW50cnVzdGVkIGNvbW1lbnQ'),
  `${String(plataforma?.signature).slice(0, 28)}…`);

// La firma del manifiesto tiene que ser LA MISMA que la del .sig local (si no, el updater rechaza).
const sigLocal = resolve(ROOT, `src-tauri/target/release/bundle/nsis/Registro Servicio Tecnico_${VERSION}_x64-setup.exe.sig`);
if (existsSync(sigLocal)) {
  const firma = readFileSync(sigLocal, 'utf-8').trim();
  ok('la firma publicada es la del build local (el updater la va a aceptar)', firma === plataforma?.signature);
} else {
  bad('no encuentro el .sig local para comparar', sigLocal);
}

// ── 3) La plantilla que viaja DENTRO del instalador ─────────────────────────────────────────
const tpl = resolve(ROOT, 'src-tauri/target/release/registro.default.db');
if (!existsSync(tpl)) {
  bad('el build no dejó registro.default.db junto al exe', tpl);
} else {
  const d = new DatabaseSync(tpl, { readOnly: true });
  const n = (sql) => { try { return d.prepare(sql).get().c; } catch { return -1; } };
  const productos = n('SELECT COUNT(*) c FROM products');
  const conPrecio = n('SELECT COUNT(*) c FROM products WHERE price_sale > 0');
  const unidades = n('SELECT COALESCE(SUM(stock),0) c FROM products');
  console.log(`plantilla empaquetada (${(statSync(tpl).size / 1024).toFixed(0)} KB): ${productos} productos · ${conPrecio} con precio · ${unidades} unidades`);
  ok('la plantilla trae el catálogo', productos > 1000, `${productos} productos`);
  ok('la plantilla trae precios (una PC nueva puede cobrar)', conPrecio > 900, `${conPrecio} con precio`);
  const datos = {
    services: n('SELECT COUNT(*) c FROM services'),
    service_payments: n('SELECT COUNT(*) c FROM service_payments'),
    clients: n('SELECT COUNT(*) c FROM clients'),
    daily_closings: n('SELECT COUNT(*) c FROM daily_closings'),
    sales: n('SELECT COUNT(*) c FROM sales'),
  };
  for (const [t, c] of Object.entries(datos)) {
    ok(`la plantilla NO trae datos del taller en «${t}»`, c === 0, `${c} fila(s)`);
  }
  ok('la plantilla NO trae un día abierto', n('SELECT COUNT(*) c FROM daily_closings WHERE is_closed=0') === 0);
  const pin = d.prepare("SELECT value FROM settings WHERE key='pin'").get()?.value;
  ok('el PIN de la plantilla es el inicial documentado (no el del dueño)', pin === '1234', `pin = ${JSON.stringify(pin)}`);
  d.close();
}

console.log(fallos === 0 ? '\nTODO OK: lo publicado es la 0.4.0 con la plantilla limpia.' : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
