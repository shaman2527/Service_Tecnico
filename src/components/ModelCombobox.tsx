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
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);

  // sincroniza SOLO cuando el valor viene de afuera (selección previa, orden en
  // edición): con el campo enfocado manda lo que el operario escribe.
  useEffect(() => {
    if (!focused.current) setQuery(value);
  }, [value]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.getPhoneModels(query, 60)
        .then(list => { if (alive) setOptions(list); })
        .catch(() => { if (alive) setOptions([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const exact = useMemo(
    () => options.find(o => normPhoneModel(o.label) === normPhoneModel(query)),
    [options, query],
  );

  const pick = (label: string, phone?: PhoneModelRow) => {
    setQuery(label);
    onChange(label, phone);
    setOpen(false);
    inputRef.current?.focus();
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
          onFocus={() => { focused.current = true; setOpen(true); }}
          onBlur={() => { focused.current = false; }}
          onChange={e => {
            const text = e.target.value;
            setQuery(text);
            setOpen(true);
            // el padre recibe SIEMPRE lo escrito (el modelo del equipo es el real)
            if (allowFreeText) onChange(text);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && exact) {
              e.preventDefault();
              pick(exact.label, exact);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <ChevronsUpDown
          className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground cursor-pointer"
          onClick={() => { setOpen(o => !o); inputRef.current?.focus(); }}
        />
      </div>

      {/* qué modelo va a quedar guardado en el equipo (sin repuestos ni stock:
          el stock se elige después, en "Pantalla a instalar") */}
      {query.trim().length > 0 && !exact && (
        <p className="text-[11px] text-muted-foreground">
          Modelo: <span className="font-medium text-foreground">{query.trim()}</span>{' '}
          <span className="text-warning">(no está en la lista — se guarda tal cual)</span>
        </p>
      )}

      {open && (
        <div className="absolute top-full z-50 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Buscando…
            </div>
          )}
          {!loading && options.length === 0 && (
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
          {!loading && options.map(o => {
            const active = normPhoneModel(o.label) === normPhoneModel(query);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => pick(o.label, o)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                  active && 'bg-accent',
                )}
              >
                <Check className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-transparent')} />
                <span className="truncate">{o.label}</span>
                {/* la marca aparte: el nombre comercial del padrón no la repite («110» = Nokia 110) */}
                {o.brand && !normPhoneModel(o.label).startsWith(normPhoneModel(o.brand)) && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">{o.brand}</span>
                )}
              </button>
            );
          })}
          {!loading && options.length > 0 && allowFreeText && query.trim() && !exact && (
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
