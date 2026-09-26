import { useCallback, useEffect, useState } from 'react';
import { Banknote, Camera, Check, Clock, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { closePolicyModal, policyModalQueue, subscribePolicyModal, type PendingPolicy } from './policy-queue';

// F46 — RECORDATORIO DE POLÍTICA como MODAL CENTRADO (pedido del dueño, 2026-09-20):
// «el mensaje trata que sea centro de la pantalla, que la tenga que marcar como que sí tomó la foto
// también del teléfono, estilo modal bloqueante, colores suaves».
//
// Qué cambia respecto de F32 (tarjeta flotante de sonner):
//   · el aviso sale **centrado en la pantalla** con un velo suave detrás (`data-policy-overlay`), así
//     el operario NO lo puede ignorar por distracción: tiene que responder;
//   · la respuesta se da con UN toque — «Ya le tomé la foto» (marca la foto en la orden),
//     «Paga ahora» / «Paga al retirar» — y el botón **«Después»** cierra sin anotar nada (el aviso
//     vuelve la próxima vez que corresponda: no se pierde, pero tampoco se fuerza una respuesta);
//   · **colores suaves** por tono: entrada = celeste, salida = verde, pago = ámbar, política = naranja
//     (tinte claro + borde suave + botón del tono, nunca saturado);
//   · **NO bloquea el trabajo hecho**: el aviso sale DESPUÉS de que el dato ya está guardado (la
//     orden, la entrega o el comprobante no dependen de responderlo) — bloquea la PANTALLA, no el
//     flujo. Escape también cierra.
//
// La lógica de CUÁNDO corresponde cada aviso sigue en `src/lib/reminders.ts` (módulo puro, probado) y
// la COLA (quién está pendiente, dedupe por aviso+orden) vive en `./policy-queue.ts`: acá está solo
// cómo se ve y en qué orden se atienden.
//
// F54 — EL AVISO NO TAPA LA FACTURA NI SE TRAGA LOS CLICS (pedido del dueño, 2026-09-20):
// «al finalizar el mensaje que sale de tlf y otro mensaje no me deja ver la factura la orden; le doy
// clic al mensaje y no se quita». Tres arreglos, todos chicos y verificables:
//   1. **Nunca se dibuja encima de un diálogo abierto** (la factura, el asistente de cierre, el
//      formulario): si hay un `[role="dialog"]` a la vista, el aviso ESPERA en la cola y sale apenas
//      el diálogo se cierra. Antes el velo tapaba la factura y el primer clic lo comía el velo (el
//      operario tenía que tocar dos veces y no entendía por qué).
//   2. **Un toque en cualquier parte del aviso lo cierra** (la tarjeta entera, no solo «Después») y
//      hay una ✕ visible. Es lo que el mostrador espera de un cartel.
//   3. El velo queda **por debajo de los diálogos** de la app (`z-40` vs `z-50`): red de seguridad
//      para el frame en el que las dos cosas coincidan.
// La respuesta de fondo no cambia: sigue siendo un modal centrado que hay que atender, y «Después»
// (= tocar la tarjeta o la ✕) lo deja pendiente para la próxima vez.
//
// F77 — EL CARTEL SE LEE DE LEJOS (pedido del dueño, 2026-09-25): «si le doy clic a imprimir salga el
// mensaje que tenemos, o algo más en grande que diga *Toma la foto al teléfono*… y el mensaje del
// modal que pregunta si va a pagar ahora o al retirar que sea más grande». El título pasó de un rótulo
// de 11 px a `text-xl font-black uppercase` y el mensaje de 14 px a 18 px, con la tarjeta más ancha
// (30 rem) y los botones más altos: es un cartel de mostrador, y el operario lo lee con el cliente
// enfrente. Los TEXTOS viven en `src/lib/reminders.ts` (el título es la orden corta: «Toma la foto al
// teléfono» / «Toma la foto al entregar» / «Pregúntale al cliente»). NADA de la lógica cambia: la cola,
// el dedupe, el tinte por tono, el toque que cierra y el z-40 por debajo de los diálogos quedan igual.

const TONOS = {
  entrada: {
    icon: Camera,
    card: 'border-sky-200 bg-sky-50',
    circle: 'bg-sky-100 text-sky-700',
    titulo: 'text-sky-800',
    boton: 'bg-sky-600 text-white hover:bg-sky-700',
  },
  salida: {
    icon: Camera,
    card: 'border-emerald-200 bg-emerald-50',
    circle: 'bg-emerald-100 text-emerald-700',
    titulo: 'text-emerald-800',
    boton: 'bg-emerald-600 text-white hover:bg-emerald-700',
  },
  pago: {
    icon: Banknote,
    card: 'border-amber-200 bg-amber-50',
    circle: 'bg-amber-100 text-amber-800',
    titulo: 'text-amber-900',
    boton: 'bg-amber-500 text-white hover:bg-amber-600',
  },
  politica: {
    icon: ShieldCheck,
    card: 'border-orange-200 bg-orange-50',
    circle: 'bg-orange-100 text-orange-700',
    titulo: 'text-orange-900',
    boton: 'bg-orange-500 text-white hover:bg-orange-600',
  },
} as const;

/** El host: se monta UNA vez (en Servicio Técnico) y muestra el primer aviso de la cola. */
export function PolicyModalHost() {
  const [pendientes, setPendientes] = useState<readonly PendingPolicy[]>(policyModalQueue());
  useEffect(() => {
    const f = () => setPendientes([...policyModalQueue()]);
    const baja = subscribePolicyModal(f);
    f();
    return baja;
  }, []);

  // F54 (1) — ¿hay un diálogo abierto (factura, asistente de cierre, formulario)? Mientras haya uno,
  // el aviso NO se dibuja: el velo tapaba la factura y el primer clic sobre la app lo comía el velo.
  // Se observa el DOM (los diálogos de Radix se montan/desmontan por portal, no hay estado React que
  // consultar desde acá) y se re-evalúa al abrir y cerrar cada uno.
  const [hayDialogo, setHayDialogo] = useState(false);
  useEffect(() => {
    const mirar = () => setHayDialogo(!!document.querySelector('[role="dialog"]'));
    mirar();
    const obs = new MutationObserver(mirar);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const actual = pendientes[0];
  const cerrar = useCallback(() => { if (actual) closePolicyModal(actual.id); }, [actual]);

  // Escape cierra (accesibilidad: un modal sin salida por teclado encierra al operario), PERO solo si
  // no hay otro diálogo abierto: si el comprobante o el asistente de cierre están encima, el Escape
  // es para ellos (si no, un solo Escape cerraría las dos cosas y el aviso desaparecería sin
  // respuesta — que es justo lo que el dueño quiere evitar).
  useEffect(() => {
    if (!actual) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      cerrar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actual, cerrar]);

  // F54 (1): con un diálogo a la vista el aviso queda EN LA COLA (no se pierde: sale al cerrarlo).
  if (!actual || hayDialogo) return null;
  const { reminder } = actual;
  const tono = TONOS[reminder.tone];
  const Icono = tono.icon;
  const [primera, ...resto] = reminder.actions;

  return (
    <div
      data-policy-overlay
      role="presentation"
      // Velo suave (no negro duro). F54: z-40, POR DEBAJO de los diálogos de la app (z-50) — el aviso
      // nunca puede tapar la factura ni comerse un clic destinado a ella.
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
      onMouseDown={e => { if (e.target === e.currentTarget) cerrar(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`policy-title-${reminder.key}`}
        data-policy-modal
        data-reminder={reminder.key}
        data-tone={reminder.tone}
        // F54 (2): UN TOQUE EN CUALQUIER PARTE DE LA TARJETA lo cierra (= «Después»: la respuesta
        // no se anota y el aviso vuelve cuando corresponda). Los botones hacen lo suyo y no se pisan.
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('button')) return;
          cerrar();
        }}
        title="Tocá el aviso para cerrarlo"
        // F77 — EL AVISO SE LEE DE LEJOS (pedido del dueño): la tarjeta es más ancha y el texto va en
        // cuerpo grande. Es un cartel de mostrador, no una nota al pie.
        className={cn('relative w-[min(94vw,30rem)] cursor-pointer rounded-2xl border p-6 shadow-xl', tono.card)}
      >
        {/* ✕ visible: el «se quita con un toque» tiene que VERSE, no adivinarse */}
        <button
          type="button"
          data-policy-close
          aria-label="Cerrar el aviso"
          title="Cerrar el aviso"
          onClick={cerrar}
          className={cn('absolute right-2.5 top-2.5 rounded-full p-1.5 transition-colors hover:bg-black/5', tono.titulo)}
        >
          <X className="size-5" />
        </button>
        <div className="flex items-start gap-3.5">
          <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-full', tono.circle)}>
            <Icono className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            {/* F77 — la línea MÁS GRANDE es la orden («Toma la foto al teléfono» / «Pregúntale al
                cliente»): antes era un rótulo de 11 px y el operario tenía que acercarse a leer. */}
            <p id={`policy-title-${reminder.key}`} data-policy-title
              className={cn('text-xl font-black uppercase leading-tight tracking-tight', tono.titulo)}>
              {reminder.title}
            </p>
            <p data-policy-message className="mt-1.5 text-lg font-medium leading-snug text-foreground">{reminder.message}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-9 px-3 text-xs text-muted-foreground" onClick={cerrar} data-policy-later>
            <Clock className="size-3.5" /> Después
          </Button>
          {resto.map(a => (
            <Button key={a.id} variant="outline" size="sm" className="h-10 border-border bg-background/70 px-4 text-sm"
              onClick={() => { closePolicyModal(actual.id); actual.onAction(a.id); }}>
              {a.label}
            </Button>
          ))}
          <Button size="sm" autoFocus data-policy-primary
            className={cn('h-10 gap-1.5 px-4 text-sm shadow-sm', tono.boton)}
            onClick={() => { closePolicyModal(actual.id); actual.onAction(primera.id); }}>
            <Check className="size-4" /> {primera.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
