import { isFinalized, parseServiceTypes } from './utils.ts';
import type { Service } from '../types';

// Cola de entregas (F30): funciones PURAS para encontrar la orden y saber qué le falta.
// Se prueban sin navegador en `tools/queue_test.ts`.

/** Identificador del backend para las órdenes que todavía no salieron del taller. */
export const ACTIVE_QUEUE = '__activos__';

export const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * Pliega texto para comparar como lo escribe el operario: sin acentos, minúsculas y sin
 * espacios de sobra. Sin esto, «JOSÉ PÉREZ» NO aparecía al buscar «jose» (bug real: el
 * buscador de la cola es el único filtro, `CierreQueueDialog` usa `shouldFilter={false}`).
 */
export const fold = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Sin guiones ni espacios: «DEV 0001» y «dev0001» encuentran «DEV-0001». */
export const compact = (s: string) => s.replace(/[^a-z0-9]/g, '');

/**
 * Relevancia de una orden frente a lo que el operario escribe/escucha. `null` = no coincide
 * (o no hay texto que buscar, que no es lo mismo que «coincide perfecto»).
 * Prioridad: número de orden → cédula → teléfono → nombre/modelo (palabra) → todos los
 * términos → parcial.
 */
export function scoreQueueMatch(s: Service, q: string): number | null {
  const t = fold(q);
  if (!t) return null;
  const tc = compact(t);
  const digitos = soloDigitos(t);
  const orden = fold(s.order_num);
  const ordenC = compact(orden);

  if (orden === t || (tc.length >= 4 && ordenC === tc)) return 0;
  if (orden.startsWith(t) || (tc.length >= 4 && ordenC.startsWith(tc))) return 1;

  const ci = soloDigitos(s.client_ci);
  const tel = soloDigitos(s.phone);
  if (digitos.length >= 3) {
    if (ci && ci.startsWith(digitos)) return 2;
    if (tel && tel.startsWith(digitos)) return 3;
    if (ci.includes(digitos) || tel.includes(digitos)) return 4;
  }

  // Trozo del nº de orden («0001» → DEV-0001). Va DESPUÉS de cédula/teléfono y con puntaje
  // bajo a propósito: «0414» es el prefijo de celular más común y no debe hacer que la orden
  // DEV-0414 gane a la orden del cliente que de verdad llamó desde 0414…
  if (tc.length >= 4 && ordenC.includes(tc)) return 5;

  const cliente = fold(s.client);
  const modelo = fold(s.model);
  const palabras = (x: string) => x.split(/\s+/).filter(Boolean);
  const tokens = t.split(/\s+/).filter(Boolean);
  const hay = `${cliente} ${modelo}`;

  // nombre/modelo por PALABRA (que "note" no gane a "Note 11" por letras sueltas)
  if (tokens.some(w => palabras(cliente).some(x => x.startsWith(w)) || palabras(modelo).some(x => x.startsWith(w)))) return 5;
  // varios términos en cualquier orden: «redmi 11» encuentra «Redmi Note 11»
  if (tokens.length > 1 && tokens.every(w => hay.includes(w))) return 6;
  if (hay.includes(t)) return 7;
  // con puntuación distinta a la del catálogo: «g51-5g» o «perez.» (el operario teclea con
  // guiones/puntos y el nombre está guardado sin ellos, o al revés)
  if (tc.length >= 4 && compact(hay).includes(tc)) return 7;
  return null;
}

/** Cola filtrada y ordenada por relevancia (empate: la orden más nueva primero). */
export function rankQueue(cola: Service[], query: string): Service[] {
  const q = query.trim();
  if (!q) return [...cola].sort((a, b) => b.id - a.id);
  return cola
    .map(s => ({ s, score: scoreQueueMatch(s, q) }))
    .filter((x): x is { s: Service; score: number } => x.score !== null)
    .sort((a, b) => (a.score - b.score) || (b.s.id - a.s.id))
    .map(x => x.s);
}

/** Lo que le falta a la orden para poder entregarse (lo mismo que pide el asistente). */
export function queueFlags(s: Service) {
  const trabajos = parseServiceTypes(s);
  const pantallaPendiente = trabajos.includes('Cambio pantalla') && s.screen_product_id == null;
  const saldo = Math.max(0, (s.amount ?? 0) - (s.paid_amount ?? 0));
  return {
    pantallaPendiente,
    saldo,
    debe: saldo > 0.005,
    imprimible: (s.printed ?? 0) === 0,
    /** anulada (Devuelto/Cancelado) — OJO: 'Entregado' NO es finalizada (acepta devolución) */
    anulada: isFinalized(s.status),
  };
}
