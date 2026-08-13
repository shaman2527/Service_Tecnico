import { useEffect, useRef, useState } from 'react';
import { Printer, RefreshCw, ShieldCheck, Sparkles, ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { api } from '../db';
import { logoToRaster, makeTestLogoPng, printerWidthChars, buildReceiptTerms } from '@/lib/utils';
import { toast } from 'sonner';
import type { ComPort, PrinterSettings } from '../types';
import { DEFAULT_PRINTER_SETTINGS } from '../types';

const BAUD_RATES = [9600, 19200, 38400, 115200];

export default function PrinterSettingsDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [ports, setPorts] = useState<ComPort[]>([]);
  const [winPrinters, setWinPrinters] = useState<string[]>([]);
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [wStatus, setWStatus] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, 'ok' | 'fail'>>({});
  const [probing, setProbing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Ref con la config ACTUAL en cada momento (el closure de probePorts puede estar
  // stale): fuente de verdad para merges y auto-detección.
  const settingsRef = useRef<PrinterSettings>(settings);
  // Fail-closed: solo se auto-guarda el puerto si la config REAL ya fue cargada
  // de la DB. Si la carga falla (IPC frío) el auto-save queda bloqueado — jamás
  // escribe los defaults encima de logo/cabecera/windowsPrinter guardados.
  const loadedRef = useRef(false);

  // Prueba cada puerto COM en vivo (tope 3s por puerto, en paralelo) y marca los que responden.
  // Si el puerto seleccionado no responde y otro sí, lo cambia solo (con aviso).
  const probePorts = async (list: ComPort[]) => {
    if (list.length === 0) { setProbes({}); return; }
    setProbing(true);
    setProbes({});
    const current = settingsRef.current;
    const results = await Promise.all(list.map(async p => {
      try {
        await api.probeComPort(p.name, current.baud);
        return [p.name, 'ok' as const];
      } catch {
        return [p.name, 'fail' as const];
      }
    }));
    const next = Object.fromEntries(results) as Record<string, 'ok' | 'fail'>;
    setProbes(next);
    setProbing(false);
    const responding = list.filter(p => next[p.name] === 'ok').map(p => p.name);
    if (responding.length > 0 && !responding.includes(current.port) && loadedRef.current) {
      save({ ...current, port: responding[0] });
      toast.success(`Impresora detectada en ${responding[0]} — responde a la prueba.`);
    }
  };

  const refreshPorts = () => {
    setScanning(true);
    Promise.all([
      api.listComPorts().catch(() => [] as ComPort[]),
      api.listWindowsPrinters().catch(() => [] as string[]),
    ])
      .then(([p, w]) => {
        setPorts(p);
        setWinPrinters(w);
        probePorts(p);
      })
      .finally(() => setScanning(false));
  };

  const hasBluetooth = ports.some(p => p.description.startsWith('Bluetooth'));

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      // 1) Cargar la config REAL primero; 2) recién entonces detectar puertos.
      // Antes la carga y el probe corrían en paralelo y el auto-save del probe
      // podía guardar los DEFAULTS encima de la config guardada (bug de borrado).
      loadedRef.current = false;
      try {
        const s = await api.getPrinterSettings();
        if (!alive) return;
        if (s) {
          setSettings(s);
          settingsRef.current = s;
          loadedRef.current = true;
        }
      } catch {
        // IPC frío fallido: settings quedan en default, auto-save bloqueado
      }
      if (alive) refreshPorts();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = (next: PrinterSettings) => {
    setSettings(next);
    settingsRef.current = next;
    api.setPrinterSettings(next.port, next.baud, next.width, next.windowsPrinter, next.businessName, next.businessLine, next.logo).catch(() => {});
  };

  const onLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      try {
        const W = 384, maxH = 240;
        const h = Math.max(1, Math.min(maxH, Math.round((W * img.height) / img.width)));
        const c = document.createElement('canvas');
        c.width = W;
        c.height = h;
        const g = c.getContext('2d');
        if (!g) return;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, W, h);
        g.drawImage(img, 0, 0, W, h);
        save({ ...settings, logo: c.toDataURL('image/png') });
        toast.success('Logo guardado. Se imprime en blanco y negro arriba del ticket.');
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error('No se pudo leer la imagen. Prueba con un PNG o JPG.');
    };
    img.src = url;
  };

  const rasterArgs = async () => {
    const widthPx = (settings.width ?? 58) >= 80 ? 576 : 384;
    if (!settings.logo) return { raster: undefined as number[] | undefined, rasterWidth: undefined as number | undefined };
    const raster = await logoToRaster(settings.logo, widthPx).catch(() => null);
    return raster && raster.length > 0 ? { raster, rasterWidth: widthPx } : { raster: undefined, rasterWidth: undefined };
  };

  const checkStatus = async () => {
    if (!settings.windowsPrinter) {
      toast.warning('Primero selecciona la impresora de Windows');
      return;
    }
    setCheckingStatus(true);
    setWStatus(null);
    try {
      const status = await api.getWindowsPrinterStatus(settings.windowsPrinter);
      setWStatus(status || 'Sin información');
    } catch (e) {
      setWStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingStatus(false);
    }
  };

  const testText = (target: string) => [
    settings.businessName?.trim() || 'SERVICIO TECNICO',
    settings.businessLine?.trim() || '',
    '='.repeat(printerWidthChars(settings.width)),
    `   PRUEBA DE IMPRESORA`,
    `   Ruta: ${target}`,
    '   Si ves este ticket el',
    '   equipo esta OK.',
    '   Fecha: ' + new Date().toLocaleString(),
  ].filter(Boolean).join('\n');

  const testPrint = async () => {
    const { raster, rasterWidth } = await rasterArgs();
    const terms = buildReceiptTerms(settings.width);
    if (settings.windowsPrinter) {
      setTesting(true);
      try {
        await api.printToWindowsPrinter(settings.windowsPrinter, testText('Windows'), terms, undefined, raster, rasterWidth);
        toast.success(`Prueba enviada a "${settings.windowsPrinter}". La impresora debe sacar un ticket.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setTesting(false);
      }
      return;
    }
    if (!settings.port) {
      toast.warning('Primero selecciona una impresora de Windows o un puerto COM');
      return;
    }
    setTesting(true);
    try {
      await api.printReceipt(settings.port, settings.baud, testText(settings.port), terms, undefined, raster, rasterWidth);
      toast.success('Prueba enviada. La impresora debe sacar un ticket.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-4" /> Impresora de tickets
          </DialogTitle>
          <DialogDescription>
            Elige la impresora instalada en Windows (driver, ej. HPRT MPT-II) o un puerto COM directo.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Impresora de Windows (driver instalado)</label>
            <Select value={settings.windowsPrinter} onValueChange={v => save({ ...settings, windowsPrinter: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Ninguna — usa la lista de la izquierda..." /></SelectTrigger>
              <SelectContent>
                {winPrinters.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No hay impresoras instaladas en Windows</div>
                )}
                {winPrinters.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Se imprime en ESC/POS crudo (RAW) — funciona con el driver oficial de tu impresora (ej. HPRT MPT-II).
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={checkStatus} disabled={checkingStatus}>
                <ShieldCheck className={`size-3.5 ${checkingStatus ? 'animate-pulse' : ''}`} />
                {checkingStatus ? 'Consultando...' : 'Verificar estado'}
              </Button>
              {wStatus && (
                <span className="text-xs text-muted-foreground">{wStatus}</span>
              )}
            </div>
          </div>

          <div className="border-t pt-3 flex flex-col gap-2">
            <label className="text-sm font-medium">Cabecera del ticket (orden de servicio)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input value={settings.businessName}
                onChange={e => setSettings({ ...settings, businessName: e.target.value })}
                onBlur={() => save(settings)}
                placeholder="Nombre del negocio" />
              <Input value={settings.businessLine}
                onChange={e => setSettings({ ...settings, businessLine: e.target.value })}
                onBlur={() => save(settings)}
                placeholder="Segunda línea (ej: nombre de la persona)" />
            </div>
            <p className="text-xs text-muted-foreground">
              Aparece arriba de la orden de servicio. Se guarda al salir del campo.
            </p>
          </div>

          <div className="border-t pt-3 flex flex-col gap-2">
            <label className="text-sm font-medium">Logo del ticket</label>
            <div className="flex items-center gap-3">
              {settings.logo ? (
                <img src={settings.logo} alt="Logo del ticket"
                  className="h-16 w-16 rounded-md border border-border bg-white object-contain p-0.5 [filter:grayscale(1)_contrast(150%)]" />
              ) : (
                <div className="h-16 w-16 rounded-md border border-dashed flex items-center justify-center text-center text-[10px] text-muted-foreground px-1">
                  Sin logo
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="size-3.5" /> Subir imagen
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => save({ ...settings, logo: makeTestLogoPng() })}>
                    <Sparkles className="size-3.5" /> Logo de prueba
                  </Button>
                  {settings.logo && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => save({ ...settings, logo: '' })}>
                      <Trash2 className="size-3.5" /> Quitar
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG o JPG. Se imprime en negro sobre blanco arriba de la cabecera (58 mm: 384 px de ancho).
                  "Logo de prueba" genera uno sin diseñar nada.
                </p>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogoFile} />
          </div>

          <div className="border-t pt-3 flex flex-col gap-2">
            <label className="text-sm font-medium">Puerto COM (alternativa USB/Bluetooth directa)</label>
            <div className="flex gap-2">
              <Select value={settings.port} onValueChange={v => save({ ...settings, port: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecciona un puerto..." /></SelectTrigger>
                <SelectContent>
                  {ports.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No hay puertos COM detectados</div>
                  )}
                  {ports.map(p => (
                    <SelectItem key={p.name} value={p.name}>
                      <span className="flex items-center gap-2">
                        {p.name}{p.description ? ` — ${p.description}` : ''}
                        {probes[p.name] === 'ok' && (
                          <Badge variant="outline" className="ml-auto bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Responde</Badge>
                        )}
                        {probes[p.name] === 'fail' && (
                          <Badge variant="outline" className="ml-auto bg-destructive/10 text-destructive border-destructive/30">Sin respuesta</Badge>
                        )}
                        {probing && !probes[p.name] && (
                          <span className="ml-auto text-xs text-muted-foreground animate-pulse">comprobando…</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={refreshPorts} disabled={scanning}>
                <RefreshCw className={`size-4 ${scanning ? 'animate-spin' : ''}`} /> Detectar
              </Button>
            </div>
            {hasBluetooth && (
              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Impresora Bluetooth:</span> si tu impresora
                (ej. MP58-04BLE) no aparece, parea el equipo en{' '}
                <span className="font-medium text-foreground">Configuración → Bluetooth y dispositivos</span>,
                enciéndela y pulsa Detectar. Debe aparecer con su nombre, ej. "COM7 — Bluetooth · MP58-04BLE".
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Velocidad (baudios) — solo puerto COM</label>
            <Select value={String(settings.baud)} onValueChange={v => save({ ...settings, baud: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BAUD_RATES.map(b => <SelectItem key={b} value={String(b)}>{b} baudios</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Ancho del papel</label>
            <ToggleGroup type="single" value={String(settings.width)}
              onValueChange={v => v && save({ ...settings, width: Number(v) })}>
              <ToggleGroupItem value="58" className="flex-1">58 mm</ToggleGroupItem>
              <ToggleGroupItem value="80" className="flex-1">80 mm</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3 flex items-center gap-2">
          <Button variant="outline" onClick={testPrint} disabled={testing}>
            {testing ? 'Imprimiendo...' : <><Printer className="size-4" /> Imprimir prueba</>}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
