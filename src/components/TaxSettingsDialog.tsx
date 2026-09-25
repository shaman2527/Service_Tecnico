import { useEffect, useState } from 'react';
import { Percent, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '../db';
import type { IvaConfig } from '@/lib/iva';
import { desgloseIva, modoLabel, alicuotaLabel } from '@/lib/iva';
import { redondearCentavos } from '@/lib/money';

/**
 * F74 — AJUSTES DEL IVA: prender/apagar, alícuota y modo (incluido o agregado).
 *
 * Pedido del dueño (2026-09-25): «incluye el IVA que se pueda activar o desactivar… que tome sus
 * centavos sincronizado con la tasa del día BCV». Acá se elige cómo se cobra; el desglose se ve EN
 * VIVO con un ejemplo y con la tasa del turno abierto, así el dueño ve exactamente los mismos números
 * que van a salir en la factura y en el arqueo.
 *
 * Es del DUEÑO (el backend lo exige con `require_owner`) y valida el backend: un modo desconocido o
 * una alícuota fuera de 0…100 se rechazan con su mensaje.
 */
export default function TaxSettingsDialog({ open, onClose, config, tasa = 0, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** La configuración vigente (la trae la pantalla que abre el diálogo). */
  config: IvaConfig;
  /** Tasa BCV del turno abierto (0 = no hay tasa: no se inventan equivalencias en Bs.). */
  tasa?: number;
  onSaved: (c: IvaConfig) => void;
}) {
  const [activo, setActivo] = useState(config.activo);
  const [modo, setModo] = useState<IvaConfig['modo']>(config.modo);
  const [alicuotaTxt, setAlicuotaTxt] = useState(String(config.alicuota).replace('.', ','));
  const [ejemplo, setEjemplo] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guardado, setGuardado] = useState(false);

  // Cada vez que se abre, el formulario arranca con lo que está guardado (no con lo último tecleado).
  useEffect(() => {
    if (!open) return;
    setActivo(config.activo);
    setModo(config.modo);
    setAlicuotaTxt(String(config.alicuota).replace('.', ','));
    setError(null);
    setGuardado(false);
  }, [open, config]);

  const alicuota = Number(alicuotaTxt.replace(',', '.'));
  const alicuotaOk = Number.isFinite(alicuota) && alicuota >= 0 && alicuota <= 100;
  const importe = Number(ejemplo.replace(',', '.'));
  const cfgVista: IvaConfig = { activo, alicuota: alicuotaOk ? alicuota : 0, modo };
  const d = desgloseIva(Number.isFinite(importe) ? importe : 0, cfgVista, { tasa });
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const guardar = async () => {
    if (saving) return;
    if (!alicuotaOk) { setError('La alícuota tiene que ser un número entre 0 y 100 (por ejemplo 16).'); return; }
    setSaving(true);
    setError(null);
    try {
      const g = await api.setTaxConfig(activo, redondearCentavos(alicuota), modo);
      onSaved({ activo: g.activo, alicuota: g.alicuota, modo: g.modo === 'agregado' ? 'agregado' : 'incluido' });
      setGuardado(true);
      setTimeout(() => onClose(), 700);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="size-4" /> IVA — cómo se cobra
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">¿El negocio cobra IVA?</label>
            <ToggleGroup type="single" value={activo ? 'si' : 'no'} data-field="iva-activo"
              onValueChange={v => { if (v) setActivo(v === 'si'); }}>
              <ToggleGroupItem value="no" data-iva-activo="no">Apagado</ToggleGroupItem>
              <ToggleGroupItem value="si" data-iva-activo="si">Activado</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground" data-field="iva-estado">
              {activo
                ? `El IVA está ACTIVO al ${alicuotaLabel(alicuotaOk ? alicuota : 0)} — ${modoLabel(modo).toLowerCase()}.`
                : 'El IVA está APAGADO: los precios se cobran tal cual están cargados en el catálogo.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Alícuota (%)</label>
              <Input inputMode="decimal" data-field="iva-alicuota" value={alicuotaTxt}
                onChange={e => setAlicuotaTxt(e.target.value)} placeholder="16" />
              <p className="text-[11px] text-muted-foreground">La general de Venezuela es 16%. 0 = exento.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Forma de cobro</label>
              <ToggleGroup type="single" value={modo} data-field="iva-modo"
                onValueChange={v => { if (v) setModo(v === 'agregado' ? 'agregado' : 'incluido'); }}>
                <ToggleGroupItem value="incluido" data-iva-modo="incluido">Ya viene en el precio</ToggleGroupItem>
                <ToggleGroupItem value="agregado" data-iva-modo="agregado">Se suma al cobrar</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {/* La cuenta EN VIVO: mismos números que van a la factura y al arqueo. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2" data-preview="iva">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Probá con un monto</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">$</span>
                <Input className="h-8 w-24" inputMode="decimal" data-field="iva-ejemplo" value={ejemplo}
                  onChange={e => setEjemplo(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Base</p>
                <p className="font-semibold" data-field="iva-base">${fmt(d.base)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  IVA {alicuotaLabel(d.activo ? d.alicuota : 0)}
                </p>
                <p className="font-semibold" data-field="iva-monto">${fmt(d.iva)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="font-semibold" data-field="iva-total">${fmt(d.total)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground" data-field="iva-bs">
              {d.bs
                ? `En bolívares (tasa del día ${fmt(tasa)}, con céntimos): base Bs. ${fmt(d.bs.base)} + IVA Bs. ${fmt(d.bs.iva)} = total Bs. ${fmt(d.bs.total)}${Math.abs(d.bsEfectivo - d.bs.total) > 0.005 ? ` · en efectivo Bs. ${fmt(d.bsEfectivo)}` : ""}`
                : 'Sin tasa BCV en el turno abierto no se muestran bolívares (se cargan al abrir el día).'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {d.activo
                ? (modo === 'agregado'
                  ? `El cliente paga $${fmt(d.total)} (el monto que cargás es la base, sin IVA).`
                  : `El cliente paga $${fmt(d.total)} y la factura desglosa $${fmt(d.base)} + $${fmt(d.iva)} de IVA.`)
                : 'Con el IVA apagado el total es exactamente el monto cargado.'}
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription data-field="iva-error">{error}</AlertDescription>
            </Alert>
          )}
          {guardado && !error && (
            <p className="text-sm text-success" data-field="iva-guardado">IVA guardado.</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="size-4" /> Cancelar
          </Button>
          <Button onClick={guardar} disabled={saving || !alicuotaOk} data-action="guardar-iva">
            <Save className="size-4" /> {saving ? 'Guardando…' : 'Guardar IVA'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
