import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Search, Smartphone, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/db';
import { useDataVersion } from '@/lib/use-data-version';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// F91 — LA COMPATIBILIDAD SE EDITA CON LA LISTA DE MODELOS, NO CON TEXTO LIBRE.
//
// Pedido del dueño (2026-10-05): «quiero que sustituyas la compatibilidad de producto [el campo
// «También le sirve a», un solo campo de texto] y me agregues allí los MODELOS-FICHA donde tú estás
// manejando la verdadera compatibilidad de productos… quiero unificar producto y que pueda editar
// (agregar o eliminar los modelos compatibles, CREANDO LA SECCIÓN QUE FALTA). De este modo unificamos
// en un solo lugar las compatibilidades: **dejá inactivo el campo compatibilidades y sustituilo por la
// lista de modelos compatibles**.»
//
// Qué es: los teléfonos que llevan este repuesto se eligen de la MISMA lista (el padrón de Modelos —
// el que alimentan la carga masiva y la ficha del teléfono), con buscador, chip por teléfono y su ✕
// para quitarlo. Si el teléfono NO existe todavía, se puede crear desde acá mismo (el backend crea su
// ficha al guardar: `rebuild_phones` corre en cada alta/edición de producto).
//
// Qué NO cambia (a propósito): el valor guardado sigue siendo el mismo texto (`A / B / C`) que ya
// entienden `normalize_fields`, la reconstrucción del padrón, la ficha del teléfono, el desplegable
// «Pantalla a instalar» del servicio y la carga masiva. Es una forma MEJOR de escribir el mismo dato,
// no un segundo dato: por eso Producto, Modelos, Ficha y Servicio siguen diciendo lo mismo.
//
// Los `data-*` (`data-compat-picker`, `data-compat-chip`, `data-compat-quitar`, `data-compat-buscar`,
// `data-compat-opcion`, `data-compat-crear`) son los ganchos de la verificación en vivo.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** El texto guardado (`A / B / C`) como lista limpia, sin repetidos. */
export const modelosDeCompat = (compat: string): string[] =>
  [...new Set(String(compat ?? '').split('/').map(s => s.trim()).filter(Boolean))];

/**
 * La etiqueta CANÓNICA del teléfono: `Marca Modelo`.
 *
 * Por qué existe (medido): el padrón devuelve el NOMBRE del teléfono en `label` y su marca aparte, y a
 * los Tecno los nombra sin marca («Pop 7», «Spark 10C»). Al guardar, el backend canoniza con la marca
 * (`normalize_fields` → «Tecno Pop 7»), así que sin esto el chip decía «Pop 7» y la ficha guardaba
 * «Tecno Pop 7»: el mismo teléfono escrito de dos formas en la misma pantalla (justo lo que el dueño
 * pidió unificar). Se antepone la marca SOLO si el nombre no la trae ya.
 */
export const etiquetaConMarca = (label: string, brand = ''): string => {
  const t = String(label ?? '').trim();
  const b = String(brand ?? '').trim();
  if (!b || t.toLowerCase().startsWith(`${b.toLowerCase()} `)) return t;
  return `${b} ${t}`;
};

export function CompatModelPicker({ value, onChange, disabled = false, maximaAltura = false, compacto = false }: {
  /** el texto de compatibilidad tal como se guarda («A / B / C») */
  value: string;
  onChange: (compat: string) => void;
  disabled?: boolean;
  /** la lista de chips con su propio scroll (para el diálogo del wizard, que es más bajo) */
  maximaAltura?: boolean;
  /** sin rótulo ni explicación: para cuando el que lo envuelve ya los pone (la revisión del archivo) */
  compacto?: boolean;
}) {
  const [q, setQ] = useState('');
  const [opciones, setOpciones] = useState<{ label: string; brand: string; screens: number; code: string }[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** el padrón cambia con cada alta/edición/carga: el buscador tiene que ver lo nuevo al instante */
  const dataVersion = useDataVersion();

  const modelos = useMemo(() => modelosDeCompat(value), [value]);
  const yaEsta = (label: string) => modelos.some(m => m.toLowerCase() === label.trim().toLowerCase());

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setOpciones([]); setError(null); return; }
    let alive = true;
    setBuscando(true);
    setError(null);
    const t = setTimeout(() => {
      api.getPhoneModelsInUse(s, 8, false)
        .then(rs => {
          if (!alive) return;
          setOpciones((rs ?? [])
            .filter(r => !yaEsta(etiquetaConMarca(r.label, r.brand ?? '')))
            .map(r => ({ label: r.label, brand: r.brand ?? '', screens: r.screens ?? 0, code: r.code ?? '' })));
        })
        .catch((e: unknown) => { if (alive) { setOpciones([]); setError(e instanceof Error ? e.message : String(e)); } })
        .finally(() => { if (alive) setBuscando(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, dataVersion, value]);

  const agregar = (label: string, brand = '') => {
    const t = etiquetaConMarca(label, brand);
    setQ('');
    setOpciones([]);
    if (!t || yaEsta(t)) return;
    onChange([...modelos, t].join(' / '));
  };
  const quitar = (label: string) => onChange(modelos.filter(m => m !== label).join(' / '));

  const texto = q.trim();
  const hayExacto = opciones.some(o => etiquetaConMarca(o.label, o.brand).toLowerCase() === texto.toLowerCase()) || yaEsta(texto);

  return (
    <div className="flex flex-col gap-2" data-compat-picker data-compat-cantidad={modelos.length}>
      {!compacto && (
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Smartphone className="size-3.5 text-muted-foreground" /> Modelos compatibles
          <span className="font-normal text-xs text-muted-foreground">(los teléfonos que llevan este repuesto)</span>
        </label>
      )}
      {!compacto && (
        <p className="text-xs text-muted-foreground">
          Se eligen de la lista de <strong>Modelos</strong> (la misma que ve el servicio y la ficha de cada teléfono), así que
          cargar acá un teléfono lo agrega a su ficha, y quitarlo lo saca. Si el teléfono no está en la lista, escribilo y
          creálo: queda en el padrón al guardar.
        </p>
      )}

      {/* ── los elegidos: un chip por teléfono, con su ✕ ─────────────────────────────────────────── */}
      {modelos.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground"
          data-compat-vacio>
          Sin teléfonos: la ficha no va a aparecer en ninguna ficha de Modelos (solo se busca por su modelo principal).
        </p>
      ) : (
        <div className={cn('flex flex-wrap gap-1', maximaAltura && 'max-h-24 overflow-y-auto')} data-compat-chips>
          {modelos.map(m => (
            <Badge key={m} variant="outline" className="gap-1 pr-1 text-[11px] font-normal" data-compat-chip={m}>
              {m}
              <button type="button" disabled={disabled} onClick={() => quitar(m)}
                data-compat-quitar={m} aria-label={`Quitar ${m} de los modelos compatibles`}
                title={`Quitar «${m}»: deja de aparecer en la ficha de ese teléfono`}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* ── el buscador del padrón ───────────────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
        <Input value={q} disabled={disabled} data-compat-buscar
          aria-label="Buscar un modelo para agregarlo a la compatibilidad"
          placeholder="Buscar un modelo para agregar (ej. Hot 30i, Redmi Note 11)…"
          className="h-9 pl-7"
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (opciones.length > 0) agregar(opciones[0].label, opciones[0].brand);
            else if (texto.length >= 2) agregar(texto);
          }} />
      </div>

      {buscando && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> buscando en Modelos…
        </span>
      )}
      {error && <span className="text-[11px] text-destructive">{error}</span>}

      {opciones.length > 0 && (
        <div className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-border/70" role="listbox"
          aria-label="Modelos encontrados">
          {opciones.map(o => (
            <button key={o.label} type="button" role="option" aria-selected={false}
              data-compat-opcion={etiquetaConMarca(o.label, o.brand)}
              onClick={() => agregar(o.label, o.brand)}
              className="flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent">
              <span className="flex min-w-0 items-center gap-1.5">
                <Plus className="size-3 shrink-0 text-muted-foreground" />
                {/* F91 — la etiqueta con su marca: es EXACTAMENTE lo que se va a guardar («Tecno Pop 7»),
                    así el chip y la ficha no dicen el mismo teléfono de dos formas distintas. */}
                <span className="truncate">{etiquetaConMarca(o.label, o.brand)}</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {o.code ? `${o.code} · ` : ''}{o.screens} repuesto{o.screens === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── el que no está: se crea (queda en el padrón al guardar) ──────────────────────────────── */}
      {texto.length >= 2 && opciones.length === 0 && !buscando && !hayExacto && (
        <Button type="button" variant="outline" size="sm" className="h-8 w-fit gap-1 text-[11px]"
          data-compat-crear={texto} onClick={() => agregar(texto)}
          title={`«${texto}» no está en Modelos: se agrega a la lista y al guardar se crea su ficha`}>
          <Plus className="size-3" /> Crear «{texto}»
        </Button>
      )}
      {texto.length >= 2 && hayExacto && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground" data-compat-existe={texto}>
          <Check className="size-3" /> «{texto}» ya está en la lista
        </span>
      )}
    </div>
  );
}
