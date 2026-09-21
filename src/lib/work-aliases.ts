// F58 — ETIQUETAS DE TRABAJO LIMPIAS: la tabla de EQUIVALENCIAS (alias) aprobadas.
//
// El problema (medido en el local, 2026-09-21): el texto libre de «Otro» inventa sinónimos del mismo
// trabajo. En la base real hay 49 etiquetas distintas, y varias son EL MISMO trabajo escrito distinto:
// «bateria» (2) + «REPARACIÓN DE BATTERIA» (1) + «Cambio batería» (27); «placa» (1) + «Reparación
// (placa)» (1); «MANTENIMIENTO» (1) + «Limpieza / Mantenimiento» (18); «BANDEJA SIM» (1) + «Cambio de
// bandeja SIM» (2); «boton power» (1) + «Boton encendido» (1) + «Reemplazo de botones» (11)…
// Sin unificar, el dueño no puede decirle al cliente «cambié 30 baterías»: tendría que sumar a mano.
//
// DOS REGLAS QUE NO SE NEGOCIAN:
//
//   1. **La tabla es EXPLÍCITA y revisable** — nada de parecidos automáticos. Es la decisión que F44
//      dejó escrita («adivinar sería peor que mostrar de más»): acá se listan, una por una, las
//      equivalencias que el taller aprueba. Si una etiqueta no está en la tabla, se sigue contando
//      aparte. La tabla se edita EN ESTE ARCHIVO y el dueño puede sacar cualquier línea: el efecto se
//      ve al instante en los contadores, en el filtro y en la lista.
//   2. **Se aplica al CONTAR y al FILTRAR a la vez** (la misma función, `workKeys`): así el número de
//      un trabajo sigue siendo exactamente la cantidad de tarjetas que aparecen al filtrarlo.
//
// Las que están PENDIENTES de decisión del dueño viven en `A_DECIDIR` y NO se aplican: el reporte de
// `tools/audit_work_labels.mjs` las muestra con su cantidad para que las apruebe o las deje como están.

import { SERVICE_TYPES, normPhoneModel } from './utils.ts';

/**
 * Plegado de una etiqueta de trabajo: el MISMO que usan los modelos de teléfono (`normPhoneModel`),
 * para no tener dos reglas de plegado en el proyecto. Ojo: lo no-alfanumérico se reemplaza por UN
 * ESPACIO (no se borra), así «Cambio pantalla» → `cambio pantalla`.
 */
export const foldWork = (label: string | null | undefined): string => normPhoneModel(label ?? '');

/** Clave plegada de cada trabajo canónico (la «clave canónica» a la que apuntan los alias). */
const CLAVES_CANONICAS = new Set(SERVICE_TYPES.map(t => foldWork(t)).filter(Boolean));

/**
 * EQUIVALENCIAS APROBADAS: clave plegada escrita a mano → clave plegada del trabajo canónico.
 * Solo las que NO admiten duda (el mismo trabajo con otra ortografía o con la palabra al revés). Las
 * dudosas NO están acá a propósito: están en `A_DECIDIR`.
 */
export const WORK_ALIASES: Record<string, string> = {
  // batería
  'bateria': 'cambio bateria',
  'reparacion de batteria': 'cambio bateria',
  // placa (tarjeta lógica)
  'placa': 'reparacion placa',
  'sustitucion de targeta logica': 'reparacion placa',
  // limpieza
  'mantenimiento': 'limpieza mantenimiento',
  // bandeja SIM
  'bandeja sim': 'cambio de bandeja sim',
  // botones
  'boton power': 'reemplazo de botones',
  'boton encendido': 'reemplazo de botones',
  // cámara
  'cristal de camara': 'cambio camara',
  // software
  'correo': 'software formateo',
  'recuperacion de correos': 'software formateo',
};

/**
 * Etiquetas que NO son un trabajo hecho (F59): se ven y se pueden filtrar, pero no se cuentan como
 * trabajo del taller. Tentativo hasta que el dueño confirme.
 */
export const NO_ES_TRABAJO: string[] = ['garantia', 'venta', 'venta de pantalla'];

/**
 * Etiquetas que el taller tiene que DECIDIR (están en la base real, con su cantidad, y no se tocan
 * hasta que el dueño diga a qué trabajo corresponden — o si son un trabajo propio).
 */
export const A_DECIDIR: string[] = [
  'cambio conector puerto',      // 18 equipos: ¿es «Pin de Carga» o un trabajo que se conserva?
  'flex power',                  // 5: ¿es «Cambio flex»?
  'flex main',                   // 1: ¿es «Cambio flex» o «Pin de Carga»?
  'baño quimico',                // 2: ¿es «Limpieza / Mantenimiento»?
  'pila mas bandeja',            // 1: dos trabajos en una etiqueta
  'pegado de pantalla boton',    // 1: dos trabajos en una etiqueta
  'pegado de tapa tracera',      // 1
  'reparacion de marco',         // 1
  'retiro de chip',              // 1
  'revision cornetas',           // 1
  'se mojo',                     // 1
  'sensor',                      // 1
  'cable',                       // 1
  'carcasa',                     // 1
  'fps',                         // 1
  'falla de pantalla arreglada', // 1
  'devolucion por faltante',     // 1
  'relacion a reinicio',         // 1
  'tubo de bocina',              // 1
];

/** ¿La etiqueta (plegada o cruda) está en la tabla de equivalencias? */
export const esAlias = (clave: string): boolean => Object.prototype.hasOwnProperty.call(WORK_ALIASES, clave);

/** Clave CANÓNICA de una clave plegada: la de su alias aprobado, o ella misma. */
export function canonicalWorkKey(clave: string): string {
  return WORK_ALIASES[clave] ?? clave;
}

/** ¿Es una etiqueta que no cuenta como trabajo hecho (garantía / venta)? */
export const esNoTrabajo = (clave: string): boolean => NO_ES_TRABAJO.includes(clave);

/** ¿Quedó pendiente de decisión? (para el reporte de auditoría) */
export const esADecidir = (clave: string): boolean => A_DECIDIR.includes(clave);

/** ¿Es una clave de la lista canónica del formulario? */
export const esCanonica = (clave: string): boolean => CLAVES_CANONICAS.has(canonicalWorkKey(clave));

/** Etiqueta canónica tal como se escribe en el formulario («Cambio batería»), si existe. */
export function canonicalWorkLabel(label: string): { label: string; cambiado: boolean } {
  const clave = canonicalWorkKey(foldWork(label));
  const canonica = SERVICE_TYPES.find(t => foldWork(t) === clave);
  if (!canonica) return { label: label.trim(), cambiado: false };
  return { label: canonica, cambiado: foldWork(label) !== clave };
}
