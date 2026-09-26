// F33 — FICHA DE INGRESO: el asistente de recepción (módulo PURO, sin React).
//
// Pedido del usuario (2026-09-17): el aviso flotante al registrar «se siente invasivo… no me deja
// ver lo que estoy registrando». Pidió un asistente estilo POS que muestre SIEMPRE un resumen de la
// ficha en curso (con cada dato en «valor» o «Pendiente») y que pida UN dato por vez, con el nombre
// técnico y una guía corta — trabajando con los campos que la app YA tiene.
//
// Este módulo arma esa ficha: los cuatro bloques del mostrador (cliente · ficha técnica del
// dispositivo · diagnóstico y recepción · condiciones comerciales), cada dato con su estado, su
// paso del formulario (para poder «corregir» saltando ahí sin perder lo demás) y el FORMATO
// esperado. También dice cuál es el dato que toca pedir AHORA.
//
// NO bloquea nada por su cuenta: `required` marca los mismos datos que el wizard ya exige para
// guardar (`falta`), y lo demás es «pendiente» (aviso) — la política del local nunca bloquea.

export type FichaState = 'ok' | 'falta' | 'pendiente';

export interface FichaField {
  key: string;
  /** nombre técnico profesional (lo que el asistente pide) */
  label: string;
  /** qué ingresar, en una línea */
  guide: string;
  /** valor actual tal como se muestra; null = todavía no está */
  value: string | null;
  state: FichaState;
  /** true = sin esto el wizard no deja avanzar/guardar (el pie del paso lo dice igual) */
  required: boolean;
  /** paso del formulario donde se carga (para «corregir» sin borrar el resto); -1 = no está en el wizard */
  step: number;
  /** aviso de FORMATO (no bloquea): se muestra junto al dato para corregirlo a tiempo */
  warn?: string;
}

export interface FichaGroup {
  title: string;
  fields: FichaField[];
}

export interface Ficha {
  groups: FichaGroup[];
  done: number;
  total: number;
  /** el dato que el asistente pide AHORA (el primero que falta; si no hay, el primero pendiente) */
  next: FichaField | null;
  /** datos cargados con formato dudoso: «revisá: Cédula · Teléfono» */
  warns: FichaField[];
  /**
   * F48 — OBSERVACIONES que NO bloquean: datos que conviene completar y que la ficha dice con todas
   * las letras («Falta el número de teléfono del cliente»). Pedido del dueño: «cuando está agregando
   * un servicio hacerle una observación pero no bloqueante: falta número de tlf del cliente… que sea
   * intuitivo, lo vaya llevando de la mano». No entran en `falta` ni en `completa`: el guardado sigue.
   */
  notas: FichaNota[];
  /** true = no falta ninguno de los que bloquean */
  completa: boolean;
}

export interface FichaNota {
  /** clave del dato al que lleva el aviso (para «Ir al campo») */
  key: string;
  /** la observación, tal como se lee en pantalla */
  texto: string;
  /** qué gana el taller completándola (una línea) */
  guia: string;
  step: number;
}

export interface FichaInput {
  mode: 'crear' | 'editar';
  client: string;
  clientCi: string;
  /** la cédula es obligatoria (cliente nuevo) */
  needCi: boolean;
  phone: string;
  clientAddress: string;
  model: string;
  color: string;
  /** blindaje del equipo (JSON ya parseado) */
  checklist: Record<string, string>;
  serviceTypes: string[];
  fault: string;
  /** el monto a cobrar (ya con el descuento aplicado) */
  amount: number;
  /** ¿TODOS los equipos tienen monto? (multi-equipo) — por defecto `amount > 0` */
  amountOk?: boolean;
  payIntent: string | null;
  status: string;
  technician: string;
  photoInAt: string | null;
  /** el trabajo incluye «Cambio pantalla» y hay pantallas en catálogo */
  needsScreen: boolean;
  hasScreenOptions: boolean;
  screenChosen: boolean;
  /**
   * Total de ítems del blindaje del local (`CHECKLIST_ITEMS.length`, hoy 10). Lo pasa la UI para que
   * el contador diga «N de 10» y no «2 de 2»: el denominador viejo era `Object.keys(checklist)`, o
   * sea solo los ítems que ya tenían valor (los 2 que vienen por defecto), así que una orden recién
   * abierta se veía «completa».
   */
  checklistTotal?: number;
  /** cuántos equipos lleva la orden (multi-equipo): la ficha dice de qué equipo son los datos */
  equipos?: number;
}

/** Solo los dígitos de un texto (para validar cédula/teléfono sin pelear con guiones). */
export function onlyDigits(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Formato esperado de la cédula: al menos 6 dígitos (V-12345678). Devuelve el aviso o undefined. */
export function ciWarn(ci: string): string | undefined {
  const d = onlyDigits(ci);
  if (d.length === 0) return undefined;      // vacío = se avisa como «Pendiente», no como error
  if (d.length < 6) return 'Pocos dígitos (ej. V-12345678)';
  return undefined;
}

/** Formato esperado del teléfono: al menos 7 dígitos (0412-1234567). */
export function phoneWarn(phone: string): string | undefined {
  const d = onlyDigits(phone);
  if (d.length === 0) return undefined;
  if (d.length < 7) return 'Revisá el número (ej. 0412-1234567)';
  return undefined;
}

/**
 * Aviso del monto: SOLO cuando es incoherente (multi-equipo con un equipo sin monto). Un total en 0
 * no es un error — es una orden sin cobro (garantía/cortesía) o un monto que todavía no se escribió:
 * en los dos casos la ficha lo muestra como «Pendiente» y el paso del wizard lo pide al avanzar.
 */
export function amountWarn(amount: number, amountOk: boolean): string | undefined {
  if (amountOk || amount <= 0) return undefined;
  return 'Falta el monto de algún equipo';
}

/** Valor legible de un ítem del blindaje: 'Sí' | 'No' | null (sin marcar). */
function checklistValue(cl: Record<string, string>, key: string): string | null {
  const v = cl[key];
  return v === 'si' ? 'Sí' : v === 'no' ? 'No' : null;
}

/** Cuántos ítems del blindaje están MÁS ALLÁ de los que vienen por defecto. */
export function inspeccionCount(cl: Record<string, string>, defaults: Record<string, string>): number {
  return Object.entries(cl).filter(([k, v]) => (v === 'si' || v === 'no') && defaults[k] !== v).length;
}

function field(
  key: string, label: string, guide: string, value: string | null, required: boolean, step: number,
  warn?: string,
): FichaField {
  return {
    key, label, guide, value, required, step, warn,
    state: value !== null && value !== '' ? 'ok' : required ? 'falta' : 'pendiente',
  };
}

/**
 * Construye la ficha de ingreso. Determinista: mismas entradas → mismas salidas.
 * Los datos que el wizard exige bloquean (`falta`); el resto se pide como recomendación.
 */
/** Total de ítems del blindaje cuando la UI no lo pasa (coincide con `CHECKLIST_ITEMS.length`). */
export const CHECKLIST_TOTAL = 10;

export function buildFicha(i: FichaInput): Ficha {
  const crear = i.mode === 'crear';
  const montoOk = i.amountOk ?? i.amount > 0;
  const checklistTotal = i.checklistTotal ?? CHECKLIST_TOTAL;
  // Multi-equipo: los datos POR EQUIPO (clave, accesorios, inspección) se dicen como del equipo 1
  // —el resto se carga en el paso Equipos— en vez de mostrarlos como si fueran de toda la orden.
  const multi = (i.equipos ?? 1) > 1;
  const eq1 = multi ? ` El equipo 1 de ${i.equipos}.` : '';
  const accesorios = ['chip_sim', 'bandeja_sim', 'accesorios']
    .map(k => {
      const v = checklistValue(i.checklist, k);
      if (v === null) return null;
      const nombre = k === 'chip_sim' ? 'Chip' : k === 'bandeja_sim' ? 'Bandeja SIM' : 'Forro';
      return `${nombre}: ${v}`;
    })
    .filter(Boolean)
    .join(' · ') || null;
  const revisados = Object.values(i.checklist).filter(v => v === 'si' || v === 'no').length;

  const cliente: FichaField[] = [
    field('client', 'Cliente / Razón Social', 'Nombre y apellido de quien deja el equipo.',
      i.client.trim() || null, true, 0),
    field('client_ci', 'Doc. de identificación (CI/RIF)',
      i.needCi ? 'V-12345678 — obligatoria para el cliente nuevo.' : 'V-12345678 (opcional si el cliente ya está registrado).',
      i.clientCi.trim() || null, i.needCi, 0, ciWarn(i.clientCi)),
    field('phone', 'Teléfono de contacto', '0412-1234567 — por ahí se le avisa que está listo.',
      i.phone.trim() || null, false, 0, phoneWarn(i.phone)),
    field('client_address', 'Dirección', 'Domicilio del cliente (opcional).',
      i.clientAddress.trim() || null, false, 0),
  ];

  const tecnica: FichaField[] = [
    field('model', 'Marca y modelo exacto', 'Como lo dice el equipo (ej. Samsung Galaxy A15).',
      i.model.trim() || null, true, 1),
    // F48 (pedido del dueño, 2026-09-20): «en los colores que sea un campo requerido; si no selecciono
    // un color lo salte de una vez a que elija un color». El color dejó de ser opcional: la ficha lo
    // marca como FALTA y —como es el dato que toca— el asistente lleva al selector con un toque.
    field('color', 'Color / acabado', 'Tocá «Color del equipo» y elegí uno (ej. Negro, Azul, Lila).',
      i.color.trim() || null, true, 1),
    field('contrasena', 'Clave / patrón de desbloqueo', `¿El cliente entregó la clave? Se marca en Blindaje.${eq1}`,
      checklistValue(i.checklist, 'contrasena'), false, 2),
    field('accesorios', 'Inventario de accesorios recibidos', `Qué entra con el equipo: chip, forro, bandeja SIM.${eq1}`,
      accesorios, false, 2),
  ];
  if (i.needsScreen && i.hasScreenOptions) {
    // La pantalla exacta BLOQUEA el guardado (sin ella el inventario bajaría del repuesto equivocado
    // o no bajaría): por eso es `required`, como el modelo y el trabajo.
    tecnica.push(field('screen', 'Pantalla a instalar (repuesto exacto)',
      'Elegí la ficha del catálogo: es la que descuenta el inventario.',
      i.screenChosen ? 'Elegida' : null, true, 1));
  }

  const diagnostico: FichaField[] = [
    field('service_types', 'Tipo de servicio solicitado', 'Elegí todos los trabajos que se le van a hacer.',
      i.serviceTypes.length > 0 ? i.serviceTypes.join(' + ') : null, true, 1),
    field('fault', 'Sintomatología / falla reportada', 'Lo que dice el cliente, en sus palabras.',
      i.fault.trim() || null, false, 1),
    field('inspeccion', 'Inspección física (blindaje)', `Revisá el equipo delante del cliente: botones, cámara, puerto.${eq1}`,
      revisados > 0 ? `${revisados} de ${checklistTotal} ítems revisados${multi ? ' (equipo 1)' : ''}` : null, false, 2),
    // Política del local: se recuerda, NUNCA bloquea.
    field('photo_in', 'Foto de ENTRADA del equipo', 'Política: se le toma foto al teléfono al recibirlo.',
      i.photoInAt ? 'Tomada' : null, false, 2),
  ];

  const comercial: FichaField[] = [
    field('amount', 'Presupuesto estimado ($)', 'Monto del trabajo (puede ser estimado al recibir).',
      i.amount > 0 ? `$${i.amount.toFixed(2)}` : null, false, 1, amountWarn(i.amount, montoOk)),
    field('pay_intent', 'Pago acordado con el cliente', 'Preguntale si paga ahora o al retirar el equipo.',
      i.payIntent === 'ahora' ? 'Paga ahora' : i.payIntent === 'al_retirar' ? 'Paga al retirar' : null,
      // F77b: la pregunta del pago se hace en el paso del EQUIPO (1), antes de cargar el modelo — con
      // el cliente enfrente y al lado del método de pago, el monto y el repuesto. Antes vivía en el
      // último paso (3), o sea después de cargar todo el equipo.
      false, 1),
    field('status', 'Estado de ingreso', crear ? 'Normalmente «Recibido».' : 'Estado actual del equipo.',
      i.status.trim() || null, false, 3),
    field('technician', 'Técnico responsable', 'Quién lo va a reparar (se puede asignar después).',
      i.technician.trim() || null, false, 0),
  ];

  const groups: FichaGroup[] = [
    { title: 'Datos del cliente', fields: cliente },
    { title: 'Ficha técnica del dispositivo', fields: tecnica },
    { title: 'Diagnóstico y recepción', fields: diagnostico },
    { title: 'Condiciones comerciales', fields: comercial },
  ];

  const all = groups.flatMap(g => g.fields);
  const done = all.filter(f => f.state === 'ok').length;
  const faltan = all.filter(f => f.state === 'falta');
  const pendientes = all.filter(f => f.state === 'pendiente');
  const warns = all.filter(f => !!f.warn);

  // F48 — lo que se observa SIN bloquear (el dueño pidió que el teléfono se pida como observación):
  // son datos que el taller necesita después (avisar que el equipo está listo) y que no impiden
  // guardar la orden. Se listan solo los que faltan.
  const notas: FichaNota[] = [];
  if (!i.phone.trim()) {
    notas.push({
      key: 'phone',
      texto: 'Falta el número de teléfono del cliente',
      guia: 'Es por donde se le avisa que el equipo está listo (se puede guardar igual).',
      step: 0,
    });
  }
  if (!i.technician.trim()) {
    notas.push({
      key: 'technician',
      texto: 'El equipo todavía no tiene técnico asignado',
      guia: 'Se puede asignar después con un clic en la tarjeta de la orden.',
      step: 0,
    });
  }

  return {
    groups,
    done,
    total: all.length,
    next: faltan[0] ?? pendientes[0] ?? null,
    warns,
    notas,
    completa: faltan.length === 0,
  };
}
