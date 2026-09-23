import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search, Smartphone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '@/db';
import type { PhoneModelRow } from '@/types';
import { cn, normPhoneModel } from '@/lib/utils';

// Selector de MODELO DE TELÉFONO con la lista canónica del padrón (`phones`):
// nombre real (Galaxy/Moto/iPhone/Redmi), cuántas pantallas le sirven y stock.
//
// FIX 2026-09-15: el texto que escribe el operario SIEMPRE se ve.
//   - `query` manda mientras el campo tiene foco (el valor del padre no lo pisa).
//   - el input fuerza `text-foreground` para que ningún estilo del padre lo lave.
//   - debajo se muestra el modelo que va a quedar guardado (o el aviso de que no
//     está en el padrón), así nunca hay duda de qué se escribió.
export function ModelCombobox({ value, onChange, placeholder = 'Busca el modelo (ej: Redmi Note 11)', autoFocus, allowFreeText = true }: {
  value: string;
  onChange: (model: string, phone?: PhoneModelRow) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** permite escribir un modelo que no está en el padrón */
  allowFreeText?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<PhoneModelRow[]>([]);
  /** para qué texto son las `options` que tenemos (null = todavía no se consultó nada) */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** F50: con qué alcance se cargaron las opciones («ver todos» o solo lo que usa). */
  const [loadedInUse, setLoadedInUse] = useState<boolean | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  /**
   * F66b — «al elegir el modelo, el desplegable se cierra».
   *
   * Bug medido (reporte del dueño: «selecciono el modelo y se cierra el desplegable, no tenga que
   * darle dos veces al modelo para cerrarlo»): `pick()` cerraba la lista y **volvía a enfocar el
   * input** para que el operario siga escribiendo; ese `focus()` dispara `onFocus`, que hace
   * `setOpen(true)`, así que el desplegable **se reabría en el acto** y había que clickear afuera
   * (o el mismo modelo otra vez) para cerrarlo. Ahora el foco programático se marca para que
   * `onFocus` NO reabra: el foco se mantiene (el operario puede seguir tipeando) y la lista queda
   * cerrada hasta que él la pida (foco nuevo, clic en el campo o en el chevron).
   */
  const focusSinReabrir = useRef(false);
  const volverAlCampo = () => {
    focusSinReabrir.current = true;
    inputRef.current?.focus();          // el `onFocus` corre sincrónico y ve la marca
    setTimeout(() => { focusSinReabrir.current = false; }, 0);
  };

  // sincroniza SOLO cuando el valor viene de afuera (selección previa, orden en
  // edición): con el campo enfocado manda lo que el operario escribe.
  useEffect(() => {
    if (!focused.current) setQuery(value);
  }, [value]);

  // CONSULTAR SÓLO CUANDO SE USA (feature 41). Antes el combobox pedía la lista del padrón al
  // MONTARSE — 230 a 300 ms medidos — aunque nadie hubiera escrito nada; la pestaña «Repuesto
  // por modelo» lo monta al abrirse, así que esa consulta se pagaba siempre y no servía para
  // nada (tampoco en el asistente de servicio, donde el campo arranca vacío). Ahora consulta
  // cuando el campo tiene el foco o cuando ya hay un modelo escrito.
  // F50 — «SOLO LO QUE USO» (pedido del dueño: «él no lo usa todo… que le aparezcan los modelos que
  // usa, así es más rápida la búsqueda»). El padrón marca los modelos con un check y acá se ofrece
  // SOLO eso; el interruptor «Ver todos» trae el catálogo completo para el modelo raro. Se recuerda
  // la elección (el operario que trabaja con todo no tiene que pelearse con el filtro cada vez).
  const [verTodos, setVerTodos] = useState(() => localStorage.getItem('modelos_ver_todos') === '1');
  const wanted = open || value.trim() !== '';
  useEffect(() => {
    // El desplegable ya NO se gatea con un `loading` de estado: se pinta según `optionsForQuery`
    // (¿las opciones son de ESTE texto?). Ese estado se podía quedar trabado en true si el efecto
    // anterior se abortaba (escribir y borrar dentro de los 180 ms del rebote: su `finally` no
    // bajaba `loading` porque `alive` ya era false) y el desplegable quedaba en «Buscando…» para
    // siempre — bloqueante de la revisión adversarial. Ahora no hace falta ningún estado extra.
    if (!wanted || (loadedFor === query && loadedInUse === verTodos)) return;
    let alive = true;
    const t = setTimeout(() => {
      api.getPhoneModelsInUse(query, 60, !verTodos)
        .then(list => { if (!alive) return; setOptions(list); setLoadedFor(query); setLoadedInUse(verTodos); })
        .catch(() => { if (!alive) return; setOptions([]); setLoadedFor(query); setLoadedInUse(verTodos); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [query, wanted, loadedFor, loadedInUse, verTodos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // «exacto» sólo vale para las opciones de ESTE texto: con las de una consulta anterior
  // (o sin haber consultado) no se puede afirmar nada — de ahí el aviso falso de «no está
  // en la lista» que tenía la versión que consultaba siempre.
  const optionsForQuery = loadedFor === query && loadedInUse === verTodos;
  const exact = useMemo(
    () => (optionsForQuery ? options.find(o => normPhoneModel(o.label) === normPhoneModel(query)) : undefined),
    [options, query, optionsForQuery],
  );

  const pick = (label: string, phone?: PhoneModelRow) => {
    setQuery(label);
    onChange(label, phone);
    setOpen(false);
    // El foco vuelve al campo SIN reabrir la lista (ver `focusSinReabrir`): antes este `focus()`
    // reabría el desplegable y parecía que la elección no se había cerrado.
    volverAlCampo();
  };

  return (
    <div ref={boxRef} className="relative flex flex-col gap-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="pl-9 pr-9 text-foreground"
          onFocus={() => { focused.current = true; if (!focusSinReabrir.current) setOpen(true); }}
          // F66b: el clic en el campo SIEMPRE muestra la lista. Hace falta porque después de elegir un
          // modelo el campo queda con el foco (para seguir tipeando) y el clic en un input ya enfocado
          // NO dispara `focus`: sin esto, volver a ver la lista obligaba a escribir o al chevron.
          onClick={() => setOpen(true)}
          onBlur={() => { focused.current = false; }}
          onChange={e => {
            const text = e.target.value;
            setQuery(text);
            setOpen(true);
            // el padre recibe SIEMPRE lo escrito (el modelo del equipo es el real)
            if (allowFreeText) onChange(text);
          }}
          onKeyDown={e => {
            // El combobox es DUEÑO del Enter: confirma lo que se escribió (el texto ya se comitea por
            // tecla) y no lo deja burbujear. Antes, sin coincidencia exacta el Enter seguía subiendo
            // y en el wizard de recepción hacía AVANZAR de paso sin querer.
            if (e.key === 'Enter') {
              e.preventDefault();
              if (exact) pick(exact.label, exact);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <ChevronsUpDown
          className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground cursor-pointer"
          onClick={() => {
            // El chevron ABRE y CIERRA de verdad: se fija el estado que quiere el operario y el foco
            // vuelve al campo sin que `onFocus` lo pise (mismo cuidado que en `pick`).
            setOpen(!open);
            volverAlCampo();
          }}
        />
      </div>

      {/* qué modelo va a quedar guardado en el equipo (sin repuestos ni stock:
          el stock se elige después, en "Pantalla a instalar") */}
      {query.trim().length > 0 && optionsForQuery && !exact && (
        <p className="text-[11px] text-muted-foreground">
          Modelo: <span className="font-medium text-foreground">{query.trim()}</span>{' '}
          <span className="text-warning">(no está en la lista — se guarda tal cual)</span>
        </p>
      )}

      {open && (
        // F60: el desplegable puede ser MÁS ANCHO que el campo (en el formulario el campo ocupa media
        // pantalla): sin ese mínimo, los nombres largos («Redmi Note 11 Pro+ 5G») no entraban en un
        // renglón y había que adivinar cuál se estaba eligiendo.
        <div className="absolute top-full z-50 mt-1 w-full min-w-[22rem] max-w-[92vw] max-h-72 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {/* F50 — el interruptor que trae TODO el catálogo. Va arriba, es un botón (no un check de
              Radix) y deja claro qué está mostrando. */}
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 pb-1.5 pt-1">
            <span className="text-[11px] text-muted-foreground" data-model-scope>
              {verTodos ? 'Mostrando TODO el catálogo' : 'Mostrando solo los modelos que usás'}
            </span>
            <button
              type="button"
              data-model-all={verTodos ? '1' : '0'}
              onClick={() => {
                const n = !verTodos;
                setVerTodos(n);
                localStorage.setItem('modelos_ver_todos', n ? '1' : '0');
                setLoadedFor(null);
                volverAlCampo();   // la lista SIGUE abierta (no se cambia `open`)
              }}
              className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {verTodos ? 'Ver solo lo que uso' : 'Ver todos'}
            </button>
          </div>
          {/* El desplegable se pinta según `optionsForQuery` (¿las opciones son de ESTE texto?),
              no según `loading`: si se gateaba con `loading`, un `loading` trabado dejaba el
              cuadro en «Buscando…» sin lista (bloqueante de la revisión adversarial). */}
          {!optionsForQuery && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Buscando…
            </div>
          )}
          {optionsForQuery && options.length === 0 && (
            <div className="flex flex-col gap-1 px-3 py-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Smartphone className="size-3.5" /> Ningún modelo del padrón coincide.
              </span>
              {allowFreeText && query.trim() && (
                <button type="button" className="text-left text-primary hover:underline" onClick={() => pick(query.trim())}>
                  Usar «{query.trim()}» igual
                </button>
              )}
            </div>
          )}
          {optionsForQuery && options.map(o => {
            const active = normPhoneModel(o.label) === normPhoneModel(query);
            const marca = o.brand && !normPhoneModel(o.label).startsWith(normPhoneModel(o.brand)) ? o.brand : '';
            const repuestos = o.screens > 0
              ? `${o.screens} pantalla${o.screens === 1 ? '' : 's'}${o.stock > 0 ? ` · ${o.stock} u.` : ''}`
              : '';
            const sinUsar = (o.in_use ?? 0) !== 1;
            return (
              <button
                key={o.key}
                type="button"
                data-model-option={o.label}
                data-model-in-use={o.in_use ?? 0}
                title={sinUsar
                  ? 'Este modelo está apagado en el padrón (marcalo como «lo uso» en Inventario → Modelos)'
                  : o.label}
                onClick={() => pick(o.label, o)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent',
                  active && 'bg-accent',
                )}
              >
                <Check className={cn('mt-0.5 size-3.5 shrink-0', active ? 'text-primary' : 'text-transparent')} />
                {/* F60 — EL NOMBRE DEL EQUIPO VA PRIMERO Y SE LEE (pedido del dueño, 2026-09-21:
                    «cuando vas a colocar un modelo en servicio no se diferencia bien qué modelo vas a
                    elegir, no se puede leer; debería salir el nombre del equipo»). Antes el nombre
                    compartía UN renglón con la marca, el código, «sin usar» y el stock, y encima con
                    `truncate`: en el campo del formulario (media pantalla de ancho) el nombre quedaba
                    cortado. Ahora el nombre tiene su propio renglón, en negrita y SIN truncar (si hace
                    falta, envuelve), y todo lo demás baja a una segunda línea en letra chica. */}
                <span className="min-w-0 flex-1">
                  <span data-model-label className="block text-sm font-semibold leading-snug text-foreground">
                    {o.label}
                  </span>
                  {[marca, o.code, repuestos, sinUsar ? 'sin usar' : ''].filter(Boolean).length > 0 && (
                    <span data-model-detail className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {[marca, o.code, repuestos, sinUsar ? 'sin usar' : ''].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {optionsForQuery && options.length > 0 && allowFreeText && query.trim() && !exact && (
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-xs text-primary hover:bg-accent"
              onClick={() => pick(query.trim())}
            >
              Usar «{query.trim()}» (modelo fuera del padrón)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Envoltorio con ancho cómodo para usarlo en encabezados. */
export function ModelComboboxInline(props: Parameters<typeof ModelCombobox>[0]) {
  return (
    <div className="w-full max-w-md">
      <ModelCombobox {...props} />
    </div>
  );
}
