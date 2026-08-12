import { readFileSync } from 'node:fs';
const expr = readFileSync(0, 'utf8');
const list = await (await fetch('http://localhost:9222/json/list')).json();
const wsUrl = list[0].webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const result = await new Promise((resolve) => {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) resolve(msg);
  };
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: expr, awaitPromise: true, returnByValue: true },
  }));
});
console.log(JSON.stringify(result.result?.result?.value ?? result, null, 1));
ws.close();
