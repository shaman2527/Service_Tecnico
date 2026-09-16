import { useState } from 'react';
import {
  Check, ChevronLeft, CircleAlert, FileUp, ListChecks, Loader2, PackagePlus, AlertTriangle,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, isTauri } from '@/db';
import type { LoadPreview, LoadReport, LoadRow } from '@/types';
import { cn } from '@/lib/utils';

// F25 — Asistente para CARGAR EL INVENTARIO del local.
//   1) pegás (o abrís) la lista tal como la tenés escrita,
//   2) la app la cruza contra el catálogo y te muestra qué producto recibe qué cantidad,
//   3) podés corregir el cruce a mano,
//   4) y al aplicar se hace un RESPALDO de la base y queda el movimiento en el historial.
// No toca precios ni compatibilidad (eso lo cura el taller en Productos).

const PASOS = ['Pegar la lista', 'Revisar el cruce', 'Listo'] as const;

const EJEMPLO = `Samsung
A30/A50 (2)
Galaxy A12 (1)

Tecno
Spark 8P (3)
Camon 18 (0)`;

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {PASOS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
              i < step ? 'bg-success text-white' : i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn('text-xs', i === step ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
          {i < PASOS.length - 1 && <span className="text-muted-foreground/40">·</span>}
        </div>
      ))}
    </div>
  );
}

export function LoadInventoryDialog({ onClose, onApplied }: {
  onClose: () => void;
  onApplied: () => void;
}) {
  const [step, setStep] = useState(0);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<LoadPreview | null>(null);
  const [rows, setRows] = useState<LoadRow[]>([]);
  const [zeroMissing, setZeroMissing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<LoadReport | null>(null);

  const cruzar = async () => {
    setError(null);
    setBusy(true);
    try {
      const p = await api.previewInventoryLoad(text);
      setPreview(p);
      setRows(p.rows);
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const abrirArchivo = async () => {
    setError(null);
    if (!isTauri) { setError('Abrir un archivo solo funciona en la app (no en el navegador): pegá la lista.'); return; }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await open({ multiple: false, filters: [{ name: 'Lista de texto', extensions: ['txt', 'csv', 'md'] }] });
      if (!path || typeof path !== 'string') return;
      const content = await readTextFile(path);
      setText(content);
    } catch (e) {
      setError(`No se pudo abrir el archivo (${e instanceof Error ? e.message : String(e)}). Pegá el texto a mano.`);
    }
  };

  const aplicar = async () => {
    setError(null);
    setBusy(true);
    try {
      // Se mandan TODAS las filas (también las que quedaron sin pantalla) para que el backend
      // pueda avisar antes de dejar en 0 mercancía que la lista sí menciona, y `keepIds` con las
      // fichas que la vista previa ya tenía: el barrido nunca las toca.
      const keepIds = preview
        ? [...new Set(preview.rows.filter(r => r.product_id != null).map(r => r.product_id as number))]
        : [];
      const r = await api.applyInventoryLoad(rows, zeroMissing, keepIds);
      setReport(r);
      setStep(2);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setQty = (idx: number, qty: number) =>
    setRows(rs => rs.map((r, i) => (i === idx ? { ...r, qty: Math.min(100_000, Math.max(0, Math.trunc(qty))) } : r)));
  const setProduct = (idx: number, productId: number | null) =>
    setRows(rs => rs.map((r, i) => {
      if (i !== idx) return r;
      const cand = r.candidates.find(c => c.product_id === productId);
      return { ...r, product_id: productId, product_name: cand?.product_name ?? '', stock_now: cand?.stock ?? 0 };
    }));

  // unidades por producto TAL COMO están ahora en la tabla: si dos líneas caen en la misma
  // pantalla, el total que va a quedar en el catálogo es la suma (no la de la última línea)
  const sumById = new Map<number, number>();
  for (const r of rows) {
    if (r.product_id != null) sumById.set(r.product_id, (sumById.get(r.product_id) ?? 0) + r.qty);
  }
  const cruzadas = rows.filter(r => r.product_id != null).length;
  const unidades = [...sumById.values()].reduce((a, n) => a + n, 0);
  const fichas = sumById.size;
  const compartidas = fichas === 0 ? 0 : rows.filter(r => r.product_id != null && (sumById.get(r.product_id) ?? 0) !== r.qty).length;
  // líneas del conteo que se quedaron sin pantalla: sus unidades NO se cargan y hay que decirlo
  const sinPantalla = rows.filter(r => r.product_id == null);
  const sinPantallaUnidades = sinPantalla.reduce((a, r) => a + r.qty, 0);
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] flex flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="size-4 text-muted-foreground" /> Cargar el inventario del local
          </DialogTitle>
          <div className="pt-1"><Stepper step={step} /></div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <CircleAlert className="size-4" />
              <AlertTitle>No se pudo continuar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={abrirArchivo}>
                  <FileUp data-icon="inline-start" /> Abrir un archivo .txt
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  …o pegá la lista abajo. Una marca por línea (Samsung, Tecno, Iphone…) y debajo sus
                  modelos: <code className="text-[11px]">A30/A50 (2)</code> = 2 unidades de la pantalla que sirve
                  para A30 y A50.
                </span>
              </div>
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={14}
                spellCheck={false}
                placeholder={EJEMPLO}
                className="font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {text.trim() ? `${text.split('\n').filter(l => l.trim()).length} líneas pegadas` : 'Lista vacía'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setText(EJEMPLO)}>Usar el ejemplo</Button>
              </div>
            </>
          )}

          {step === 1 && preview && (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <span><strong>{preview.lines}</strong> líneas</span>
                <span className="text-success"><strong>{cruzadas}</strong> cruzadas</span>
                {rows.length - cruzadas > 0 && (
                  <span className="text-warning"><strong>{rows.length - cruzadas}</strong> sin producto</span>
                )}
                <span><strong>{unidades}</strong> unidades</span>
                <span className="text-muted-foreground">{plural(fichas, 'pantalla', 'pantallas')}</span>
                {sinPantalla.length > 0 && (
                  <span className="text-warning">
                    {plural(sinPantalla.length, 'línea', 'líneas')} sin pantalla
                    {sinPantallaUnidades > 0 ? ` (${sinPantallaUnidades} u. que NO se cargan)` : ''}
                  </span>
                )}
                {compartidas > 0 && (
                  <span className="text-muted-foreground">{compartidas} líneas comparten pantalla (sus unidades se suman)</span>
                )}
                <span className="text-muted-foreground">{preview.brands} marcas</span>
                {preview.skipped > 0 && (
                  <span className="text-muted-foreground">{preview.skipped} líneas ignoradas (sin marca o basura)</span>
                )}
              </div>

              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-48">En la lista</TableHead>
                      <TableHead className="w-20">Marca</TableHead>
                      <TableHead className="w-40">Modelo</TableHead>
                      <TableHead className="w-24">Cantidad</TableHead>
                      <TableHead>Producto del catálogo</TableHead>
                      <TableHead className="w-20 text-center">Stock hoy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => {
                      const total = r.product_id == null ? 0 : sumById.get(r.product_id) ?? 0;
                      return (
                      <TableRow key={`${r.raw}-${i}`} className={cn(r.product_id == null && 'bg-warning/5')}>
                        <TableCell className="text-xs text-muted-foreground">{r.raw}</TableCell>
                        <TableCell className="text-xs">{r.brand}</TableCell>
                        <TableCell className="text-xs">{r.model}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Input
                              className="h-8 w-16 text-center tabular-nums"
                              inputMode="numeric"
                              aria-label={`Unidades de la línea ${r.raw}`}
                              value={String(r.qty)}
                              onChange={e => setQty(i, Number(e.target.value.replace(/\D/g, '') || 0))}
                            />
                            {total > r.qty && (
                              <span className="text-[10px] text-muted-foreground" title="Otra línea de la lista carga la misma pantalla">
                                total {total} u.
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.candidates.length === 0 ? (
                            <span className="flex items-center gap-1.5 text-xs text-warning">
                              <AlertTriangle className="size-3.5" /> {r.issue ?? 'sin coincidencia'}
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <Select value={String(r.product_id ?? '')} onValueChange={v => setProduct(i, v === 'none' ? null : Number(v))}>
                                <SelectTrigger className="h-8" aria-label={`Pantalla del catálogo para ${r.model}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {r.candidates.map(c => (
                                    <SelectItem key={c.product_id} value={String(c.product_id)}>
                                      {c.product_name} · {c.quality}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="none">— No cargar esta línea —</SelectItem>
                                </SelectContent>
                              </Select>
                              {r.issue && <span className="text-[11px] text-warning">{r.issue}</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums">{r.product_id == null ? '—' : r.stock_now}</TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5"
                  checked={zeroMissing}
                  onChange={e => setZeroMissing(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-foreground">Las pantallas que no están en la lista quedan en 0.</span>{' '}
                  Dejalo marcado si la lista es TODO lo que hay en el local (es lo normal): así el inventario del sistema
                  queda igual a la realidad y se registra el movimiento.{' '}
                  {zeroMissing ? (
                    preview.zero_count > 0 ? (
                      <span className="text-warning">
                        Con esta lista quedan en 0 <strong>{plural(preview.zero_count, 'pantalla', 'pantallas')}</strong>
                        {' '}({preview.zero_units} unidades).
                      </span>
                    ) : (
                      <span className="text-success">Ninguna otra pantalla queda en 0.</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">
                      Sin marcar: las pantallas que no están en la lista conservan su stock (quedarían{' '}
                      {preview.zero_count} en 0 / {preview.zero_units} unidades si lo marcás).
                    </span>
                  )}
                </span>
              </label>
            </>
          )}

          {step === 2 && report && (
            <div className="flex flex-col gap-3">
              <Alert>
                <ListChecks className="size-4" />
                <AlertTitle>Inventario cargado</AlertTitle>
                <AlertDescription className="flex flex-col gap-1 text-xs">
                  <span><strong>{report.updated}</strong> pantallas actualizadas con lo que dice la lista ({report.units} unidades).</span>
                  <span><strong>{report.zeroed}</strong> quedaron en 0 porque no estaban en la lista.</span>
                  {report.skipped > 0 && (
                    <span className="text-warning">
                      <strong>{report.skipped}</strong> líneas no se cargaron (apuntaban a otra categoría o a una ficha que ya no existe).
                    </span>
                  )}
                  {report.unassigned > 0 && (
                    <span className="text-warning">
                      <strong>{report.unassigned}</strong> líneas del conteo quedaron sin pantalla asignada
                      ({report.unassigned_units} unidades que NO se cargaron): revisalas en Productos o corregí el nombre en la lista.
                    </span>
                  )}
                  <span><strong>{report.movements}</strong> movimientos anotados en el historial (motivo «Carga de inventario»).</span>
                  <span className="text-muted-foreground">Respaldo de la base: {report.backup}</span>
                </AlertDescription>
              </Alert>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">No se tocaron precios ni compatibilidad</Badge>
                <span>Los precios y la compatibilidad se curan en Inventario → Productos.</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          {step === 1 && (
            <Button variant="outline" onClick={() => setStep(0)} disabled={busy}>
              <ChevronLeft data-icon="inline-start" /> Atrás
            </Button>
          )}
          {step === 0 && (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={cruzar} disabled={busy || text.trim().length === 0}>
                {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ListChecks data-icon="inline-start" />}
                Revisar el cruce
              </Button>
            </>
          )}
          {step === 1 && (
            <Button onClick={aplicar} disabled={busy || cruzadas === 0}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <PackagePlus data-icon="inline-start" />}
              Cargar {plural(fichas, 'pantalla', 'pantallas')} ({unidades} u.)
            </Button>
          )}
          {step === 2 && <Button onClick={onClose}>Listo</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
