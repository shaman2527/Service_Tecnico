import { desgloseIva, alicuotaLabel, type IvaConfig } from '@/lib/iva';

/**
 * F74 — LA LÍNEA DEL IVA que se ve mientras se carga un monto (venta o servicio).
 *
 * Muestra la MISMA cuenta que se va a guardar y a imprimir: con el IVA apagado no dice nada (no hay
 * ruido), y con el IVA activo dice base + IVA = total, si el cliente paga lo mismo o más, y la
 * equivalencia en bolívares con la tasa del turno (los céntimos salen de la regla pura `src/lib/iva.ts`,
 * la misma que usan el recibo y el libro del período).
 */
export default function IvaDesglose({ importe, cfg, tasa = 0, className = '', campo = 'iva-desglose' }: {
  /** El monto cargado (lo que el operario escribió, ya con el descuento aplicado si lo hay). */
  importe: number;
  cfg: IvaConfig;
  /** Tasa BCV del turno abierto (0 = no hay tasa: no se inventan bolívares). */
  tasa?: number;
  className?: string;
  campo?: string;
}) {
  const d = desgloseIva(importe, cfg, { tasa });
  if (!d.activo) return null;
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBs = (n: number) => `Bs. ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // F74 — EL IVA ES EN BOLÍVARES: la primera línea es la cuenta en Bs. con la TASA DEL TURNO (lo que
  // se le dice y se le cobra al cliente en el mostrador); el $ va entre paréntesis como verdad
  // contable (es el monto que se guarda, y el mismo que espera el arqueo).
  return (
    <div className={`text-[11px] text-muted-foreground ${className}`} data-field={campo}
      title={cfg.modo === 'agregado'
        ? 'El monto que cargaste es la BASE: al cobrar se le suma el IVA.'
        : 'El monto que cargaste YA trae el IVA: el cliente paga lo mismo y la factura lo desglosa.'}>
      {d.bs ? (
        <p className="font-medium text-foreground">
          {cfg.modo === 'agregado'
            ? <>IVA {alicuotaLabel(d.alicuota)}: {fmtBs(d.bs.base)} + {fmtBs(d.bs.iva)} = <span className="text-primary">Total {fmtBs(d.bs.total)}</span></>
            : <>Total {fmtBs(d.bs.total)} — IVA incluido {alicuotaLabel(d.alicuota)}: base {fmtBs(d.bs.base)} + IVA {fmtBs(d.bs.iva)}</>}
          <span className="font-normal text-muted-foreground"> (${fmt(d.total)} · tasa {fmt(d.tasa)})</span>
          {d.bs && Math.abs(d.bsEfectivo - d.bs.total) > 0.005 && (
            <span className="text-muted-foreground"> · en efectivo Bs. {fmt(d.bsEfectivo)}</span>
          )}
        </p>
      ) : (
        <p>
          {cfg.modo === 'agregado'
            ? <>Base ${fmt(d.base)} + IVA {alicuotaLabel(d.alicuota)} ${fmt(d.iva)} = <span className="font-medium text-foreground">Total a cobrar ${fmt(d.total)}</span></>
            : <>Total ${fmt(d.total)} — IVA incluido {alicuotaLabel(d.alicuota)}: base ${fmt(d.base)} + IVA ${fmt(d.iva)}</>}
          <span className="text-amber-600"> · sin tasa BCV del turno no se puede cobrar en Bs.</span>
        </p>
      )}
    </div>
  );
}
