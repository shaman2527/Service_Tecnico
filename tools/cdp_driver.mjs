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

export { evalx, clickCenter, clickXY, keyNav, typeText, insertText, sleep, handleDialog };
