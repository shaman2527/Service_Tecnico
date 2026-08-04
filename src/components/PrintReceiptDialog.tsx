import { useEffect, useState } from 'react';
import { Printer, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { buildServiceReceipt } from '@/lib/utils';
import { toast } from 'sonner';
import type { PrinterSettings, Service, ServicePayment } from '../types';
import PrinterSettingsDialog from './PrinterSettingsDialog';

export default function PrintReceiptDialog({ serviceId, open, onOpenChange }: {
  serviceId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [service, setService] = useState<Service | null>(null);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [settings, setSettings] = useState<PrinterSettings>({ port: '', baud: 9600, width: 58 });
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

  const receipt = buildServiceReceipt(service, payments, { width: settings.width });

  const doPrint = async () => {
    if (!settings.port) {
      toast.warning('No hay impresora configurada. Selecciona el puerto COM.');
      setShowSettings(true);
      return;
    }
    setPrinting(true);
    try {
      await api.printReceipt(settings.port, settings.baud, receipt);
      toast.success('Factura enviada a la impresora');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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
              <Printer className="size-4" /> Factura {service?.order_num ? `· ${service.order_num}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/50 p-4 flex justify-center">
            <div className="bg-white text-black rounded-md shadow-lg px-3 py-4 font-mono text-[11px] leading-[1.45] whitespace-pre-wrap break-words w-fit max-w-full">
              {receipt || 'Cargando factura...'}
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

      <PrinterSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </>
  );
}