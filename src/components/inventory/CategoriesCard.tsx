import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Tags, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/db';
import type { CategoryUsage } from '@/types';
import { toast } from 'sonner';
import {
  CATEGORY_DESC_MAX, CATEGORY_NAME_MAX, categoryDeleteBlock, categoryProblem, categoryUsageLabel,
} from '@/lib/product-categories';
import { NewCategoryInline } from './NewCategoryInline';

/**
 * F65 — «Categorías del catálogo» (pestaña Ajustes, solo el dueño).
 *
 * Pedido del dueño (2026-09-23): «cuando en este inventario pueda registrar nuevas categorías, no
 * esté limitado a crear categorías de productos». Esta tarjeta es el lugar donde el catálogo se
 * ORDENA como el local trabaja: crear, corregir el nombre (un error de tipeo) y borrar las que
 * quedaron vacías.
 *
 * INVARIANTES (las garantiza el backend; acá se muestran antes de intentarlo):
 *   · renombrar NO toca ningún producto (siguen apuntando al mismo id; las fichas conservan el nombre
 *     con el que se guardaron y el catálogo muestra el nombre nuevo);
 *   · una categoría CON productos no se borra: se dice cuántos son y el botón queda apagado;
 *   · las tres del PADRÓN DE TELÉFONOS (Pantalla / Táctil / Táctil Tablet) son fijas: el buscador de
 *     modelos y el nombre de las fichas dependen de ellas.
 */
export function CategoriesCard({ onChanged, refreshKey = 0 }: {
  onChanged: () => void;
  /**
   * F65 (2ª vuelta) — sube cuando OTRA parte del inventario cambió los datos (p. ej. la carga de la
   * lista del local, que mueve el stock): la tarjeta vuelve a leer el uso real. Antes se leía sólo al
   * montar y después de sus propias escrituras, así que los «u.» quedaban viejos justo después de
   * contar la mercancía (un número que miente en la misma pestaña).
   */
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<CategoryUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setRows(await api.getCategoriesWithUsage());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar, refreshKey]);

  const abrirEdicion = (c: CategoryUsage) => {
    setEditando(c.id);
    setNombre(c.name);
    setDescripcion(c.description ?? '');
  };

  const problema = editando !== null ? categoryProblem(nombre, rows ?? [], editando) : null;

  const guardarNombre = async (c: CategoryUsage) => {
    if (problema || busy) return;
    // Sin cambios reales no se llama al backend ni se dice «corregida»: guardar una fila que no se
    // tocó (caso típico: abrir «Corregir» de una categoría del padrón y dar Guardar) no puede
    // mentir con un toast de éxito sobre un UPDATE idéntico.
    if (nombre.trim() === c.name && descripcion.trim() === (c.description ?? '').trim()) {
      setEditando(null);
      return;
    }
    setBusy(true);
    try {
      await api.renameCategory(c.id, nombre, descripcion);
      toast.success(`Categoría «${nombre.trim()}» corregida`);
      setEditando(null);
      await cargar();
      onChanged();
    } catch (e) {
      toast.error('No se pudo corregir la categoría', { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const borrar = async (c: CategoryUsage) => {
    const bloqueo = categoryDeleteBlock(c);
    if (bloqueo) { toast.error(`No se puede borrar «${c.name}»`, { description: bloqueo }); return; }
    if (!confirm(`¿Eliminar la categoría «${c.name}»?\n\nNo tiene ningún producto, así que no se borra ninguna ficha.`)) return;
    setBusy(true);
    try {
      await api.deleteCategory(c.id);
      toast.success(`Categoría «${c.name}» eliminada`);
      await cargar();
      onChanged();
    } catch (e) {
      toast.error('No se pudo eliminar la categoría', { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-card="categorias">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Tags className="size-4 text-primary" /> Categorías del catálogo
        </CardTitle>
        <CardDescription>
          Las categorías con las que se organiza el inventario (<em>Pantalla</em>, <em>Batería</em>…).
          Si el repuesto que llegó no entra en ninguna, <strong>creá la tuya</strong>: la categoría nueva
          queda disponible en el formulario del producto y en el filtro de <em>Productos</em>.
          Corregir el nombre <strong>no toca ninguna ficha</strong> y una categoría que ya tiene
          productos <strong>no se puede borrar</strong> (hay que pasar esos productos a otra).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <NewCategoryInline
          existing={rows ?? []}
          modo="ajustes"
          onCreated={async () => { await cargar(); onChanged(); }}
        />

        {error && (
          <div className="flex flex-wrap items-center gap-2" data-categorias-error>
            <p className="text-xs text-danger">No se pudieron leer las categorías: {error}</p>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              data-categorias-reintentar onClick={() => void cargar()}>
              Volver a leer
            </Button>
          </div>
        )}
        {!rows && !error && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Leyendo las categorías…
          </p>
        )}

        {rows && (
          <div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border"
            data-categorias={rows.length}>
            {rows.map(c => {
              const bloqueo = categoryDeleteBlock(c);
              const enEdicion = editando === c.id;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2"
                  data-categoria-fila={c.name}>
                  {enEdicion ? (
                    <>
                      <Input autoFocus value={nombre} data-categoria-nombre-input
                        disabled={c.phone_padron}
                        aria-label={`Nombre de la categoría ${c.name}`}
                        maxLength={CATEGORY_NAME_MAX}
                        title={c.phone_padron ? 'El nombre de esta categoría es fijo (es del padrón de teléfonos)' : undefined}
                        onChange={e => setNombre(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); void guardarNombre(c); }
                          if (e.key === 'Escape') setEditando(null);
                        }}
                        className="h-8 w-56 text-sm" />
                      <Input value={descripcion} data-categoria-desc-input
                        aria-label={`Para qué se usa la categoría ${c.name} (opcional)`}
                        maxLength={CATEGORY_DESC_MAX}
                        onChange={e => setDescripcion(e.target.value)}
                        placeholder="Para qué la usás (opcional)" className="h-8 w-56 text-sm" />
                      <Button size="sm" className="h-8" disabled={!!problema || busy}
                        data-categoria-guardar onClick={() => void guardarNombre(c)}>
                        <Check data-icon="inline-start" /> Guardar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" data-categoria-cancelar
                        onClick={() => setEditando(null)}>
                        <X data-icon="inline-start" /> Cancelar
                      </Button>
                      {problema && <p className="w-full text-[11px] text-danger" data-categoria-error>{problema.message}</p>}
                      {c.phone_padron && (
                        <p className="w-full text-[11px] text-muted-foreground" data-categoria-nombre-fijo>
                          El nombre es fijo (es la categoría del padrón de teléfonos): acá solo se anota la descripción.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium">{c.name}</span>
                      {c.phone_padron && (
                        <Badge variant="outline" className="text-[10px]" data-categoria-padron>Padrón de teléfonos</Badge>
                      )}
                      {c.description && (
                        <span className="text-[11px] text-muted-foreground">· {c.description}</span>
                      )}
                      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground"
                        data-categoria-uso={c.name}>
                        {categoryUsageLabel(c)}
                      </span>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        data-categoria-editar={c.name}
                        title={c.phone_padron
                          ? 'Es del padrón de teléfonos: el nombre es fijo, podés anotar la descripción'
                          : 'Corregir el nombre de esta categoría'}
                        disabled={busy}
                        onClick={() => abrirEdicion(c)}>
                        <Pencil data-icon="inline-start" /> Corregir
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs text-danger hover:text-danger"
                        data-categoria-borrar={c.name}
                        title={bloqueo ?? 'Eliminar esta categoría (está vacía)'}
                        disabled={!!bloqueo || busy}
                        onClick={() => void borrar(c)}>
                        <Trash2 data-icon="inline-start" /> Eliminar
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <span className="text-[11px] text-muted-foreground">
          Corregir el nombre <strong>no toca ninguna ficha</strong>: los productos siguen apuntando a la
          misma categoría y conservan el nombre con el que se guardaron (el nombre nuevo se usa de acá en
          adelante y el catálogo agrupa por la categoría corregida). Ojo: si después usás{' '}
          <em>«Nombres de marca y modelo → 2. Ordenar los nombres»</em> en esta misma pestaña, esas fichas
          se reescriben con el nombre nuevo de la categoría.
        </span>
      </CardContent>
    </Card>
  );
}
