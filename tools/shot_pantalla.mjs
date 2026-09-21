// CAPTURA DE PANTALLA de la app (para REVISAR LA UI con los ojos, no solo con aserciones).
//
// Las verificaciones en vivo (`verify_*.mjs`) comprueban números y selectores, pero no si la
// pantalla SE VE profesional — que es justamente lo que pidió el dueño («se ve abrumador con ese
// poco de types»). Este script guarda un PNG de la ventana de la app por CDP y opcionalmente
// scrollea a un selector antes de disparar.
//
//   node tools/shot_pantalla.mjs --out backup/shot_resumen.png [--scroll "[data-panel=\"resumen-dia\"]"]
//                               [--full] [--width 1280 --height 900]
//
// Requiere la app corriendo con el puerto de depuración:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const OUT = path.resolve(ROOT, arg('--out', path.join('backup', 'shot.png')));
const SCROLL = arg('--scroll', null);
const FULL = argv.includes('--full');
const WIDTH = Number(arg('--width', 0));
const HEIGHT = Number(arg('--height', 0));

const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find(t => t.type === 'page') || list[0];
if (!page) { console.error('sin targets: ¿está la app corriendo con --remote-debugging-port=9222?'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const msgId = ++id;
  pending.set(msgId, res);
  ws.send(JSON.stringify({ id: msgId, method, params }));
  setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); rej(new Error(`timeout: ${method}`)); } }, 25000);
});
const evaluar = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
if (WIDTH && HEIGHT) await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

// Cerrar cualquier diálogo/popover abierto: tapa el panel que se quiere revisar.
await evaluar(`(() => { document.querySelectorAll('[role="dialog"]').forEach(() => {}); return true; })()`);
if (SCROLL) {
  await evaluar(`(() => { const e = document.querySelector(${JSON.stringify(SCROLL)}); if (e) e.scrollIntoView({ block: 'start' }); return !!e; })()`);
}
await new Promise(r => setTimeout(r, 1200));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!FULL });
if (!shot.result?.data) { console.error('no se pudo capturar:', JSON.stringify(shot).slice(0, 300)); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log(`Captura: ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
ws.close();
process.exit(0);
