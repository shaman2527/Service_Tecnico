import { useEffect, useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { printerWidthChars } from '@/lib/utils';
import { toast } from 'sonner';
import type { ComPort, PrinterSettings } from '../types';

const BAUD_RATES = [9600, 19200, 38400, 115200];

export default function PrinterSettingsDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [ports, setPorts] = useState<ComPort[]>([]);
  const [settings, setSettings] = useState<PrinterSettings>({ port: '', baud: 9600, width: 58 });
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);

  const refreshPorts = () => {
    setScanning(true);
    api.listComPorts()
      .then(setPorts)
      .finally(() => setScanning(false));
  };

  const hasBluetooth = ports.some(p => p.description.startsWith('Bluetooth'));

  useEffect(() => {
    if (!open) return;
    api.getPrinterSettings().then(setSettings).catch(() => {});
    refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = (next: PrinterSettings) => {
    setSettings(next);
    api.setPrinterSettings(next.port, next.baud, next.width).catch(() => {});
  };

  const testPrint = async () => {
    if (!settings.port) {
      toast.warning('Primero selecciona el puerto COM de la impresora');
      return;
    }
    setTesting(true);
    const testText = [
      'REGISTRO · SERVICIO TECNICO',
      '='.repeat(printerWidthChars(settings.width)),
      '   PRUEBA DE IMPRESORA',
      '   Si ves este ticket el',
      '   puerto esta OK.',
      '   Fecha: ' + new Date().toLocaleString(),
    ].join('\n');
    try {
      await api.printReceipt(settings.port, settings.baud, testText);
      toast.success('Prueba enviada. La impresora debe sacar un ticket.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-4" /> Impresora de tickets
          </DialogTitle>
          <DialogDescription>
            Puerto COM donde está tu impresora térmica — por USB o Bluetooth. Se detecta automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Puerto COM</label>
            <div className="flex gap-2">
              <Select value={settings.port} onValueChange={v => save({ ...settings, port: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecciona un puerto..." /></SelectTrigger>
                <SelectContent>
                  {ports.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No hay puertos COM detectados</div>
                  )}
                  {ports.map(p => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}{p.description ? ` — ${p.description}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={refreshPorts} disabled={scanning}>
                <RefreshCw className={`size-4 ${scanning ? 'animate-spin' : ''}`} /> Detectar
              </Button>
            </div>
            {ports.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Conecta la impresora por USB y pulsa Detectar, o parea tu impresora Bluetooth en Windows
                (ver ayuda abajo). Si no aparece, revisa el cable y reinicia la impresora.
              </p>
            )}
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
            <label className="text-sm font-medium">Velocidad (baudios)</label>
            <Select value={String(settings.baud)} onValueChange={v => save({ ...settings, baud: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BAUD_RATES.map(b => <SelectItem key={b} value={String(b)}>{b} baudios</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">La mayoría de impresoras térmicas usan 9600. Si sale basura o cortado, prueba con otra velocidad.</p>
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

        <DialogFooter className="flex items-center gap-2">
          <Button variant="outline" onClick={testPrint} disabled={testing}>
            {testing ? 'Imprimiendo...' : <><Printer className="size-4" /> Imprimir prueba</>}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}