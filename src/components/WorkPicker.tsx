import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, ListFilter, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { NO_WORK_FILTER, foldWork, type WorkCount } from '@/lib/service-report';
// F59: qué etiquetas no son un trabajo hecho (garantía / venta) — tabla revisable en su módulo.
import { canonicalWorkLabel, esNoTrabajo } from '@/lib/work-aliases';

// F57 — EL FILTRO DE TRABAJOS DEJA DE SER UN MURO DE CHIPS.
//
// Pedido del dueño (2026-09-21): «no quiere tener todas las categorías, así se ve poco profesional…
// solamente si selecciona un día en específico o si es hoy salgan nada más las categorías, o que esté
// oculta y uno elija una específica. La idea que sea intuitivo, funcional para cualquier operador».
//
// Antes la pantalla dibujaba UN BOTÓN POR ETIQUETA distinta de la lista: en la base real del cliente
// son 49 (16 canónicas + 33 escritas a mano), 24 de ellas con UN solo equipo — un muro de botones que
// empujaba las tarjetas fuera de la pantalla y no dejaba ver nada.
//
// Ahora hay UN SOLO control, del mismo estilo que el buscador de modelos que el operario ya conoce:
//   · cerrado dice QUÉ está filtrado y cuántos equipos son («Todos los trabajos · 603»);
//   · al abrirlo se BUSCA (escribiendo) y se elige UN trabajo, con su cantidad al lado;
//   · los trabajos del local (canónicos) van primero y las etiquetas escritas a mano quedan en su
//     propio grupo, con la explicación de por qué están ahí — así el ruido de datos viejos no compite
//     con el trabajo del día a día;
//   · «Sin trabajo anotado» sigue existiendo (los números cierran: ningún equipo desaparece).
//
// Los enganches de las pruebas se mantienen: cada opción lleva `data-work-chip` (la clave plegada) y
// `data-work-count`, y el botón que abre lleva `data-work-picker` con el filtro activo en
// `data-work-filter`.

export function WorkPicker({ counts, total, sinTrabajo, sinTrabajoEntregados = 0, sinTrabajoTaller = 0, sinTrabajoAnulados = 0, value, onChange }: {
  counts: WorkCount[];
  /** equipos de la lista (lo que cuenta «Todos») */
  total: number;
  /** equipos sin ningún trabajo anotado */
  sinTrabajo: number;
  /** desglose REAL de esos equipos (los números se muestran, no se inventan) */
  sinTrabajoEntregados?: number;
  sinTrabajoTaller?: number;
  sinTrabajoAnulados?: number;
  /** clave plegada del trabajo elegido (`''` = todos · `NO_WORK_FILTER` = sin trabajo) */
  value: string;
  onChange: (clave: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const botonRef = useRef<HTMLButtonElement>(null);
  const elegir = (clave: string) => {
    onChange(clave);
    setOpen(false);
    setQ('');
    // Devolver el foco al botón: si el input del buscador se desmonta con el foco adentro, el foco
    // queda en `body` y el operario de teclado pierde el lugar donde estaba (revisión adversarial).
    botonRef.current?.focus();
  };

  /**
   * Qué dice el botón cerrado. Si el trabajo elegido NO está en los conteos actuales (caso normal:
   * se elige un trabajo y después se acota el período o el estado, y ese trabajo queda sin equipos),
   * se muestra la clave elegida CON CERO — nunca se cae en «Todos los trabajos», que dejaría el
   * filtro invisible y la pantalla diciendo tres números distintos (bloqueante de la revisión).
   */
  const activo = value === NO_WORK_FILTER
    ? { label: 'Sin trabajo anotado', total: sinTrabajo, entregados: sinTrabajoEntregados, taller: sinTrabajoTaller, anulados: sinTrabajoAnulados }
    : counts.find(c => c.key === value) ?? (value ? { label: canonicalWorkLabel(value).label, total: 0 } : undefined);
  const filtroSinEquipos = !!value && (activo?.total ?? 0) === 0;

  const { canonicos, libres, noTrabajo } = useMemo(() => {
    const buscando = foldWork(q);
    const coincide = (c: WorkCount) => !buscando || foldWork(c.label).includes(buscando) || c.key.includes(buscando);
    const visibles = counts.filter(coincide);
    return {
      canonicos: visibles.filter(c => !c.custom && !esNoTrabajo(c.key)),
      libres: visibles.filter(c => c.custom && !esNoTrabajo(c.key)),
      // F59: «garantía» y «VENTA» se anotaron como si fueran trabajos. Se pueden filtrar (el dato
      // existe) pero van aparte y con la aclaración, para que no ensucien la lista del taller.
      noTrabajo: visibles.filter(c => esNoTrabajo(c.key)),
    };
  }, [counts, q]);

  /**
   * Una fila del selector. `entregados`/`taller` son OPCIONALES a propósito: cuando no hay desglose
   * real (una etiqueta que no viene del conteo) NO se dibuja nada — los números no se inventan
   * (bloqueante de la revisión adversarial: «Sin trabajo anotado» mostraba «0 entregados · 0 en taller»).
   */
  const opcion = (c: { key: string; label: string; total: number; entregados?: number; taller?: number; anulados?: number }, clave: string) => (
    <button
      key={clave}
      type="button"
      data-work-chip={clave}
      data-work-count={c.total}
      onClick={() => elegir(clave)}
      title={typeof c.entregados === 'number'
        ? `${c.total} equipos · ${c.entregados} entregados · ${c.taller} en taller${c.anulados ? ` · ${c.anulados} devueltos/cancelados` : ''}`
        : `${c.total} equipos`}
      className={cn(
        'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
        value === clave && 'bg-accent',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{c.label}</span>
      {typeof c.entregados === 'number' && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {c.entregados} entregados · {c.taller} en taller
        </span>
      )}
      <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums">{c.total}</span>
    </button>
  );

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={botonRef}
        type="button"
        data-work-picker
        data-work-filter={value}
        data-work-total={total}
        aria-label="Filtrar por trabajo"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); setQ(''); }}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        title={filtroSinEquipos
          ? 'El trabajo elegido no tiene equipos en la lista que estás viendo — toca para cambiarlo'
          : 'Elegir un trabajo para filtrar la lista'}
        className={cn(
          'flex h-9 min-w-[15rem] max-w-[22rem] items-center gap-2 rounded-md border bg-background px-3 text-sm',
          filtroSinEquipos ? 'border-amber-500/50 text-foreground' : value ? 'border-primary/40 text-foreground' : 'text-muted-foreground',
        )}
      >
        <ListFilter className={cn('size-4 shrink-0', filtroSinEquipos ? 'text-amber-600' : value && 'text-primary')} />
        <span className="min-w-0 flex-1 truncate text-left">
          {activo ? (
            <>
              <span className="font-medium text-foreground">{activo.label}</span>
              <span className={cn('ml-1.5 text-xs font-bold tabular-nums', filtroSinEquipos ? 'text-amber-600' : 'text-primary')}>{activo.total}</span>
            </>
          ) : (
            <>Todos los trabajos <span className="ml-1 text-xs font-bold tabular-nums">{total}</span></>
          )}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full z-50 mt-1 w-[26rem] max-w-[92vw] rounded-lg border border-border bg-popover p-1 shadow-lg"
          data-work-menu>
          <div className="relative p-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); botonRef.current?.focus(); }
                // Flecha abajo entra a la lista de opciones (el operario de teclado no tiene que
                // tabular por 40 filas para llegar a la suya — revisión adversarial).
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const primero = boxRef.current?.querySelector('[data-work-menu] [data-work-chip]');
                  if (primero instanceof HTMLElement) primero.focus();
                }
              }}
              placeholder="Buscar un trabajo (ej: pantalla)…"
              data-work-search
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="max-h-80 overflow-auto p-1">
            {/* «Todos» primero: es el estado normal y tiene que estar a un toque. */}
            <button
              type="button"
              data-work-chip="todos"
              data-work-count={total}
              onClick={() => elegir('')}
              className={cn(
                'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                value === '' && 'bg-accent',
              )}
            >
              <span className="flex-1 font-medium">Todos los trabajos</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums">{total}</span>
            </button>

            {canonicos.length > 0 && (
              <>
                <p className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Trabajos del taller
                </p>
                {canonicos.map(c => opcion(c, c.key))}
              </>
            )}

            {/* Las etiquetas escritas a mano (el texto libre de «Otro») van en su grupo y con su
                explicación: son datos reales del local, pero no son la lista del taller. */}
            {libres.length > 0 && (
              <>
                <p className="px-2 pb-0.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  data-work-group="libres">
                  Anotados a mano · {libres.length}
                </p>
                <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                  Se escribieron en «Otro». Sirven para filtrar, pero no son trabajos de la lista del taller.
                </p>
                {libres.map(c => opcion(c, c.key))}
              </>
            )}

            {/* F59: lo que NO es un trabajo hecho (garantía / venta) tiene su propio grupo. */}
            {noTrabajo.length > 0 && (
              <>
                <p className="px-2 pb-0.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  data-work-group="no-trabajo">
                  No es un trabajo · {noTrabajo.length}
                </p>
                <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                  Garantía o venta anotadas como trabajo: se pueden filtrar, pero no cuentan como trabajo del taller.
                </p>
                {noTrabajo.map(c => opcion(c, c.key))}
              </>
            )}

            {sinTrabajo > 0 && (
              <>
                <p className="px-2 pb-0.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Sin trabajo
                </p>
                {opcion({ key: NO_WORK_FILTER, label: 'Sin trabajo anotado', total: sinTrabajo, entregados: sinTrabajoEntregados, taller: sinTrabajoTaller, anulados: sinTrabajoAnulados }, NO_WORK_FILTER)}
              </>
            )}

            {canonicos.length === 0 && libres.length === 0 && noTrabajo.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">Ningún trabajo coincide con «{q}».</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
