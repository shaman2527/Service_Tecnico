// Verificación del GATE DE SEGURIDAD del harness (B5 de la validación pre-producción).
//
// El gate daba un "falso verde": solo juntaba `.ts/.tsx` bajo `paths.apiDir` (que en este
// proyecto es `src-tauri/src`), así que escaneaba el backend DOS veces y el frontend NUNCA, y
// encima los chequeos de secretos/debug vivían solo en la rama "API" → 0 hallazgos siempre.
//
// Este script prueba el gate por COMPORTAMIENTO, sin tocar el código real:
//   1. PASS con el repo tal cual (y que haya escaneado archivos de verdad, no 0).
//   2. FALLA al inyectar un secreto de prueba (frontend) → el gate lo encuentra y lo nombra.
//   3. FALLA al inyectar un secreto en el BACKEND Rust → cubre el backend.
//   4. El archivo de prueba se borra SIEMPRE (finally) y el gate vuelve a PASS.
//
// Uso: node tools/node_modules/tsx/dist/cli.mjs tools/verify_security_gate.mjs

import * as fs from 'fs';
import * as path from 'path';
import { runFullSecurityScan } from './governance/security-validator.ts';

const PROBE_FRONT = path.join('src', '__sec_probe.ts');
const PROBE_BACK = path.join('src-tauri', 'src', '__sec_probe.rs');
const SECRETO = 'export const API_KEY = "sk-live-abcdef1234567890abcdef1234567890";\n';

let checks = 0, failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ->  ${detail}` : ''}`);
};

try {
  const base = await runFullSecurityScan();
  check('el gate escanea archivos de verdad (no un PASS vacío)', Number(base.scanned) > 50,
    `${base.scanned} archivos · ${base.issues.length} hallazgo(s)`);
  check('el repo real pasa el gate', base.passed === true,
    base.issues.filter(i => i.severity === 'error').map(i => `${i.code} ${i.file}`).join(' | ') || 'sin errores');

  fs.writeFileSync(PROBE_FRONT, SECRETO, 'utf-8');
  const front = await runFullSecurityScan();
  check('un secreto en el FRONTEND hace FALLAR el gate',
    front.passed === false && front.issues.some(i => i.code === 'SECRET-LEAK' && i.file.includes('__sec_probe.ts')),
    front.issues.filter(i => i.severity === 'error').map(i => `${i.code} ${i.file}`).join(' | ') || 'no lo detectó');
  fs.unlinkSync(PROBE_FRONT);

  fs.writeFileSync(PROBE_BACK, SECRETO, 'utf-8');
  const back = await runFullSecurityScan();
  check('un secreto en el BACKEND (Rust) también hace FALLAR el gate',
    back.passed === false && back.issues.some(i => i.code === 'SECRET-LEAK' && i.file.includes('__sec_probe.rs')),
    back.issues.filter(i => i.severity === 'error').map(i => `${i.code} ${i.file}`).join(' | ') || 'no lo detectó');
} finally {
  for (const p of [PROBE_FRONT, PROBE_BACK]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* nada */ }
  }
}

const final = await runFullSecurityScan();
check('el gate vuelve a PASS cuando el archivo de prueba se borra', final.passed === true,
  `${final.scanned} archivos`);
check('no quedaron archivos de prueba', !fs.existsSync(PROBE_FRONT) && !fs.existsSync(PROBE_BACK));

console.log(`\ngate de seguridad: ${checks} comprobaciones · ${checks - failures} OK · ${failures} fallo(s)`);
process.exit(failures > 0 ? 1 : 0);
