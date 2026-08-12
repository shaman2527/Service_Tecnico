import { evalx, clickCenter, sleep } from "./cdp_driver.mjs";

const dump = async (label, expr) => console.log(`[${label}]`, await evalx(expr));

await clickCenter(`[...document.querySelectorAll("button")].find(x => x.innerText.trim() === "Dashboard")`);
await sleep(1500);
await dump("Dashboard-texto", `(() => { const t = document.body.innerText; const i = t.indexOf("Ventas Hoy"); return JSON.stringify({tieneVentasHoy: i >= 0, ctx: t.slice(Math.max(0, i - 120), i + 320)}); })()`);

await clickCenter(`[...document.querySelectorAll("button")].find(x => x.innerText.trim() === "Ventas")`);
await sleep(1200);
await dump("Ventas-botones", `JSON.stringify([...document.querySelectorAll("button")].map(b => b.innerText.trim()).filter(t => t && t.length < 20).slice(0, 14))`);

await clickCenter(`[...document.querySelectorAll("button")].find(x => x.innerText.trim() === "Pantallas")`);
await sleep(1500);
await dump("Pantallas-texto", `(() => { const t = document.body.innerText; const i = t.indexOf("Pantalla"); return JSON.stringify({primero: t.slice(i, i + 200).replace(/\\n/g, " | ")}); })()`);

process.exit(0);