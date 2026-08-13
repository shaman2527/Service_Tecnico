import { useEffect, useState } from 'react';
import { Printer, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { buildReceiptTerms, buildServiceReceiptParts, logoToRaster } from '@/lib/utils';
import { toast } from 'sonner';
import type { PrinterSettings, Service, ServicePayment, ComPort } from '../types';
import { DEFAULT_PRINTER_SETTINGS } from '../types';
import PrinterSettingsDialog from './PrinterSettingsDialog';

export default function PrintReceiptDialog({ serviceId, open, onOpenChange, onPrinted }: {
  serviceId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPrinted?: () => void;
}) {
  const [service, setService] = useState<Service | null>(null);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [printing, setPrinting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!open || !serviceId) return;
    let alive = true;
    Promise.all([
      api.getService(serviceId),
      api.getServicePayments(serviceId),
      api.getPrinterSettings(),
    ]).then(([s, p, st]) => {
      if (!alive) return;
      setService(s);
      setPayments(p);
      setSettings(st);
    }).catch(() => {});
    return () => { alive = false; };
  }, [open, serviceId]);

  // Primera copia (cliente) + talón recortable; los términos legales en letra
  // pequeña (font B) se imprimen ENTRE ambos — quedan en la primera copia,
  // antes de cortar el talón.
  const { main, stub } = buildServiceReceiptParts(service, payments, {
    width: settings.width,
    businessName: settings.businessName,
    businessLine: settings.businessLine,
  });
  const terms = buildReceiptTerms(settings.width);

  const markPrinted = async () => {
    if (!serviceId) return;
    try {
      await api.markServicePrinted(serviceId);
      onPrinted?.();
    } catch { /* el badge es informativo, no bloquea */ }
  };

  // Al cerrar el dialog de configuración se recarga la config guardada:
  // antes quedaba stale y "Imprimir" iba al puerto/impresora VIEJOS.
  const closeSettings = async (o: boolean) => {
    setShowSettings(o);
    if (!o) {
      try {
        const st = await api.getPrinterSettings();
        if (st) setSettings(st);
      } catch { /* mantiene la config actual */ }
    }
  };

  // Fallback tras fallo de impresión: Windows puede reasignar el número de COM
  // entre reinicios (COM7 → COM5). Si el puerto guardado ya no responde, se
  // detecta el que sí responde y se reconfigura automáticamente.
  const tryAutoDetect = async (args: { raster?: number[]; rasterWidth?: number }) => {
    setPrinting(true);
    try {
      const ports = await api.listComPorts().catch(() => [] as ComPort[]);
      let responding: string[] = [];
      if (ports.length > 0) {
        const results = await Promise.all(ports.map(async p => {
          try { await api.probeComPort(p.name, settings.baud); return p.name; } catch { return null; }
        }));
        responding = results.filter((r): r is string => r !== null);
      }
      if (responding.length === 0) return false;
      const target = responding.includes(settings.port) ? settings.port : responding[0];
      await api.printReceipt(target, settings.baud, main, terms, stub, args.raster, args.rasterWidth);
      if (target !== settings.port) {
        api.setPrinterSettings(target, settings.baud, settings.width, settings.windowsPrinter, settings.businessName, settings.businessLine, settings.logo)
          .catch(() => {});
        setSettings(s => ({ ...s, port: target }));
        toast.success(`Impresora detectada en ${target} — puerto actualizado automáticamente.`);
      } else {
        toast.success('Orden enviada a la impresora');
      }
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return true; // error ya informado — no repetir el original
    } finally {
      setPrinting(false);
    }
  };

  const doPrint = async () => {
    const widthPx = (settings.width ?? 58) >= 80 ? 576 : 384;
    const raster = settings.logo ? await logoToRaster(settings.logo, widthPx).catch(() => null) : null;
    const printArgs = raster && raster.length > 0 ? { raster, rasterWidth: widthPx } : {};
    if (settings.windowsPrinter) {
      setPrinting(true);
      try {
        await api.printToWindowsPrinter(settings.windowsPrinter, main, terms, stub, printArgs.raster, printArgs.rasterWidth);
        await markPrinted();
        toast.success(`Orden enviada a "${settings.windowsPrinter}"`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setPrinting(false);
      }
      return;
    }
    if (!settings.port) {
      toast.warning('No hay impresora configurada. Selecciona la impresora o el puerto COM.');
      setShowSettings(true);
      return;
    }
    setPrinting(true);
    try {
      await api.printReceipt(settings.port, settings.baud, main, terms, stub, printArgs.raster, printArgs.rasterWidth);
      await markPrinted();
      toast.success('Orden enviada a la impresora');
    } catch (firstErr) {
      const ok = await tryAutoDetect(printArgs);
      if (ok) await markPrinted();
      else toast.error(firstErr instanceof Error ? firstErr.message : String(firstErr));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Printer className="size-4" /> Orden de servicio {service?.order_num ? `· ${service.order_num}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/50 p-4 flex flex-col items-center gap-2">
            {settings.logo && (
              <img src={settings.logo} alt="Logo del ticket"
                className="max-h-24 w-auto rounded bg-white p-1 object-contain [filter:grayscale(1)_contrast(150%)]" />
            )}
            <div className="bg-white text-black rounded-md shadow-lg px-3 py-4 font-mono text-[11px] leading-[1.45] whitespace-pre-wrap break-words w-fit max-w-full">
              {main || 'Cargando orden de servicio...'}
              {terms && (
                <span className="block mt-2 text-[8px] leading-[1.35]">{terms}</span>
              )}
              {stub && (
                <span className="block mt-2">{stub}</span>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t pt-3 flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowSettings(true)}>
              <Settings2 className="size-4" /> Configurar impresora
            </Button>
            <Button onClick={doPrint} disabled={printing}>
              <Printer className="size-4" /> {printing ? 'Imprimiendo...' : 'Imprimir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrinterSettingsDialog open={showSettings} onOpenChange={closeSettings} />
    </>
  );
}