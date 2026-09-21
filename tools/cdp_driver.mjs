const CDP_URL = "http://localhost:9222";

const list = await (await fetch(`${CDP_URL}/json/list`)).json();
const page = list.find((t) => t.type === "page") || list[0];
if (!page) { console.error("sin targets"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};

// 25s: el WebView2 tarda en contestar mientras arranca la app (IPC frío + primera carga
// de Vite). Con 10s una verificación podía morir por «timeout: Runtime.evaluate» en el
// arranque aunque la app estuviera perfecta.
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, res);
    ws.send(JSON.stringify({ id: msgId, method, params }));
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); rej(new Error(`timeout: ${method}`)); } }, 25000);
  });

const evalx = async (expr) => {
  // `awaitPromise` es obligatorio para evaluar expresiones async
  // (`invoke(...).then(...)`, `(async () => { … })()`): sin él, Chrome devuelve el
  // objeto Promise serializado como `{}` (lección 2026-09-16).
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval error");
      return r.result?.result?.value;
    } catch (e) {
      lastErr = e;
      // un timeout en el arranque se reintenta: el page todavía estaba cargando
      if (!/^timeout:/.test(String(e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickCenter = async (expr, { retries = 8, delay = 400 } = {}) => {
  let v = null;
  for (let i = 0; i < retries; i++) {
    // `scrollIntoView` primero: un botón fuera de la pantalla tiene coordenadas que caen
    // afuera de la ventana y el click no llega (falso «no encontrado»/«no abre nada»).
    v = await evalx(`(() => {
      const el = (${expr});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) return null;
      return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2});
    })()`);
    if (v) break;
    await sleep(delay);
  }
  if (!v) throw new Error("click target no encontrado");
  const { x, y } = JSON.parse(v);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(700);
};

const keyNav = async (key, code, vk) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
};

const typeText = async (text) => {
  for (const ch of text) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, code: "Key" + ch.toUpperCase(), windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code: "Key" + ch.toUpperCase(), windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
  }
};

/** Pega texto VARIAS LÍNEAS en el elemento enfocado (los \n no viajan como teclas). */
const insertText = async (text) => {
  await send("Input.insertText", { text });
  await sleep(200);
};

const clickXY = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(700);
};

/**
 * Contesta un diálogo NATIVO del navegador (confirm/alert) que esté bloqueando la página.
 * La app pide confirmación en dos lugares: volver atrás con correcciones y el aviso del barrido
 * cuando la lista parece parcial. Sin esto, la página queda bloqueada y los `evalx` dan timeout.
 * Devuelve false si no había ningún diálogo pendiente.
 */
const handleDialog = async (accept = true) => {
  try {
    const r = await send("Page.handleJavaScriptDialog", { accept });
    await sleep(400);
    return !r.error;
  } catch {
    return false;
  }
};

/**
 * La barra lateral se recuerda en `localStorage('sidebar_collapsed')`. Una barra COLAPSADA (w-16)
 * deja los botones SIN TEXTO, así que toda verificación que navegue por el nombre del ítem
 * (`aside button` + `innerText`) falla con «click target no encontrado» — y parece que la app está
 * rota cuando en realidad es una preferencia de la UI del operario (lección 2026-09-21: el 100% de
 * una corrida de verificación en vivo se cayó por esto, con el producto perfecto).
 *
 * Se corre SOLA al importar el driver: si está colapsada la expande y recarga UNA vez. Si ya está
 * expandida no hace nada (ni cuesta tiempo). Nunca lanza: si algo falla, el script sigue igual que
 * antes de existir esta función.
 */
export async function ensureSidebarExpanded() {
  try {
    // `localStorage` responde incluso en la pantalla del PIN (no depende del <aside> montado).
    if (await evalx(`localStorage.getItem('sidebar_collapsed') === '1'`) !== true) return false;
    await evalx(`localStorage.setItem('sidebar_collapsed','0'); 'ok'`);
    await evalx(`location.reload(); 'recargando'`).catch(() => {});
    await sleep(2500);
    for (let i = 0; i < 12; i++) {
      if (await evalx(`!!document.querySelector('aside, input[placeholder="PIN de 4 dígitos"]')`).catch(() => false)) break;
      await sleep(800);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Escribe en un campo COMPROBANDO que el texto entró. `typeText` manda las teclas al elemento
 * ENFOCADO: si el clic al campo cae mientras el diálogo todavía se anima (Radix), el campo no queda
 * enfocado, el texto se pierde y la verificación falla tres pasos más adelante culpando a la app
 * (medido 2026-09-21 en TRES scripts distintos: «no se llega al paso 2», «opciones=[]», «click target
 * no encontrado»). Devuelve true si el valor quedó escrito.
 */
export async function escribirEn(sel, texto, intentos = 6) {
  for (let i = 0; i < intentos; i++) {
    await clickCenter(sel).catch(() => {});
    if (await evalx(`document.activeElement === (${sel})`).catch(() => false)) {
      await typeText(texto);
      await sleep(250);
      const v = await evalx(`(${sel})?.value ?? null`).catch(() => null);
      if (String(v ?? '').includes(texto)) return true;
      // el texto no entró (o entró a medias): se limpia y se reintenta
      await evalx(`(() => { const e = ${sel}; if (e && e.select) e.select(); return !!e; })()`).catch(() => {});
      await keyNav('Backspace', 'Backspace', 8);
    }
    await sleep(400);
  }
  return false;
}

export { evalx, clickCenter, clickXY, keyNav, typeText, insertText, sleep, handleDialog };

// Se ejecuta al importar: ninguna verificación en vivo depende ya de cómo quedó la barra lateral.
await ensureSidebarExpanded();
