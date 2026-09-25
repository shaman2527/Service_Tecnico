// Pruebas PURAS de la pantalla de RESPALDOS (F71, `src/lib/backup.ts`).
//
// El bloqueante A2 de la auditoría de entrega: los comandos de respaldo existían pero ninguna pantalla
// los llamaba, y la Ayuda decía «copiá registro.db a un USB». El backend hace la copia consistente
// (probado en Rust); acá se fija lo que la PANTALLA tiene que decir: cómo está el respaldo hoy, qué va
// a pasar al restaurar y qué no se puede restaurar.
//
// Uso:  node tools/backup_test.ts

import {
  saludRespaldo, etiquetaRespaldo, fechaLegible, tamanoLegible, textoRestauracion, puedeRestaurar,
  diaSemana, type Respaldo,
} from '../src/lib/backup.ts';

let ok = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) ok++; else { fail++; console.log(`FALLA · ${name}\n   esperado: ${w}\n   obtenido: ${g}`); }
};
const si = (name: string, cond: boolean, detalle = '') => {
  if (cond) ok++; else { fail++; console.log(`FALLA · ${name}${detalle ? `\n   ${detalle}` : ''}`); }
};

const HOY = '2026-09-23';
const respaldo = (p: Partial<Respaldo> = {}): Respaldo => ({
  name: 'registro_2026-09-23_181500.db',
  path: 'C:\\app\\respaldos\\registro_2026-09-23_181500.db',
  size_bytes: 900 * 1024,
  created_at: '2026-09-23 18:15:00',
  automatico: false,
  seguridad: false,
  ...p,
});

// ── 1. CÓMO ESTÁ EL RESPALDO HOY (lo primero que el dueño tiene que ver) ──────────────────────
{
  const sinNada = saludRespaldo({ ultimo: null, error: null }, HOY);
  eq('sin respaldos el estado es «sin_respaldo»', sinNada.estado, 'sin_respaldo');
  si('y lo dice con todas las letras (no un número suelto)', /se pierde todo el negocio/i.test(sinNada.texto), sinNada.texto);
  si('y alerta', sinNada.alerta);

  const hoy = saludRespaldo({ ultimo: respaldo(), error: null }, HOY);
  eq('un respaldo de hoy está al día', hoy.estado, 'al_dia');
  si('y lo dice con su fecha', hoy.texto.includes('23/09/2026 18:15'), hoy.texto);
  si('sin alerta', !hoy.alerta);

  const dosDias = saludRespaldo({ ultimo: respaldo({ created_at: '2026-09-21 10:00:00' }), error: null }, HOY);
  eq('dos días atrás es «atrasado»', dosDias.estado, 'atrasado');
  si('con los días contados', dosDias.texto.includes('hace 2 días'), dosDias.texto);
  si('y alerta', dosDias.alerta);

  const viejo = saludRespaldo({ ultimo: respaldo({ created_at: '2026-09-10 09:00:00' }), error: null }, HOY);
  eq('más de dos días es «viejo»', viejo.estado, 'viejo');
  si('dice cuántos días', viejo.texto.includes('hace 13 días'), viejo.texto);
  si('y alerta', viejo.alerta);

  // Un error de respaldo GANA sobre el «hay uno viejo»: es lo que el dueño tiene que arreglar
  const conError = saludRespaldo({ ultimo: respaldo(), error: 'disco lleno' }, HOY);
  eq('un error de respaldo se informa como problema', conError.estado, 'viejo');
  si('y nombra el error', conError.texto.includes('FALLÓ: disco lleno'), conError.texto);
  si('y alerta', conError.alerta);
  eq('un error en blanco no es error', saludRespaldo({ ultimo: respaldo(), error: '  ' }, HOY).estado, 'al_dia');
}

// ── 2. CÓMO SE VE CADA RESPALDO EN LA LISTA ───────────────────────────────────────────────────
{
  eq('un automático se rotula como tal', etiquetaRespaldo({ automatico: true, seguridad: false, created_at: HOY }), 'Automático (al cerrar el día)');
  eq('uno pedido a mano', etiquetaRespaldo({ automatico: false, seguridad: false, created_at: HOY }), 'Lo pediste vos');
  eq('la copia previa a una restauración se distingue', etiquetaRespaldo({ automatico: false, seguridad: true, created_at: HOY }), 'Copia previa a una restauración');
  eq('la fecha se muestra corta y legible', fechaLegible('2026-09-23 18:15:00'), '23/09/2026 18:15');
  eq('y sin fecha no se inventa nada', fechaLegible(''), '—');
  eq('tamaño en MB', tamanoLegible(3 * 1024 * 1024), '3.0 MB');
  eq('tamaño en KB', tamanoLegible(900 * 1024), '900 KB');
  eq('tamaño en bytes', tamanoLegible(512), '512 B');
  eq('el día de la semana sale de la fecha', diaSemana('2026-09-23'), 'miércoles');
}

// ── 3. QUÉ VA A PASAR AL RESTAURAR (sin esto, el botón asusta) ────────────────────────────────
{
  const t = textoRestauracion(respaldo(), 3);
  si('dice QUÉ archivo se aplica', t.includes('registro_2026-09-23_181500.db'), t);
  si('y DE CUÁNDO es', t.includes('23/09/2026 18:15'), t);
  si('y cuánto pesa', t.includes('900 KB'), t);
  si('y que PRIMERO se guarda una copia de lo actual', /Antes se guarda una copia de lo que hay ahora/i.test(t), t);
  si('y que la app se reinicia', /reinicia/i.test(t), t);
  si('y que lo cargado después se pierde (sin adornos)', /DESPUÉS de ese respaldo se pierde/i.test(t), t);

  // Validación de lo que se puede restaurar: la pantalla no ofrece lo que el backend rechaza
  eq('un .db se puede restaurar', puedeRestaurar('C:\\app\\respaldos\\registro.db').ok, true);
  eq('sin archivo elegido no', puedeRestaurar('').ok, false);
  si('y dice qué hacer', /Elegí un respaldo/i.test(puedeRestaurar('').motivo ?? ''), String(puedeRestaurar('').motivo));
  const txt = puedeRestaurar('C:\\algo\\respaldo.txt');
  eq('un archivo que no es .db no se ofrece', txt.ok, false);
  si('con su motivo', /\.db/i.test(txt.motivo ?? ''), String(txt.motivo));
  eq('y el archivo real del backend (con ruta y .db) sí', puedeRestaurar('C:\\Users\\R\\respaldos\\antes_de_restaurar_2026-09-23_181500.db').ok, true);
}

console.log(`\n${ok}/${ok + fail} pruebas de respaldos`);
if (fail > 0) process.exit(1);
