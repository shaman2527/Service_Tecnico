import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Flag, Layers, Loader2, Merge, Pencil, Save, Search, Smartphone } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { api } from '@/db';
import type { PhoneListRow, RenamePreview } from '@/types';

// F24 — Corregir la lista de teléfonos desde la app.
//   Editar / Alta : marca + línea + modelo, con VISTA PREVIA del nombre comercial
//                   (el backend lo calcula con las reglas del padrón).
//   Fusionar      : junta dos fichas del mismo teléfono escrito distinto (el que se
//                   queda hereda los alias y los repuestos del otro).
// La escritura está gateada en el BACKEND (sesión de dueño): acá solo se esconde para cajera.

const MARCAS_COMUNES = [
  'Samsung', 'Xiaomi', 'Motorola', 'Apple', 'Honor', 'Huawei', 'Tecno', 'Infinix',
  'ZTE', 'Alcatel', 'Blu', 'Realme', 'Oppo', 'Vivo', 'Nokia', 'Itel', 'TCL', 'Google',
  'LG', 'Umidigi', 'Amazon', 'Blackview', 'Hyundai', 'Krip', 'Lifephone', 'Genérico',
];

export function PhoneEditDialog({ phone, brands, onClose, onSaved, onMerge }: {
  /** null = alta de un teléfono nuevo */
  phone: PhoneListRow | null;
  /** marcas que ya existen en el padrón (para el selector) */
  brands: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onMerge: (keep: PhoneListRow) => void;
}) {
  const editing = phone !== null;
  const [brand, setBrand] = useState(phone?.brand ?? '');
  const [line, setLine] = useState(phone?.line ?? '');
  const [model, setModel] = useState(phone?.model ?? '');
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opciones = useMemo(() => {
    const set = new Set<string>([...MARCAS_COMUNES, ...brands.map(b => b.trim()).filter(Boolean)]);
    if (brand.trim()) set.add(brand.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [brands, brand]);

  // Vista previa (solo en edición): qué nombre queda y si choca con otro teléfono
  useEffect(() => {
    if (!editing || !phone) { setPreview(null); return; }
    if (!brand.trim() && !model.trim()) { setPreview(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.previewRenamePhone(phone.id, brand, line, model)
        .then(p => { if (alive) setPreview(p); })
        .catch(() => { if (alive) setPreview(null); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [editing, phone, brand, line, model]);

  const guardar = async () => {
    setError(null);
    if (!brand.trim() || !model.trim()) {
      setError('Poné la marca y el modelo (la línea es opcional: Galaxy, Moto, Redmi…).');
      return;
    }
    setBusy(true);
    try {
      if (editing && phone) {
        await api.renamePhone(phone.id, brand.trim(), line.trim(), model.trim());
        onSaved(`Guardado: ${preview?.name ?? model.trim()}`);
      } else {
        await api.addPhone(brand.trim(), line.trim(), model.trim());
        onSaved('Teléfono agregado a la lista');
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] flex flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            {editing ? <Pencil className="size-4 text-muted-foreground" /> : <Smartphone className="size-4 text-muted-foreground" />}
            {editing ? 'Corregir el nombre del teléfono' : 'Agregar un teléfono a la lista'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? `Cómo se llama este teléfono en la lista maestra del taller. Los repuestos NO se tocan: se siguen encontrando por cómo estaba escrito en el inventario.`
              : 'Para un teléfono que todavía no está en la lista (los repuestos se cargan desde la ficha del producto).'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {editing && phone && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <span className="text-xs text-muted-foreground">Ahora:</span>
              <span className="text-sm font-medium">{phone.name}</span>
              <Badge variant="secondary" className="text-[10px]">{phone.brand}</Badge>
              <Badge variant="outline" className="text-[10px]">{phone.products} repuestos · {phone.stock} u.</Badge>
              {phone.needs_review && (
                <Badge variant="outline" className="text-[10px] gap-1 text-warning border-warning/50">
                  <Flag className="size-3" /> por revisar
                </Badge>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ph-brand" className="text-sm font-medium">Marca</label>
              <Select value={brand} onValueChange={setBrand}>
                <SelectTrigger id="ph-brand"><SelectValue placeholder="Elegí la marca" /></SelectTrigger>
                <SelectContent>
                  {opciones.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ph-line" className="text-sm font-medium">Línea (opcional)</label>
              <Input
                id="ph-line"
                value={line}
                placeholder="Galaxy, Moto, Redmi, Poco…"
                onChange={e => setLine(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ph-model" className="text-sm font-medium">Modelo</label>
              <Input
                id="ph-model"
                value={model}
                placeholder="A06, Note 11, X6A…"
                onChange={e => setModel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') guardar(); }}
              />
            </div>
          </div>

          {editing && preview && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Quedará:</span>
                <span className="text-sm font-semibold">{preview.name}</span>
                <Badge variant="secondary" className="text-[10px]">{preview.brand}</Badge>
                {!preview.clash && (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Layers className="size-3" /> {preview.products} repuestos · {preview.stock} u.
                  </Badge>
                )}
              </div>
              {preview.clash ? (
                <Alert>
                  <CircleAlert className="size-4" />
                  <AlertTitle>Ya existe «{preview.clash}»</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    <span className="text-xs">
                      Si es el MISMO teléfono escrito distinto, no lo renombres: junta las dos fichas.
                      Fusionados quedarían <strong>{preview.products} repuestos · {preview.stock} u.</strong>
                    </span>
                    <span>
                      <Button variant="outline" size="sm" onClick={() => phone && onMerge(phone)}>
                        <Merge data-icon="inline-start" /> Fusionar con «{preview.clash}»
                      </Button>
                    </span>
                  </AlertDescription>
                </Alert>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Sin choques: no hay otro teléfono con ese nombre. Conserva sus repuestos por cómo
                  estaba escrito en el inventario.
                </span>
              )}
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>No se pudo guardar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={guardar} disabled={busy}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
            {editing ? 'Guardar nombre' : 'Agregar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Fusiona dos fichas del MISMO teléfono: la que abriste se queda (y hereda los alias). */
export function PhoneMergeDialog({ keep, onClose, onMerged }: {
  keep: PhoneListRow;
  onClose: () => void;
  onMerged: (msg: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PhoneListRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.getPhones(null, search, false, false, false, 'nombre', 'asc', 40, 0)
        .then(r => { if (alive) setRows(r.items.filter(p => p.id !== keep.id)); })
        .catch(e => { if (alive) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [search, keep.id]);

  const fusionar = async (other: PhoneListRow) => {
    setError(null);
    setBusy(other.id);
    try {
      await api.mergePhones(keep.id, other.id);
      onMerged(`Fusionado: «${other.name}» ahora es parte de «${keep.name}»`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] flex flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" /> Fusionar «{keep.name}»
          </DialogTitle>
          <DialogDescription>
            Buscá el otro teléfono que es el MISMO aparato escrito distinto. Se queda esta ficha
            (<span className="font-medium text-foreground">{keep.name}</span>) y la otra se borra:
            sus repuestos se siguen encontrando por el nombre viejo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar el teléfono a juntar (nombre, marca o como estaba escrito)…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>No se pudo fusionar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            {rows.length === 0 && (
              <span className="px-1 py-2 text-xs text-muted-foreground">Ningún otro teléfono coincide.</span>
            )}
            {rows.map(p => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{p.brand}</Badge>
                  <span className="text-[11px] text-muted-foreground">{p.products} repuestos · {p.stock} u.</span>
                  {p.aliases.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      escrito: {p.aliases.slice(0, 3).join(' · ')}{p.aliases.length > 3 ? '…' : ''}
                    </span>
                  )}
                </span>
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fusionar(p)}>
                  {busy === p.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Layers data-icon="inline-start" />}
                  Juntar esta
                </Button>
              </div>
            ))}
          </div>

          <Separator />
          <span className="text-[11px] text-muted-foreground">
            Queda una sola ficha con el nombre «{keep.name}» y los repuestos de las dos.
          </span>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
