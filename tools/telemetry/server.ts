import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "../config";
import { loadMemory } from "../memory/store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const LOG_PATH = path.join(projectRoot, config.paths.progressDir, "logs", "harness.log");

function readLogs(lines = 100): string[] {
  try {
    const content = fs.readFileSync(LOG_PATH, "utf-8");
    const entries = content.split("\n").filter(Boolean);
    return entries.slice(-lines).map(l => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch {
    return [];
  }
}

function htmlDashboard(): string {
  const mem = loadMemory();
  const logs = readLogs(50);
  const errorCount = Object.keys(mem.errors).length;
  const unresolved = Object.values(mem.errors).filter(e => !e.resolvedAt);

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Harness Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem}
h1{color:#58a6ff;margin-bottom:1rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;margin-bottom:2rem}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1.5rem}
.card h3{color:#8b949e;font-size:.85rem;text-transform:uppercase;margin-bottom:.5rem}
.card .val{font-size:2rem;font-weight:700;color:#58a6ff}
.card .val.green{color:#3fb950}.card .val.red{color:#f85149}
table{width:100%;border-collapse:collapse;margin-top:1rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #30363d}
th{color:#8b949e;font-size:.85rem;text-transform:uppercase}
.log-error{color:#f85149}.log-warn{color:#d29922}.log-info{color:#58a6ff}
pre{font-family:monospace;font-size:.85rem;white-space:pre-wrap}
</style></head>
<body>
<h1>🔧 Harness ENGINEERING</h1>
<div class="grid">
  <div class="card"><h3>Sesiones</h3><div class="val">${mem.sessionCount}</div></div>
  <div class="card"><h3>Último Loop</h3><div class="val ${mem.lastLoopResult === 'pass' ? 'green' : 'red'}">${mem.lastLoopResult}</div></div>
  <div class="card"><h3>Errores</h3><div class="val ${errorCount > 0 ? 'red' : 'green'}">${errorCount}</div></div>
  <div class="card"><h3>No resueltos</h3><div class="val ${unresolved.length > 0 ? 'red' : 'green'}">${unresolved.length}</div></div>
  <div class="card"><h3>Convenciones</h3><div class="val">${mem.conventions.length}</div></div>
  <div class="card"><h3>Fases OK</h3><div class="val green">${mem.totalPhasesPassed}</div></div>
</div>

${unresolved.length > 0 ? `<h2>⛔ Errores no resueltos</h2>
<table><thead><tr><th>Módulo</th><th>Error</th><th>Ocurrencias</th><th>Severidad</th></tr></thead>
<tbody>${unresolved.slice(0, 20).map(e => `<tr>
  <td>${e.module}</td><td>${e.message.slice(0, 80)}</td><td>${e.count}</td>
  <td class="log-${e.severity === 'critical' ? 'error' : 'warn'}">${e.severity}</td>
</tr>`).join("")}</tbody></table>` : ""}

<h2>📋 Log reciente</h2>
<table><thead><tr><th>Hora</th><th>Nivel</th><th>Módulo</th><th>Mensaje</th></tr></thead>
<tbody>${logs.slice(-30).reverse().map((l: any) => `<tr>
  <td>${l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "-"}</td>
  <td class="log-${l.level || 'info'}">${l.level || "?"}</td>
  <td>${l.module || "-"}</td>
  <td>${(l.message || l.raw || "").slice(0, 100)}</td>
</tr>`).join("")}</tbody></table>

<h2>📐 Convenciones activas</h2>
${mem.conventions.length === 0 ? "<p>Ninguna</p>" : `<table><thead><tr><th>Descripción</th><th>Módulo</th><th>Violaciones</th></tr></thead>
<tbody>${mem.conventions.slice(0, 20).map(c => `<tr><td>${c.description}</td><td>${c.module}</td><td>${c.violations}</td></tr>`).join("")}</tbody></table>`}
<p style="margin-top:2rem;color:#484f58;font-size:.85rem">Auto-refresh cada 30s &middot; <a href="/" style="color:#58a6ff">Recargar</a></p>
<script>setTimeout(()=>location.reload(),30000)</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/memory") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadMemory(), null, 2));
  } else if (req.url === "/api/logs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readLogs(200), null, 2));
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(htmlDashboard());
  }
});

const PORT = parseInt(process.env.HARNESS_DASHBOARD_PORT || "3987", 10);
server.listen(PORT, () => {
  console.log(`\n📊 Harness Dashboard: http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/memory`);
});
