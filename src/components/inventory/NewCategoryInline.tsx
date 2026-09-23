import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/db';
import type { Category } from '@/types';
import { toast } from 'sonner';
import {
  CATEGORY_DESC_MAX, CATEGORY_NAME_MAX, categoryOutcomeToast, categoryProblem,
} from '@/lib/product-categories';
import { useEscapeGuard } from '../use-escape-guard';

/**
 * F65 — «+ Nueva categoría» de PRODUCTO (botón + campo, sin salir del formulario).
 *
 * Pedido del dueño (2026-09-23): «cuando en este inventario pueda registrar nuevas categorías, no
 * esté limitado a crear categorías de productos». La categoría era una lista CERRADA (las 6 del
 * arranque + lo que trajeran los catálogos importados): si el repuesto que llegó no entraba en
 * ninguna, no había dónde anotarlo. Ahora se crea acá mismo y queda ELEGIDA en el producto que se
 * está cargando (mismo patrón que el «+ Nueva categoría» de los trabajos del servicio, F62).
 *
 * Reglas: la validación que MANDA es la del backend (`add_category`); acá se muestra por adelantado
 * (`categoryProblem`) para no hacer esperar al operario con un error que se ve venir. Si el nombre
 * escrito ya existe (comparando mayúsculas, acentos y espacios como el backend) NO se crea una
 * gemela: se ofrece USAR LA QUE YA ESTÁ de un toque — partir el catálogo en dos es exactamente lo que
 * hay que evitar.
 *
 * `modo` (F65, 2ª vuelta): en `'formulario'` el panel deja la categoría elegida en el producto que se
 * está cargando; en `'ajustes'` NO hay ningún producto al que «usarla», así que el aviso de repetida
 * se muestra sin el botón (antes, tocarlo cerraba el panel sin hacer nada más).
 */
export function NewCategoryInline({ existing, onCreated, modo = 'formulario', puedeCrear = true }: {
  /** las categorías que ya hay (para avisar del duplicado antes de llamar al backend) */
  existing: Category[];
  /** la categoría creada (o la que ya existía) + si de verdad se creó */
  onCreated: (category: Category, created: boolean) => void;
  modo?: 'formulario' | 'ajustes';
  /** F65 (2ª vuelta): crear categorías es del DUEÑO — a la cajera no se le dibuja el botón. */
  puedeCrear?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  /** Se avisa del problema recién cuando el operario escribió algo (no al abrir el panel). */
  const [tocado, setTocado] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);

  const problema = categoryProblem(nombre, existing);
  const puede = !problema && !guardando;
  const duplicada = problema?.kind === 'duplicada'
    ? existing.find(c => c.id === problema.existingId) ?? null
    : null;

  const cerrar = () => {
    setAbierto(false);
    setNombre('');
    setDescripcion('');
    setTocado(false);
    // El foco vuelve al botón que abrió el panel (patrón de `WorkPicker`): si se crean dos
    // categorías seguidas no hay que ir a buscar el «+» con el mouse.
    botonRef.current?.focus();
  };

  // Escape cierra ESTE panel, no el diálogo del producto que lo contiene (ver `useEscapeGuard`).
  useEscapeGuard(abierto, cerrar);

  const guardar = async () => {
    setTocado(true);
    if (!puede) return;
    setGuardando(true);
    try {
      const r = await api.addCategory(nombre, descripcion);
      toast.success(categoryOutcomeToast(r.created, r.category.name));
      onCreated(r.category, r.created);
      setAbierto(false);
      setNombre('');
      setDescripcion('');
      setTocado(false);
      botonRef.current?.focus();
    } catch (e) {
      toast.error('No se pudo crear la categoría', { description: String(e) });
    } finally {
      setGuardando(false);
    }
  };

  if (!puedeCrear) return null;

  if (!abierto) {
    return (
      <button type="button" ref={botonRef} data-nueva-categoria
        title="Crear una categoría nueva para este producto (queda guardada en el catálogo)"
        className="self-start rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        onClick={() => setAbierto(true)}>
        <Plus className="size-3 inline mr-1" /> Nueva categoría
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-2" data-nueva-categoria-panel>
      <div className="flex flex-wrap items-center gap-2">
        <Input autoFocus value={nombre} data-nueva-categoria-input
          aria-label="Nombre de la categoría nueva"
          maxLength={CATEGORY_NAME_MAX}
          onChange={e => { setTocado(true); setNombre(e.target.value); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void guardar(); }
            if (e.key === 'Escape') cerrar();
          }}
          placeholder="Nombre de la categoría (ej: Tapa trasera)" className="h-8 w-56 text-sm" />
        <Input value={descripcion} data-nueva-categoria-desc
          aria-label="Para qué se usa la categoría nueva (opcional)"
          maxLength={CATEGORY_DESC_MAX}
          onChange={e => setDescripcion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void guardar(); } }}
          placeholder="Para qué la usás (opcional)" className="h-8 w-56 text-sm" />
        <Button type="button" size="sm" className="h-8" disabled={!puede}
          data-nueva-categoria-guardar onClick={() => void guardar()}>
          {guardando ? 'Guardando…' : 'Crear y usar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={cerrar}>Cancelar</Button>
      </div>
      {tocado && problema && problema.kind !== 'duplicada' && (
        <p className="text-[11px] text-danger" data-nueva-categoria-error>{problema.message}</p>
      )}
      {tocado && duplicada && (
        <div className="flex flex-wrap items-center gap-2" data-nueva-categoria-aviso>
          <span className="text-[11px] text-amber-700">{problema?.message}</span>
          {modo === 'formulario' && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" data-nueva-categoria-usar
              onClick={() => { onCreated(duplicada, false); cerrar(); }}>
              Usar «{duplicada.name}»
            </Button>
          )}
        </div>
      )}
      {(!tocado || !problema) && (
        <p className="text-[11px] text-muted-foreground">
          {modo === 'formulario'
            ? <>Se guarda como <strong>{nombre.trim() || '…'}</strong> y queda elegida en este producto. Si el nombre ya existía (las mayúsculas, los acentos y los espacios no cuentan), se usa la categoría que ya está.</>
            : <>Se guarda como <strong>{nombre.trim() || '…'}</strong>. Si el nombre ya existía (las mayúsculas, los acentos y los espacios no cuentan), se usa la categoría que ya está.</>}
        </p>
      )}
    </div>
  );
}
