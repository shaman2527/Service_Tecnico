import { useRef, useState } from 'react';
import {
  Check, ChevronLeft, CircleAlert, FileUp, ListChecks, Loader2, PackagePlus, AlertTriangle, Search, Truck, X,
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
import type { LoadCandidate, LoadPreview, LoadReport, LoadRow } from '@/types';
import { cn } from '@/lib/utils';

// F25 — Asistente para CARGAR EL INVENTARIO del local.
//   1) pegás (o abrís) la lista tal como la tenés escrita,
//   2) la app la cruza contra el catálogo y te muestra qué producto recibe qué cantidad,
//   3) podés corregir el cruce a mano (elegir otra pantalla, buscarla, excluir la línea),
//   4) y al aplicar se hace un RESPALDO de la base y queda el movimiento en el historial.
// Además anota el PROVEEDOR que trajo la mercancía (general de la carga o por línea).
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
  const [proveedor, setProveedor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<LoadReport | null>(null);
  // ¿el operario tocó algo del cruce? (para no perder correcciones al volver atrás sin avisar)
  const [corregido, setCorregido] = useState(false);

  const cruzar = async () => {
    setError(null);
    setBusy(true);
    try {
      const p = await api.previewInventoryLoad(text);
      setPreview(p);
      setRows(p.rows);
      // el buscador abierto pertenecía a la vista anterior: se cierra y se olvida lo de antes
      setManualIdx(null);
      setManualQuery('');
      setManualHits([]);
      setAMano([]);
      setCorregido(false);
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

  // unidades por producto TAL COMO están ahora en la tabla: si dos líneas caen en la misma
  // pantalla, el total que va a quedar en el catálogo es la suma (no la de la última línea)
  const sumById = new Map<number, number>();
  for (const r of rows) {
    if (r.product_id != null && !r.excluded) sumById.set(r.product_id, (sumById.get(r.product_id) ?? 0) + r.qty);
  }
  const fichas = sumById.size;
  const unidades = [...sumById.values()].reduce((a, n) => a + n, 0);
  const activas = rows.filter(r => !r.excluded);
  const cruzadas = activas.filter(r => r.product_id != null).length;
  const compartidas = fichas === 0 ? 0 : rows.filter(r => r.product_id != null && !r.excluded && (sumById.get(r.product_id) ?? 0) !== r.qty).length;
  // líneas del conteo que se quedaron sin pantalla: sus unidades NO se cargan y hay que decirlo
  const sinPantalla = activas.filter(r => r.product_id == null);
  const sinPantallaUnidades = sinPantalla.reduce((a, r) => a + r.qty, 0);
  const excluidas = rows.filter(r => r.excluded);
  const excluidasUnidades = excluidas.reduce((a, r) => a + r.qty, 0);
  const sinCantidad = activas.filter(r => r.qty_issue);
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  // El barrido se recalcula con las filas VIVAS: si el operario asigna a mano (o excluye) una
  // ficha con stock, ya no se barre y el aviso no puede seguir anunciándola.
  const tocadas = new Set<number>(rows.filter(r => r.product_id != null && !r.excluded).map(r => r.product_id as number));
  const zeroLive = (preview?.zero_ids ?? []).filter(z => !tocadas.has(z.product_id));
  const zeroUnidadesLive = zeroLive.reduce((a, z) => a + Math.abs(z.stock), 0);

  const aplicar = async () => {
    setError(null);
    setBusy(true);
    try {
      // Se mandan TODAS las filas (también las que quedaron sin pantalla) para que el backend
      // pueda avisar antes de dejar en 0 mercancía que la lista sí menciona, y `keepIds` con las
      // fichas que la vista previa (o el operario) ya habían asignado: el barrido nunca las toca.
      const keepIds = [...new Set([
        ...(preview?.rows ?? []).map(r => r.product_id),
        ...rows.map(r => r.product_id),
      ].filter((id): id is number => id != null))];
      const r = await api.applyInventoryLoad(rows, zeroMissing, keepIds, proveedor.trim());
      setReport(r);
      setStep(2);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setQty = (idx: number, qty: number) => {
    setCorregido(true);
    setRows(rs => rs.map((r, i) => (i === idx
      // el operario escribió la cantidad: el aviso de «no la entiendo» deja de aplicar
      ? { ...r, qty: Math.min(100_000, Math.max(0, Math.trunc(qty))), qty_issue: false }
      : r)));
  };
  const setProduct = (idx: number, productId: number | null) => {
    setCorregido(true);
    setAMano(ids => ids.filter(x => x !== idx));
    setRows(rs => rs.map((r, i) => {
      if (i !== idx) return r;
      const cand = r.candidates.find(c => c.product_id === productId);
      return {
        ...r,
        product_id: productId,
        product_name: cand?.product_name ?? '',
        stock_now: cand?.stock ?? 0,
        issue: productId == null && !r.qty_issue ? 'Sin pantalla asignada: buscala a mano o excluí la línea.' : r.issue,
      };
    }));
  };
  const setExcluida = (idx: number, excluida: boolean) => {
    setCorregido(true);
    setAMano(ids => ids.filter(x => x !== idx));
    setRows(rs => rs.map((r, i) => (i === idx
      ? { ...r, excluded: excluida, product_id: excluida ? null : r.product_id, issue: excluida ? null : r.issue }
      : r)));
  };
  const setSupplier = (idx: number, value: string) => {
    setCorregido(true);
    setRows(rs => rs.map((r, i) => (i === idx ? { ...r, supplier: value } : r)));
  };

  // --- asignar a mano: el nombre del catálogo y el de la lista escrita a mano no siempre
  // coinciden («6 c/m Accesorios» vs «Pantalla Redmi 6 c/m Acasonor»), así que cada fila tiene
  // su buscador: lo que elija el operario vale igual que un cruce automático.
  const [manualIdx, setManualIdx] = useState<number | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [manualHits, setManualHits] = useState<LoadCandidate[]>([]);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  // índices de fila asignados a mano (por fila, no por ficha: una ficha puede venir del cruce
  // en una línea y a mano en otra)
  const [aMano, setAMano] = useState<number[]>([]);
  // cada búsqueda lleva su número: si el operario escribe rápido, la respuesta vieja no puede
  // pisar a la nueva (quedaba la lista de una consulta anterior)
  const busquedaRef = useRef(0);
  const TOPE_BUSQUEDA = 20;

  const abrirBuscador = (idx: number) => {
    setManualIdx(idx);
    setManualQuery('');
    setManualHits([]);
    setManualError(null);
  };
  const cerrarBuscador = () => {
    busquedaRef.current++; // invalida respuestas en vuelo
    setManualIdx(null);
    setManualQuery('');
    setManualHits([]);
    setManualBusy(false);
    setManualError(null);
  };

  const buscarPantallas = async (q: string) => {
    setManualQuery(q);
    setManualError(null);
    if (q.trim().length < 2) { setManualHits([]); return; }
    const nro = ++busquedaRef.current;
    setManualBusy(true);
    setManualHits([]); // los resultados viejos no se pueden clickear mientras busca
    try {
      const hits = await api.searchInventoryLoadTargets(q, TOPE_BUSQUEDA);
      if (nro !== busquedaRef.current) return; // llegó tarde: ya hay otra búsqueda en curso
      setManualHits(hits);
    } catch (e) {
      if (nro !== busquedaRef.current) return;
      setManualHits([]);
      setManualError(`No se pudo buscar (${e instanceof Error ? e.message : String(e)}). Probá de nuevo.`);
    } finally {
      if (nro === busquedaRef.current) setManualBusy(false);
    }
  };

  const asignarAMano = (idx: number, cand: LoadCandidate) => {
    setCorregido(true);
    setRows(rs => rs.map((r, i) => {
      if (i !== idx) return r;
      const ya = r.candidates.some(c => c.product_id === cand.product_id);
      return {
        ...r,
        product_id: cand.product_id,
        product_name: cand.product_name,
        stock_now: cand.stock,
        excluded: false,
        candidates: ya ? r.candidates : [cand, ...r.candidates],
        // OJO: el aviso de la cantidad (qty_issue) NO se borra — asignar la pantalla no arregla
        // que la cantidad no se entienda (si no, se escribiría 0 o 100.000 u. en silencio)
        issue: r.qty_issue ? r.issue : null,
      };
    }));
    setAMano(ids => (ids.includes(idx) ? ids : [...ids, idx]));
    cerrarBuscador();
  };

  // «Carga rápida»: cuando el barrido está marcado y quedaron líneas sin pantalla, el backend no
  // carga nada. Este botón las excluye a mano (decisión explícita del operario) y sigue.
  const excluirSinPantalla = () => {
    setCorregido(true);
    setRows(rs => rs.map(r => (r.product_id == null && !r.excluded && !r.qty_issue
      ? { ...r, excluded: true, issue: null }
      : r)));
  };

  const volverAtras = () => {
    if (corregido && !confirm('Vas a volver al paso anterior: se pierden las correcciones del cruce (pantallas elegidas, cantidades y exclusiones). ¿Continuar?')) return;
    cerrarBuscador();
    setStep(0);
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent
        className="max-h-[92vh] flex flex-col overflow-hidden sm:max-w-5xl"
        // Radix escucha Escape en captura sobre document: el onKeyDown del input nunca llega a
        // tiempo. Acá sí: Escape cierra el buscador, no el asistente entero.
        onEscapeKeyDown={e => { if (manualIdx !== null) { e.preventDefault(); cerrarBuscador(); } }}
      >
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
                  para A30 y A50. Si una línea dice <code className="text-[11px]">c/m</code> es <strong>con marco</strong>.
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
                <span><strong>{unidades}</strong> unidades</span>
                <span className="text-muted-foreground">{plural(fichas, 'pantalla', 'pantallas')}</span>
                {sinPantalla.length > 0 && (
                  <span className="text-warning">
                    {plural(sinPantalla.length, 'línea', 'líneas')} sin pantalla
                    {sinPantallaUnidades > 0 ? ` (${sinPantallaUnidades} u. que NO se cargan)` : ''}
                  </span>
                )}
                {excluidas.length > 0 && (
                  <span className="text-muted-foreground">
                    {plural(excluidas.length, 'línea excluida', 'líneas excluidas')}
                    {excluidasUnidades > 0 ? ` (${excluidasUnidades} u.)` : ''}
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

              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border px-3 py-2">
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-foreground" htmlFor="prov-carga">
                    <Truck className="size-3.5 text-muted-foreground" /> Proveedor que trajo la mercancía (opcional)
                  </label>
                  <Input
                    id="prov-carga"
                    className="h-8 w-72"
                    placeholder="Ej. Cell World, Importadora…"
                    value={proveedor}
                    onChange={e => setProveedor(e.target.value)}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Se guarda en cada pantalla que se cargue (en una fila podés poner otro proveedor).
                </span>
              </div>

              {sinCantidad.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Hay {plural(sinCantidad.length, 'línea', 'líneas')} con la cantidad sin leer</AlertTitle>
                  <AlertDescription className="text-xs">
                    Escribí las unidades en la columna Cantidad (o excluí la línea): con la cantidad sin leer no se
                    carga nada, para no escribir 0 o 100.000 unidades por error.
                  </AlertDescription>
                </Alert>
              )}

              {zeroMissing && sinPantallaUnidades > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="size-3.5 text-warning" />
                    Con el barrido marcado no se puede cargar hasta resolver {plural(sinPantalla.length, 'línea', 'líneas')} sin
                    pantalla ({sinPantallaUnidades} u.).
                  </span>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={excluirSinPantalla}>
                    <X data-icon="inline-start" className="size-3" /> Excluir esas líneas y cargar el resto
                  </Button>
                </div>
              )}

              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Cargar</TableHead>
                      <TableHead className="w-44">En la lista</TableHead>
                      <TableHead className="w-20">Marca</TableHead>
                      <TableHead className="w-36">Modelo</TableHead>
                      <TableHead className="w-24">Cantidad</TableHead>
                      <TableHead>Producto del catálogo</TableHead>
                      <TableHead className="w-20 text-center">Stock hoy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => {
                      const total = r.product_id == null || r.excluded ? 0 : sumById.get(r.product_id) ?? 0;
                      const mismaCalidad = r.candidates.filter(c => c.quality === r.candidates[0]?.quality).length;
                      return (
                      <TableRow
                        key={`${r.raw}-${i}`}
                        className={cn(r.excluded && 'opacity-50', !r.excluded && r.product_id == null && 'bg-warning/5')}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            className="size-3.5"
                            aria-label={`Cargar la línea ${r.raw}`}
                            checked={!r.excluded}
                            onChange={e => setExcluida(i, !e.target.checked)}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.raw}</TableCell>
                        <TableCell className="text-xs">{r.brand}</TableCell>
                        <TableCell className="text-xs">{r.model}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Input
                              className={cn('h-8 w-16 text-center tabular-nums', r.qty_issue && 'border-destructive')}
                              inputMode="numeric"
                              aria-label={`Unidades de la línea ${r.raw}`}
                              aria-invalid={r.qty_issue}
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
                          <div className="flex flex-col gap-1">
                            {r.candidates.length > 0 && (
                              <Select
                                value={r.product_id == null ? 'none' : String(r.product_id)}
                                onValueChange={v => setProduct(i, v === 'none' ? null : Number(v))}
                              >
                                <SelectTrigger className="h-8" aria-label={`Pantalla del catálogo para ${r.model}`}>
                                  <SelectValue placeholder="— Sin pantalla —" />
                                </SelectTrigger>
                                <SelectContent>
                                  {r.candidates.map(c => (
                                    <SelectItem key={c.product_id} value={String(c.product_id)}>
                                      {c.product_name} · {c.quality}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="none">— No cargar esta línea —</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                            {r.qty_issue && (
                              <span className="flex items-center gap-1.5 text-[11px] text-destructive">
                                <AlertTriangle className="size-3.5" /> Cantidad sin leer: escribila arriba.
                              </span>
                            )}
                            {!r.qty_issue && r.candidates.length === 0 && !r.excluded && (
                              <span className="flex items-center gap-1.5 text-xs text-warning">
                                <AlertTriangle className="size-3.5" /> {r.issue ?? 'sin coincidencia'}
                              </span>
                            )}
                            {!r.qty_issue && r.issue && r.candidates.length > 0 && !r.excluded && (
                              <span className="text-[11px] text-warning">{r.issue}</span>
                            )}
                            {mismaCalidad > 1 && !r.excluded && (
                              <span className="text-[10px] text-muted-foreground">
                                {mismaCalidad} fichas parecidas: si son la misma pantalla, fusionalas en Productos →
                                «Revisar duplicados».
                              </span>
                            )}

                            {manualIdx === i ? (
                              <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                                <Input
                                  autoFocus
                                  className="h-8"
                                  placeholder="Buscar la pantalla por nombre, marca o modelo…"
                                  aria-label={`Buscar la pantalla de la línea ${r.raw}`}
                                  value={manualQuery}
                                  onChange={e => buscarPantallas(e.target.value)}
                                />
                                {manualBusy && (
                                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Loader2 className="size-3 animate-spin" /> buscando…
                                  </span>
                                )}
                                {!manualBusy && manualQuery.trim().length > 0 && manualQuery.trim().length < 2 && (
                                  <span className="text-[11px] text-muted-foreground">Escribí al menos 2 letras.</span>
                                )}
                                {!manualBusy && manualQuery.trim().length >= 2 && manualHits.length === 0 && (
                                  <span className={cn('text-[11px]', manualError ? 'text-destructive' : 'text-muted-foreground')} role="status">
                                    {manualError ?? 'Ninguna pantalla coincide. Probá con menos palabras o cargala en Productos.'}
                                  </span>
                                )}
                                {manualHits.length > 0 && (
                                  <div className="flex flex-col" role="listbox" aria-label="Pantallas encontradas" aria-live="polite">
                                    {manualHits.map(c => (
                                      <Button
                                        key={c.product_id}
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        role="option"
                                        aria-selected={false}
                                        data-load-hit={c.product_id}
                                        className="h-auto justify-start py-1 text-left text-[11px] font-normal"
                                        onClick={() => asignarAMano(i, c)}
                                      >
                                        {c.product_name}
                                        <span className="ml-1 text-muted-foreground">
                                          · {c.category} · {c.stock} u.
                                        </span>
                                      </Button>
                                    ))}
                                    {manualHits.length >= TOPE_BUSQUEDA && (
                                      <span className="pt-1 text-[10px] text-muted-foreground">
                                        Se muestran las primeras {TOPE_BUSQUEDA}: afiná la búsqueda para ver otras.
                                      </span>
                                    )}
                                  </div>
                                )}
                                <Button type="button" variant="ghost" size="sm" className="h-7 self-start text-[11px]"
                                  onClick={cerrarBuscador}>
                                  Cancelar
                                </Button>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 self-start text-[11px]"
                                aria-expanded={false}
                                onClick={() => abrirBuscador(i)}
                              >
                                <Search data-icon="inline-start" className="size-3" />
                                {r.candidates.length === 0 ? 'Buscar la pantalla' : 'Buscar otra…'}
                              </Button>
                            )}
                            {aMano.includes(i) && !r.excluded && (
                              <span className="text-[10px] text-muted-foreground">asignada a mano</span>
                            )}
                            {r.product_id != null && !r.excluded && (
                              <Input
                                className="h-7 w-56 text-[11px]"
                                placeholder={proveedor ? `Proveedor: ${proveedor}` : 'Proveedor (opcional)'}
                                aria-label={`Proveedor de la línea ${r.raw}`}
                                value={r.supplier}
                                onChange={e => setSupplier(i, e.target.value)}
                              />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums">
                          {r.excluded || r.product_id == null ? '—' : r.stock_now}
                        </TableCell>
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
                    zeroLive.length > 0 ? (
                      <span className="text-warning">
                        Con esta lista quedan en 0 <strong>{plural(zeroLive.length, 'pantalla', 'pantallas')}</strong>
                        {' '}({zeroUnidadesLive} unidades).
                      </span>
                    ) : (
                      <span className="text-success">Ninguna otra pantalla queda en 0.</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">
                      Sin marcar: las pantallas que no están en la lista conservan su stock (quedarían{' '}
                      {zeroLive.length} en 0 / {zeroUnidadesLive} unidades si lo marcás).
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
                  {report.suppliered > 0 && (
                    <span><strong>{report.suppliered}</strong> pantallas quedaron con su proveedor anotado.</span>
                  )}
                  {report.excluded > 0 && (
                    <span className="text-muted-foreground">
                      <strong>{report.excluded}</strong> líneas las excluiste vos ({report.excluded_units} unidades): no se tocaron.
                    </span>
                  )}
                  {report.skipped > 0 && (
                    <span className="text-warning">
                      <strong>{report.skipped}</strong> líneas no se cargaron (apuntaban a otra categoría o a una ficha que ya no existe).
                    </span>
                  )}
                  {report.unassigned > 0 && (
                    <span className="text-warning">
                      <strong>{report.unassigned}</strong> líneas del conteo quedaron sin pantalla asignada
                      ({report.unassigned_units} unidades que NO se cargaron): buscalas a mano o corregí el nombre en la lista.
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
            <Button variant="outline" onClick={volverAtras} disabled={busy}>
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
            <Button onClick={aplicar} disabled={busy || cruzadas === 0 || sinCantidad.length > 0}>
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
