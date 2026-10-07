import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, ShieldCheck, Trash2, Lock, CheckCircle2, Banknote, User, Smartphone, CalendarDays, Wrench, Clock, Check, Users, UserPlus, Printer, Undo2, AlertTriangle, Zap, Camera, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api } from '../db';
import { toast } from 'sonner';
import PaymentDialog from './PaymentDialog';
import RefundDialog from './RefundDialog';
import CierreServiceDialog from './CierreServiceDialog';
// F30: cola de entregas (F4) — buscar la orden por cédula/teléfono/nombre sin recorrer la lista.
import CierreQueueDialog from './CierreQueueDialog';
import PrintReceiptDialog from './PrintReceiptDialog';
import PrinterSettingsDialog from './PrinterSettingsDialog';
import { ModelCombobox } from './ModelCombobox';
// F31: selector de método de pago compartido (3 favoritos a un toque + el resto en un desplegable)
import { PaymentMethodPicker } from './PaymentMethodPicker';
import { useDataVersion } from '@/lib/use-data-version';
// F74 — el IVA: la configuración (prender/apagar, alícuota, modo) y la línea de desglose que se ve
// mientras se carga el monto. La cuenta vive en la regla pura src/lib/iva.ts.
import { parseIvaConfig, ivaActivo, totalACobrar, IVA_DEFAULT, type IvaConfig } from '@/lib/iva';
// F79 — el cobro DENTRO del wizard: la etiqueta y el estado del dinero salen de una regla pura
// (con pruebas en tools/wizard_cobro_test.ts), nunca de cuentas escritas en el formulario.
import { etiquetaCobro, ayudaCobro, estadoCobro, avisoOrdenGuardada, avisoEquiposFijos, avisoMontoSinGuardar, avisoMontoPendiente, type EstadoCobro } from '@/lib/wizard-cobro';
import IvaDesglose from './IvaDesglose';
// F32: recordatorios de política (foto / pago) y panel de los teléfonos entregados hoy. Las reglas
// viven en módulos puros con pruebas (lib/service-guide, lib/reminders): acá solo se conectan.
// F33: el asistente de recepción es la FICHA DE INGRESO (dentro del formulario, compacta) — se
// quitó el aviso flotante al registrar porque tapaba lo que el operario estaba escribiendo.
import { FichaIngreso } from './FichaIngreso';
import { firePolicyReminders } from './policy-actions';
import { PolicyModalHost } from './PolicyModal';
import DiscountDialog from './DiscountDialog';
// F80: el lápiz de la ficha del repuesto (precio, stock y compatibilidad) sin salir del wizard.
import { EditarProductoDialog } from './EditarProductoDialog';import { EntregadosHoy } from './EntregadosHoy';
import { buildFicha } from '@/lib/ficha';
import { nextStep, DEFAULT_NEW_STATUS, isCreatableStatus, photoOutIsCurrent, needsTechnician } from '@/lib/service-guide';
// F81 — EL PREDETERMINADO DE LOS FILTROS es una regla de negocio, no un detalle de pantalla: el
// estado en el que la orden recién REGISTRADA se ve (sin búsqueda, «Todos los estados», eje
// Recibidos, sin rango y sin chip de trabajo). Vive en un módulo puro con pruebas
// (`tools/service_filters_test.ts`) para que la pantalla no tenga seis `useState('')` sueltos.
import { DEFAULT_SERVICE_FILTERS, clearServiceFilters, resetFiltersForNewOrder, type ServiceFilters } from '@/lib/service-filters';
// F82 — LA CAJA DEL DÍA ANTERIOR SIN CERRAR: la regla y el texto salen del módulo puro
// `lib/day-shift` (con pruebas) y el aviso es el MISMO cartel en Ventas, Servicio Técnico y Pedidos.
import { shiftPending, turnoViejoTexto, fechaLegible, type TurnoViejo } from '@/lib/day-shift';
import { TurnoViejoBanner } from './TurnoViejoBanner';
import { deliverReminders, receiveReminders, payIntentLabel, isDelivered } from '@/lib/reminders';
// Piezas compartidas con el asistente de cierre (Harness F30): el stepper del wizard y la
// elección de la pantalla exacta viven en archivos propios para no tener dos copias.
import { FormStepper } from './FormStepper';
import { ScreenSelect, useCompatibleProducts } from './ScreenPicker';
import { autoScreen, onlyScreens, screenOk } from '@/lib/screen-rules';
// F69: qué puede tocar cada sesión (una sola regla, probada en `tools/session_test.ts`)
import { abilities } from '@/lib/session';
// F67: EL PRECIO DEL REPUESTO. Pedido del dueño: «cuando yo seleccione una pantalla [que] pueda tomar
// el precio de venta de ese producto, o se puede seguir usando también el que tengo al lado de
// modelos». Las dos ofertas salen de UNA regla pura (`lib/screen-price.ts`, probada sin navegador):
// la pantalla elegida manda y el grupo de repuestos del modelo es el respaldo.
import { amountTypedPatch, groupPriceFields, priceFields, pricePatch, priceSource, sameMoney } from '@/lib/screen-price';
import type { PriceFields, PriceSource } from '@/lib/screen-price';
import { updateOrderKeepingFields } from '@/lib/service-update';
// F38: el saldo se dice en la moneda en que se cobró (+ equivalencia del día). Regla pura con test node.
import { orderBalance, balanceLabel } from '@/lib/order-balance';
import { DEFAULT_PUNTO_FEE } from '@/lib/payment-math';
// F44: TRABAJOS HECHOS — los contadores de la lista cuentan LO QUE SE ESTÁ VIENDO (entregados
// incluidos) con la misma regla que el filtro, y la línea de alcance dice sobre qué se cuenta.
// F56: el RESUMEN DEL DÍA (recibidos hoy / entregados hoy / qué trabajos se hicieron) sale del
// MISMO módulo, con su propio alcance, para que no existan dos conteos distintos.
// Reglas puras con prueba node (`tools/service_report_test.ts`).
import { ACTIVE_SENTINEL, matchesWorkFilter, scopeLabel, scopeProblem, serviceReport, rangeFor, scopeSummary, summaryScopeLabel, topWorks } from '@/lib/service-report';
import type { ScopeInput, ScopeKind } from '@/lib/service-report';
// F57: el filtro de trabajos es UN solo selector con buscador (adiós al muro de 49 chips).
import { WorkPicker } from './WorkPicker';
import { useEscapeGuard } from './use-escape-guard';
// F58: la tabla de equivalencias de etiquetas («bateria» → «Cambio batería») es una sola, revisable,
// y se aplica al contar, al filtrar y al GUARDAR (así no nacen sinónimos nuevos).
import { canonicalWorkLabel, foldWork } from '@/lib/work-aliases';

/** F58: etiqueta canónica si lo escrito en «Otro» es un sinónimo aprobado; `null` si no lo es. */
const aliasDeTrabajo = (texto: string): string | null => {
  const { label, cambiado } = canonicalWorkLabel(texto ?? '');
  return cambiado ? label : null;
};

/**
 * F58: agrega a la orden el trabajo escrito en «Otro», ya normalizado y SIN repetir. Si el operario
 * ya tiene elegido el chip del mismo trabajo, no se agrega otra vez: se imprimiría dos veces en el
 * recibo y React dibujaría dos badges con la misma clave (observación de la re-revisión).
 */
const agregarTrabajoDeOtro = (arr: string[], texto: string): void => {
  const etiqueta = canonicalWorkLabel(texto).label;
  if (!etiqueta) return;
  const clave = foldWork(etiqueta);
  if (!arr.some(t => foldWork(t) === clave)) arr.push(etiqueta);
};
import { cn, methodCurrency, currencySymbol, warrantyEnd, warrantyStatus, CHECKLIST_ITEMS, checklistDefaults, parseChecklist, checklistSummary, SERVICE_TYPES, parseServiceTypes, partLabel, initialsOf, titleCase, isRefund, isFinalized, shortMethodLabel, localDate, addDays } from '@/lib/utils';
import type { Service, ServicePayment, ServiceStatus, Product, Client, Technician, ServiceDeviceInput, ScreenCandidate, Category } from '../types';

// Paleta de colores de técnicos (clases Tailwind) — la misma lista en el dialog de gestión
const TECH_COLORS = ['bg-purple-500', 'bg-blue-500', 'bg-green-600', 'bg-amber-500', 'bg-pink-500', 'bg-cyan-500', 'bg-red-500', 'bg-orange-500'];

function colorLabel(c: string): string {
  const map: Record<string, string> = {
    'bg-purple-500': 'Morado', 'bg-blue-500': 'Azul', 'bg-green-600': 'Verde',
    'bg-amber-500': 'Ámbar', 'bg-pink-500': 'Rosa', 'bg-cyan-500': 'Cian',
    'bg-red-500': 'Rojo', 'bg-orange-500': 'Naranja', 'bg-slate-500': 'Gris'
  };
  return map[c] ?? c;
}

function isMovilOrZelle(m: string | null | undefined): boolean {
  return !!m && (m.includes('Móvil') || m.includes('Movil') || m.includes('Zelle'));
}

// Estados "en taller": el equipo aún no se entrega
const ACTIVE_STATUSES = ['Recibido', 'En reparación', 'Esperando repuesto', 'Reparado / Pendiente Pago', 'Por entregar'];

function SectionTitle({ step, title, tone = 'primary' }: { step: number; title: string; tone?: 'primary' | 'orange' }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
        tone === 'orange' ? 'bg-orange-500/10 text-orange-600' : 'bg-primary/10 text-primary')}>
        {step}
      </span>
      <h3 className={cn('text-xs font-semibold uppercase tracking-wider',
        tone === 'orange' ? 'text-orange-700' : 'text-muted-foreground')}>{title}</h3>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}

function TechniciansDialog({ open, technicians, onOpenChange, onChanged }: {
  open: boolean;
  technicians: Technician[];
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Technician[]>([]);
  const [newName, setNewName] = useState('');
  const [newInitials, setNewInitials] = useState('');
  const [newColor, setNewColor] = useState(TECH_COLORS[2]);
  const [newInitTouched, setNewInitTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setRows(technicians);
      setError(null);
    }
  }, [open, technicians]);

  const saveRow = async (t: Technician) => {
    setSavingId(t.id);
    setError(null);
    try {
      await api.updateTechnician(t.id, t.name.trim(), t.initials.trim(), t.color);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const deleteRow = async (t: Technician) => {
    setSavingId(t.id);
    setError(null);
    try {
      await api.deleteTechnician(t.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const addRow = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await api.addTechnician(name, (newInitials.trim() || initialsOf(name)), newColor);
      setNewName('');
      setNewInitials('');
      setNewInitTouched(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const patchRow = (id: number, patch: Partial<Technician>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* F86 (REQ-8/AC-11) — patrón de la casa: la lista de técnicos crece y el pie quedaba fuera de
          la pantalla en la ventana de 750 px de alto. */}
      <DialogContent className="sm:max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2"><Users className="size-4" /> Técnicos</DialogTitle>
        </DialogHeader>
        {/* El cuerpo scrolleable es la lista de técnicos: el aviso y el error quedan FIJOS arriba y
            abajo (con `shrink-0`), así no se los come el recorte del diálogo. */}
        <p className="shrink-0 text-sm text-muted-foreground">
          La marca de color + iniciales identifica quién reparó cada equipo. Los cambios se guardan al salir del campo.
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
          {rows.map(t => (
            <div key={t.id} className="flex items-center gap-2">
              <span className={cn('size-4 shrink-0 rounded-full', t.color)} />
              <Input className="flex-1" value={t.name}
                disabled={savingId === t.id}
                onChange={e => patchRow(t.id, { name: e.target.value })}
                onBlur={() => saveRow(t)} />
              <Input className="w-14 text-center" value={t.initials} maxLength={3}
                disabled={savingId === t.id}
                onChange={e => patchRow(t.id, { initials: e.target.value })}
                onBlur={() => saveRow(t)} />
              <Select value={t.color} onValueChange={v => { patchRow(t.id, { color: v }); saveRow({ ...t, color: v }); }}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TECH_COLORS.map(c => (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2"><span className={cn('inline-block size-3 rounded-full', c)} />{colorLabel(c)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" disabled={savingId === t.id}
                title="Eliminar técnico (los servicios conservan el nombre)"
                onClick={() => deleteRow(t)}>
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-border/70 pt-3">
            <span className={cn('size-4 shrink-0 rounded-full', newColor)} />
            <Input className="flex-1" placeholder="Nombre (ej. Luis)" value={newName}
              onChange={e => {
                setNewName(e.target.value);
                if (!newInitTouched) setNewInitials(initialsOf(e.target.value));
              }} />
            <Input className="w-14 text-center" placeholder="Ini" value={newInitials} maxLength={3}
              onChange={e => { setNewInitials(e.target.value); setNewInitTouched(true); }} />
            <Select value={newColor} onValueChange={setNewColor}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TECH_COLORS.map(c => (
                  <SelectItem key={c} value={c}>
                    <span className="flex items-center gap-2"><span className={cn('inline-block size-3 rounded-full', c)} />{colorLabel(c)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={addRow} disabled={!newName.trim()}>
              <Plus className="size-4" /> Añadir
            </Button>
          </div>
        </div>
        {error && <p className="shrink-0 text-sm text-danger">{error}</p>}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnpaidBanner({ neverPaid, balance, amount, paid, saldoTexto }: {
  neverPaid: boolean;
  balance: number;
  amount: number;
  paid: number;
  /** F38: el saldo en la moneda del cobro (+ equivalencia). Lo calcula la tarjeta (tiene los pagos
   *  y la tasa del turno); acá solo se muestra, para que el cartel no diga una cifra distinta. */
  saldoTexto?: string;
}) {
  const pct = amount > 0.005 ? Math.min(100, Math.max(0, (paid / amount) * 100)) : 0;
  return (
    <Alert className="border-destructive/25 bg-gradient-to-b from-destructive/10 to-destructive/5 shadow-sm [&>svg]:hidden">
      <AlertDescription className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive text-white shadow-sm">
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <AlertTitle className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-destructive">
            {neverPaid ? 'Sin pagar' : 'Saldo pendiente'}
          </AlertTitle>
          <p className="text-sm leading-tight text-foreground">
            <span className="font-bold text-destructive">Falta {saldoTexto ?? `$${balance.toFixed(2)}`}</span>
            {!neverPaid && (
              <span className="text-muted-foreground"> de ${amount.toFixed(2)}</span>
            )}
          </p>
        </div>
        {!neverPaid && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-[10px] font-semibold text-muted-foreground">Abonado ${paid.toFixed(2)}</span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-destructive/15">
              <div className="h-full rounded-full bg-destructive" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * F56 — Tile del «Resumen del día». Es un BOTÓN: al tocarlo el alcance del resumen se aplica a la
 * lista (el dueño quiere «cuántas pantallas hoy» y, de un toque, las tarjetas de esas pantallas).
 * Los tonos siguen el diccionario de la pantalla: azul = entró, verde = salió, ámbar = en taller.
 */
function ResumenTile({ id, titulo, valor, sub, tono, onClick, kpi, cargando = false }: {
  id: string;
  titulo: string;
  valor: number;
  sub: string;
  tono: 'azul' | 'verde' | 'ambar' | 'neutro';
  onClick: () => void;
  kpi?: string;
  /** true = los totales todavía no se pudieron leer: se muestra «—», NUNCA un cero que mienta. */
  cargando?: boolean;
}) {
  const clases = {
    azul: { borde: 'border-blue-500/30 bg-blue-500/5', num: 'text-blue-700', icono: 'text-blue-600' },
    verde: { borde: 'border-emerald-500/30 bg-emerald-500/5', num: 'text-emerald-700', icono: 'text-emerald-600' },
    ambar: { borde: 'border-amber-500/30 bg-amber-500/5', num: 'text-amber-700', icono: 'text-amber-600' },
    neutro: { borde: '', num: '', icono: 'text-muted-foreground' },
  }[tono];
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      title={`Ver en la lista: ${titulo.toLowerCase()}`}
      className={cn('cursor-pointer transition-shadow hover:shadow-md', clases.borde)}
      data-resumen={id}
      data-resumen-count={cargando ? undefined : valor}
      data-kpi={kpi}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className={clases.icono}><Smartphone className="size-3.5" /></span> {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className={cn('text-2xl font-bold', clases.num)}>{cargando ? '—' : valor}</div>
        <p className="text-[11px] text-muted-foreground">{cargando ? 'leyendo los totales…' : sub}</p>
      </CardContent>
    </Card>
  );
}

/**
 * F81 — LA ORDEN QUE ACABA DE NACER. Es lo que el wizard devuelve al padre al guardar un ALTA para
 * que la lista la resalte y baje hasta ella: `base` es el número de la orden (el del equipo 1),
 * `ids` las filas REALMENTE guardadas (una por equipo) y `groupId` el grupo cuando la recepción
 * llevó 2+ equipos. Se arma con las filas que devolvió el backend, nunca con el formulario.
 */
type NuevaOrden = { base: string; ids: number[]; groupId: string | null };

/** Arma el dato del resaltado con las filas guardadas. */
const nuevaOrdenDe = (filas: Service[], base: string): NuevaOrden => ({
  base,
  ids: filas.map(r => r.id),
  groupId: filas.find(r => r.group_id)?.group_id ?? null,
});

export default function Services({ role = 'owner', onGoToLedger }: {
  role?: 'owner' | 'cashier';
  /** F82: llevar al Libro Diario → Cierres (el remedio de la caja del día anterior sin cerrar). */
  onGoToLedger?: () => void;
}) {
  // F69 — QUÉ PUEDE TOCAR ESTA SESIÓN (regla pura `src/lib/session.ts`): la caja recibe equipos,
  // cobra y entrega; la impresora, el padrón de técnicos y la lista de trabajos del local son del
  // dueño (el backend los rechaza con `require_owner`), así que la pantalla no los ofrece.
  const ab = abilities(role === 'owner' ? 'master' : 'caja');
  const [services, setServices] = useState<Service[]>([]);
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
  const [search, setSearch] = useState(DEFAULT_SERVICE_FILTERS.search);
  // F44 (pedido del dueño: «el filtro predeterminado debería ser todos los estados, el que tengo
  // actual es activos en taller, no debería ser ese»): `''` = TODOS LOS ESTADOS. Antes la lista
  // abría con el sentinel `__activos__` y, como lo entregado no está activo, el mostrador abría en
  // una lista vacía (en la base real las 4 órdenes son Entregado/Devuelto) justo cuando el cliente
  // pregunta «¿cuántas pantallas hiciste?». El eje Recibidos/Entregados sigue igual: con el eje de
  // ENTREGA una orden sin `date_out` no entra por sí sola, así que ya no hace falta forzar el estado.
  const [statusFilter, setStatusFilter] = useState(DEFAULT_SERVICE_FILTERS.statusFilter);
  // F32: eje del rango de fechas — 'in' recibidos (histórico) · 'out' ENTREGADOS (permite
  // «entregados hoy», que con el eje de recibido era imposible de ver).
  const [dateField, setDateField] = useState<'in' | 'out'>(DEFAULT_SERVICE_FILTERS.dateField);
  const [typeFilter, setTypeFilter] = useState(DEFAULT_SERVICE_FILTERS.typeFilter);
  const [dateStart, setDateStart] = useState(DEFAULT_SERVICE_FILTERS.dateStart);
  const [dateEnd, setDateEnd] = useState(DEFAULT_SERVICE_FILTERS.dateEnd);
  /**
   * ¿La lista está SIN filtros de servidor? (el resumen reusa sus filas en ese caso: son toda la
   * base y no hace falta otra lectura). Se calcula acá arriba porque el efecto del resumen lo usa.
   */
  const listaSinFiltros = !search && !statusFilter && !dateStart && !dateEnd;
  // F32: teléfonos entregados HOY (fecha de entrega), para el panel y el KPI del dueño.
  const [entregadosHoy, setEntregadosHoy] = useState<Service[]>([]);
  // F56: RESUMEN DEL DÍA. Se calcula sobre TODA la base (su propio alcance), no sobre la lista
  // filtrada: si el operario dejó la lista en «Entregado + agosto», el número de HOY tiene que
  // seguir siendo el de hoy. `resumenVersion` se sube solo cuando CAMBIAN LOS DATOS (guardar,
  // borrar, entregar): el buscador y los filtros no vuelven a pedir la base entera.
  const [resumenRows, setResumenRows] = useState<Service[]>([]);
  const [resumenVersion, setResumenVersion] = useState(0);
  const [resumenKind, setResumenKind] = useState<ScopeKind | 'filtros'>('hoy');
  // Revisión adversarial (mayor): un fallo de lectura NO puede parecer «un día sin movimiento». Con
  // esto la pantalla distingue cargando / ok / error y no pinta ceros diciendo «todavía no se recibió
  // ningún equipo hoy» mientras la lista de abajo sí muestra las órdenes del día.
  const [resumenEstado, setResumenEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');
  // Secuencia de la consulta del resumen: si llega tarde una respuesta vieja, se descarta (no pisa
  // los datos nuevos).
  const resumenSeq = useRef(0);
  /** ¿Ya se leyeron los totales alguna vez? (para no parpadear a «Leyendo…» en cada refresco) */
  const hayResumen = useRef(false);
  /**
   * Con qué filtros se trajeron las filas de `services` (observación de la re-revisión): entre que
   * el operario limpia un filtro y llega la lista nueva, `services` sigue siendo la lista FILTRADA —
   * y el resumen no puede calcular sobre el conjunto equivocado. Se reusa `services` SOLO si la
   * firma coincide.
   */
  const firmaFiltros = useRef('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [payFor, setPayFor] = useState<Service | null>(null);
  const [refundFor, setRefundFor] = useState<Service | null>(null);
  // F30: asistente de cierre (pide solo lo que falta para entregar la orden)
  const [cierreFor, setCierreFor] = useState<Service | null>(null);
  // F49: descuento rápido del servicio (el botón que reemplazó al «Cerrar» de la tarjeta)
  const [discountFor, setDiscountFor] = useState<Service | null>(null);
  // F30: cola de entregas — se abre con F4 y elige la orden a cerrar
  const [showQueue, setShowQueue] = useState(false);
  const [printFor, setPrintFor] = useState<Service | null>(null);
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [delivering, setDelivering] = useState<Service | null>(null);
  const [confirmDeliver, setConfirmDeliver] = useState<Service | null>(null);
  const [dayOpen, setDayOpen] = useState<boolean | null>(null);
  // Tasa del turno abierto: con ella se muestra la equivalencia en Bs. del saldo (F38).
  const [tasaDia, setTasaDia] = useState(0);
  // F82 — la fecha del turno abierto y el veredicto de la regla pura (¿es de otro día?).
  const [fechaTurno, setFechaTurno] = useState<string | null>(null);
  const turnoViejo = shiftPending(fechaTurno, localDate());
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  // F62: las categorías de trabajo que AGREGA EL LOCAL (settings work_types_extra). Se cargan una
  // vez y se usan en los chips del formulario, en el selector de trabajos y en el resumen.
  // F76 — la versión de los datos (sube con cada escritura de la app).
  const dataVersion = useDataVersion();
  const [tiposExtra, setTiposExtra] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── F81 — EL PREDETERMINADO, EL RESET DEL ALTA Y LA TARJETA NUEVA ────────────────────────────
  // Pedido del dueño (2026-09-27): «cuando escribo en el filtro, en servicio, y cuando vaya a
  // registrar un servicio nuevo el filtro automáticamente se ponga sin filtro predeterminado, se
  // borre la búsqueda, porque a veces cuando creo un servicio y tiene un filtro activado me confunde
  // la card: debería aparecerme el servicio que acabe de registrar». Tres piezas:
  //   1. `abrirAlta()` — ÚNICA puerta del alta (botón «Nuevo Servicio» y atajo N/F2): los filtros
  //      vuelven al predeterminado COMPLETO (regla pura `lib/service-filters`, con pruebas), así la
  //      orden nueva —que todavía no tiene `date_out`— no puede quedar escondida por el eje
  //      «Entregados» (el caso que lo confundía: «Entregados hoy» deja estado=Entregado + eje=out).
  //   2. Si el wizard se cierra SIN registrar nada, los filtros que había VUELVEN: un N apretado sin
  //      querer no le borra la búsqueda al operario.
  //   3. Al guardar, la orden creada se marca (`nuevaOrden`) → tarjeta resaltada + la lista baja
  //      hasta ella. Se apaga sola (8 s) y con el primer cambio de filtro: nunca queda mintiendo.

  /** La orden recién creada que hay que resaltar (y a la que hay que bajar). */
  const [nuevaOrden, setNuevaOrden] = useState<NuevaOrden | null>(null);
  /** Los filtros que había cuando el operario fue a registrar (para devolvérselos si no registró). */
  const filtrosPrevios = useRef<ServiceFilters | null>(null);
  /** F79: la orden que creó el botón «Cobrar» del wizard (el registro sigue abierto): se resalta
   *  cuando el wizard se cierre, porque detrás del modal nadie la vería. */
  const creadaEnWizard = useRef<NuevaOrden | null>(null);
  /** ¿Ya se bajó hasta la tarjeta nueva? (una sola vez por orden) */
  const yaBaje = useRef<string | null>(null);

  /** Pone los seis filtros en el PREDETERMINADO (no-op si ya están: React no re-renderiza de gusto). */
  const aplicarPredeterminado = () => {
    const d = resetFiltersForNewOrder();
    setSearch(d.search);
    setStatusFilter(d.statusFilter);
    setTypeFilter(d.typeFilter);
    setDateField(d.dateField);
    setDateStart(d.dateStart);
    setDateEnd(d.dateEnd);
  };

  /** Devuelve los filtros que había antes de ir a registrar (solo si NO se registró nada). */
  const restaurarFiltrosPrevios = () => {
    const p = filtrosPrevios.current;
    filtrosPrevios.current = null;
    if (!p) return;
    setSearch(p.search);
    setStatusFilter(p.statusFilter);
    setTypeFilter(p.typeFilter);
    setDateField(p.dateField);
    setDateStart(p.dateStart);
    setDateEnd(p.dateEnd);
  };

  /**
   * ABRIR EL ALTA (F81): la ÚNICA puerta del registro nuevo. Guarda los filtros vigentes y deja la
   * lista en el predeterminado. Los caminos de EDICIÓN no la usan: editar una orden no le cambia la
   * pantalla al operario.
   */
  const abrirAlta = () => {
    filtrosPrevios.current = { search, statusFilter, typeFilter, dateField, dateStart, dateEnd };
    creadaEnWizard.current = null;
    aplicarPredeterminado();
    setEditing(null);
    setShowForm(true);
  };

  // F81 — BAJAR HASTA LA TARJETA NUEVA, una sola vez por orden y cuando la lista ya trae esas filas.
  // Se busca el `[data-nueva]` del DOM (no una ref de React) porque en una recepción multi-equipo la
  // tarjeta puede estar dentro del grupo y el nodo se vuelve a montar al recargar la lista.
  useEffect(() => {
    if (!nuevaOrden) { yaBaje.current = null; return; }
    if (yaBaje.current === nuevaOrden.base) return;
    const el = document.querySelector('[data-nueva]');
    if (!el) return;   // la respuesta todavía no llegó: este efecto vuelve a correr con la lista nueva
    yaBaje.current = nuevaOrden.base;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* bajar es una ayuda */ }
  }, [nuevaOrden, services]);

  // El resaltado se apaga SOLO (nadie quiere una tarjeta brillando media hora) y también cuando el
  // operario toca un filtro: a partir de ahí la lista ya no es «la que se abrió para registrar».
  // OJO: el EJE (Recibidos/Entregados) también es un filtro — la revisión adversarial encontró que
  // sin `dateField` el anillo volvía a aparecer al cambiar de eje dentro de los 8 s.
  useEffect(() => {
    if (!nuevaOrden) return;
    const t = setTimeout(() => setNuevaOrden(null), 8000);
    return () => clearTimeout(t);
  }, [nuevaOrden]);
  useEffect(() => { setNuevaOrden(null); }, [search, statusFilter, dateStart, dateEnd, typeFilter, dateField]);

  // Atajos de teclado: N/F2 = Nuevo Servicio, F4 = cerrar una entrega (cola), / = buscar.
  // Solo cuando NO se está escribiendo en un campo (o el dialog está cerrado).
  // F30: F4 no debe apilar la cola sobre otro diálogo ya abierto.
  const algunDialogoAbierto = showForm || showQueue || !!payFor || !!refundFor || !!printFor
    || !!deleting || !!cierreFor || !!confirmDeliver || showPrinterSettings;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      // F81: el alta pasa por `abrirAlta` (filtros al predeterminado) — también por el atajo. Y NO se
      // apila sobre otro diálogo abierto (antes solo miraba `showForm`: con el cobro o el comprobante
      // abiertos, N abría el alta encima y —nuevo en F81— le reencuadraba los filtros al operario).
      if ((e.key === 'n' || e.key === 'N' || e.key === 'F2') && !typing && !algunDialogoAbierto) {
        e.preventDefault();
        // F81: el alta pasa por `abrirAlta` (filtros al predeterminado) — también por el atajo.
        abrirAlta();
      } else if (e.key === 'F4' && !typing && !algunDialogoAbierto) {
        // El mostrador recibe mucho cliente: F4 → cola de entregas → asistente de cierre.
        e.preventDefault();
        setShowQueue(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, algunDialogoAbierto, abrirAlta]);

  // Pantalla exacta → etiqueta del repuesto para el chip de la tarjeta
  const screenProductById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of catalog) if (p.category_id === 1 && p.id != null) m.set(p.id, partLabel(p));
    return m;
  }, [catalog]);

  // Pagos reales por servicio (para el chip de método honesto en las tarjetas)
  const [paymentsMap, setPaymentsMap] = useState<Record<number, ServicePayment[]>>({});
  // F44: la lista pasó el tope de 120 filas y no se pudieron traer los pagos (se avisa en pantalla).
  const [pagosSinCargar, setPagosSinCargar] = useState(false);

  const techById = (id: number | null | undefined) => technicians.find(t => t.id === id);

  // ── F34: CAMBIO RÁPIDO DE TÉCNICO desde la tarjeta ────────────────────────────────────────
  // Pedido del dueño: «le dé clic al nombre del técnico o a la letra como tal que tiene la tarjeta
  // [y] me dé la opción cambiar técnico rápido». Se guarda por la ÚNICA vía de actualización de
  // órdenes (`updateOrderKeepingFields`), así que ningún otro campo de la orden se toca.
  const [quickTech, setQuickTech] = useState<Service | null>(null);
  const [savingTech, setSavingTech] = useState(false);
  const cambiarTecnico = async (s: Service, t: Technician | null) => {
    if (savingTech) return;  // dos clics seguidos en técnicos distintos: gana el primero
    setSavingTech(true);
    try {
      await updateOrderKeepingFields(s, { technician: t?.name ?? '', technicianId: t?.id ?? null });
      setQuickTech(null);
      await load();
      toast.success(t ? `Técnico: ${t.name}` : 'Técnico sin asignar', { id: `tech-${s.id}` });
    } catch (e) {
      toast.error('No se pudo cambiar el técnico', { description: e instanceof Error ? e.message : String(e), id: `tech-${s.id}` });
    } finally {
      setSavingTech(false);
    }
  };

  const load = async () => {
    const hoy = localDate();
    // F56: se anota CON QUÉ filtros se trajeron estas filas: el resumen solo las reusa si la firma
    // sigue coincidiendo (entre limpiar un filtro y la respuesta nueva, `services` es la lista vieja).
    firmaFiltros.current = JSON.stringify([search, statusFilter, dateStart, dateEnd]);
    const [s, st, techs, entregados] = await Promise.all([
      api.getServices(search, statusFilter, dateStart, dateEnd, dateField),
      api.getServiceStatuses(),
      api.getTechnicians().catch(() => [] as Technician[]),
      // F32: los ENTREGADOS de hoy, por fecha de entrega (una sola consulta; alimenta el KPI y
      // el panel «Teléfonos entregados hoy»).
      api.getServices('', 'Entregado', hoy, hoy, 'out').catch(() => [] as Service[]),
    ]);
    setServices(s);
    setStatuses(st);
    setTechnicians(techs);
    setEntregadosHoy(entregados);
    // Métodos REALES de pago por tarjeta (chip honesto: si pagó por Pago Móvil,
    // la tarjeta no debe decir "Divisas"). Cap 120 filas para no disparar N queries.
    //
    // F32: los ENTREGADOS DE HOY se piden SIEMPRE (son pocos: los del día) aunque la lista
    // visible pase el tope — si no, al superar las 120 filas el mapa quedaba vacío y el panel
    // mostraba «Sin pago» en órdenes que sí se cobraron (justo lo que el panel debe decir bien).
    // F38 (revisión adversarial): por encima de las 120 filas tampoco se sabe la moneda del cobro.
    // NO es un error de plata: `balanceLabel` sin datos dice las DOS monedas («$80.00 (Bs. 59.903,20)»),
    // solo cambia el orden; el operario sigue viendo el número en Bs. Lo que sí se pierde es el chip
    // del método real, y por eso la lista se filtra (el caso normal es un rango corto de fechas).
    const conPagos = (list: Service[]) => list.length === 0 ? Promise.resolve({}) :
      Promise.all(list.map(async sv =>
        [sv.id, await api.getServicePayments(sv.id).catch(() => [] as ServicePayment[])] as const,
      )).then(Object.fromEntries);
    const [mapaLista, mapaHoy] = await Promise.all([
      s.length > 0 && s.length <= 120 ? conPagos(s) : Promise.resolve({}),
      conPagos(entregados),
    ]);
    setPaymentsMap({ ...mapaLista, ...mapaHoy });
    // F44: se avisa en pantalla cuándo el mapa de pagos NO se pudo cargar (el chip del método real
    // se pierde por encima del tope). Antes pasaba en silencio y el operario creía que la orden no
    // se había cobrado: es una limitación, así que se dice.
    setPagosSinCargar(s.length > 120);
  };

  // F62: agrega una categoría de trabajo del LOCAL y devuelve el nombre GUARDADO (null si falló).
  // La validación vive en el backend (no vacía, tope de 40, sin duplicados por mayúsculas/acentos) y
  // acá solo se refresca la lista que ya está en pantalla.
  const agregarCategoria = useCallback(async (nombre: string): Promise<string | null> => {
    try {
      const json = await api.addWorkTypeExtra(nombre);
      const lista = JSON.parse(json) as string[];
      setTiposExtra(Array.isArray(lista) ? lista : []);
      // Si el nombre es sinónimo de un trabajo que ya existe, el backend lo guarda con el nombre
      // CANÓNICO (tabla de F58): se devuelve ESE para que quede elegido en la orden.
      const canonico = aliasDeTrabajo(nombre) ?? nombre.trim();
      toast.success(`Categoría agregada: ${canonico}`);
      return canonico;
    } catch (e) {
      toast.error('No se pudo agregar la categoría', { description: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }, []);

  // F62: quita una categoría del local (deshacer un error de tipeo). Las órdenes ya registradas NO
  // se tocan: la etiqueta vive dentro de cada orden.
  const quitarCategoria = useCallback(async (nombre: string): Promise<boolean> => {
    try {
      const json = await api.removeWorkTypeExtra(nombre);
      const lista = JSON.parse(json) as string[];
      setTiposExtra(Array.isArray(lista) ? lista : []);
      toast.success('Categoría quitada: ' + nombre);
      return true;
    } catch (e) {
      toast.error('No se pudo quitar la categoría', { description: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }, []);

  // F56: refrescar la LISTA y los datos del RESUMEN (guardar, borrar, entregar, cobrar). Los
  // filtros y el buscador NO entran acá a propósito: el resumen tiene su propio alcance, así que no
  // depende de ellos y no hace falta volver a leer la base entera en cada tecla.
  const refrescar = () => { load(); setResumenVersion(v => v + 1); };

  // F76 — la lista y los KPIs se recargan SOLOS cuando algo cambia (una venta, un cobro, una entrega,
  // un cambio de técnico…): el operario no tiene que apretar nada.
  useEffect(() => { refrescar(); }, [dataVersion]);
  // F56: los datos del resumen. SOLO se piden cuando la lista tiene filtros: sin filtros, las filas
  // de la lista YA son toda la base y se reusan (una sola lectura). Las deps son el BOOLEANO, no los
  // cuatro filtros: con los strings, cada tecla del buscador disparaba una lectura completa y hacía
  // parpadear los tiles a «—» (observación de la re-revisión).
  useEffect(() => {
    if (listaSinFiltros) return;
    const mio = ++resumenSeq.current;
    // «Leyendo…» solo si no hay nada que mostrar: con datos previos se refresca en silencio.
    if (!hayResumen.current) setResumenEstado('cargando');
    api.getServices('', '', '', '', 'in')
      .then(rs => {
        if (resumenSeq.current !== mio) return;  // respuesta vieja: se descarta
        setResumenRows(rs);
        hayResumen.current = true;
        setResumenEstado('ok');
      })
      .catch(() => {
        if (resumenSeq.current !== mio) return;
        // NO se pisan las filas anteriores: un fallo de lectura no es un día vacío.
        setResumenEstado('error');
      });
  }, [resumenVersion, listaSinFiltros]);
  useEffect(() => { api.getProducts('', null).then(setCatalog).catch(() => {}); }, []);
  // F62: las categorías del local, una sola vez (si falla, la pantalla sigue con las canónicas).
  useEffect(() => {
    api.getWorkTypesExtra()
      .then(json => { const l = JSON.parse(json) as string[]; if (Array.isArray(l)) setTiposExtra(l); })
      .catch(() => {});
  }, []);
  // Debounce: la búsqueda solo consulta tras 350ms de inactividad.
  // F44: la PRIMERA corrida se saltea — el montaje ya cargó la lista, y con el filtro por defecto en
  // «Todos los estados» esa consulta es todo el historial: pagarla dos veces es pagar dos veces la
  // lista entera (y su mapa de pagos).
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) { primerRender.current = false; return; }
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [search, statusFilter, dateStart, dateEnd, dateField]);

  // Períodos rápidos por fecha de RECIBIDO (días=0 → hoy; null → todos)
  const setQuickPeriod = (days: number | null) => {
    if (days === null) {
      setDateStart('');
      setDateEnd('');
      return;
    }
    const now = new Date();
    if (days === 0) {
      const d = localDate(now);
      setDateStart(d);
      setDateEnd(d);
    } else {
      const hoy = localDate(now);
      setDateStart(addDays(hoy, -(days - 1)));
      setDateEnd(hoy);
    }
  };

  useEffect(() => {
    api.getActiveDay().then(d => {
      setDayOpen(!!d);
      setTasaDia(d?.tasa_bcv ?? 0);
      // F82: la fecha del turno abierto (para avisar si quedó abierto el día ANTERIOR).
      setFechaTurno(d?.close_date ?? null);
    }).catch(() => setDayOpen(true));
  }, []);

  const handleDelete = async (s: Service) => {
    await api.deleteService(s.id);
    setDeleting(null);
    refrescar();
  };

  // Entrega directa desde la tarjeta: status Entregado + date_out vacío (el backend pone la
  // fecha de hoy y descuenta stock). Pasa por el helper compartido para que no se olvide
  // ningún campo de la orden (monto, descuento, pantalla exacta, técnico…).
  const deliver = async (s: Service) => {
    setDelivering(s);
    try {
      await updateOrderKeepingFields(s, { status: 'Entregado' });
      // F32: aviso de POLÍTICA (foto de SALIDA) — aparece después de entregar y NUNCA bloquea
      // (el equipo ya salió): si el operario confirma, queda anotado en la orden; si no, la
      // orden queda visible como «sin foto» en el panel de entregados de hoy.
      const fresca = await api.getService(s.id).catch(() => null);
      if (fresca) firePolicyReminders(deliverReminders(fresca), [fresca.id], load);
    } finally {
      setDelivering(null);
      setConfirmDeliver(null);
      refrescar();
    }
  };

  // F32: ver los teléfonos ENTREGADOS hoy (por fecha de entrega) en un toque.
  const verEntregadosHoy = () => {
    const hoy = localDate();
    setStatusFilter('Entregado');
    setDateField('out');
    setDateStart(hoy);
    setDateEnd(hoy);
    setTypeFilter('');
    // F56: el resumen se pone en HOY para que el número del KPI «Entregados hoy» del resumen siga
    // siendo el del día que se acaba de pedir (si no, la pantalla diría dos cosas distintas).
    setResumenKind('hoy');
  };

  // F44 — TRABAJOS HECHOS: los contadores cuentan LA LISTA QUE SE ESTÁ VIENDO (búsqueda + estado +
  // rango de fechas), con los ENTREGADOS INCLUIDOS. Antes se contaban solo las órdenes activas
  // (`enTaller`), así que al filtrar por «Entregado» —justo cuando el dueño quiere contar lo que ya
  // salió— desaparecían todos los chips, y los trabajos escritos a mano («Otro») no tenían contador.
  // El reporte y el filtro salen del MISMO módulo puro (`lib/service-report`), así el número del chip
  // no puede mentir: dice exactamente las tarjetas que aparecen al hacerle clic.
  const report = useMemo(() => serviceReport(services, tiposExtra), [services, tiposExtra]);

  // ── F56 — EL RESUMEN DEL DÍA ────────────────────────────────────────────────────────────────
  // El alcance es PROPIO (por defecto HOY) y se resuelve con la regla pura `rangeFor`: «hoy»,
  // «7 días» (hoy + los 6 anteriores), «este mes» (del día 1 a hoy) o el rango de los filtros.
  // OJO: `rangeFor` usa fechas LOCALES (localDate/addDays/monthStart) — nunca toISOString, que en
  // Venezuela adelanta el día después de las 20:00.
  const hoyLocal = localDate();
  const resumenRange = resumenKind === 'filtros'
    ? { start: dateStart, end: dateEnd }
    : rangeFor(resumenKind, hoyLocal);
  // Revisión adversarial (mayor): con la lista SIN filtros, sus filas YA son toda la base — el resumen
  // las reusa y no se paga una segunda lectura completa. Con filtros puestos sí hace falta la suya
  // (el resumen tiene alcance propio y no puede cambiar porque el operario filtró la lista).
  // OJO (re-revisión, O1): se reusa SOLO si `services` se trajo con los filtros de AHORA — si no,
  // durante la ventana de recarga el resumen calcularía sobre la lista vieja (filtrada).
  // (`listaSinFiltros` se calcula arriba, junto a los estados: lo usa el efecto del resumen.)
  const listaConfiable = firmaFiltros.current === JSON.stringify([search, statusFilter, dateStart, dateEnd]);
  const reusaLista = listaSinFiltros && listaConfiable && services.length > 0;
  const filasResumen = reusaLista ? services : resumenRows;
  const resumen = useMemo(() => scopeSummary(filasResumen, resumenRange, tiposExtra), [filasResumen, resumenRange.start, resumenRange.end, tiposExtra]);
  // ¿Los números del resumen son confiables? (o se están leyendo, o falló la lectura: en esos dos
  // casos NO se pintan ceros, porque un cero diría «hoy no pasó nada» cuando en realidad no se sabe).
  const resumenListo = reusaLista || resumenEstado === 'ok';
  // Aplicar el alcance del resumen a la LISTA (un toque: «ver estos equipos» en vez de armar los
  // filtros a mano). El estado de trabajo se limpia porque el resumen no filtra por estado (F44)
  // y el eje de fecha lo decide cada tile según lo que esté contando (recibo vs entrega).
  const verResumenEnLista = (eje: 'in' | 'out', trabajo = '') => {
    setSearch('');
    setStatusFilter('');
    setDateField(eje);
    setDateStart(resumenRange.start);
    setDateEnd(resumenRange.end);
    setTypeFilter(trabajo);
  };
  // Estos dos números NO dependen del alcance del resumen, así que su clic también tiene que sacar el
  // rango de la lista: si no, pulsar «En taller» con el eje de ENTREGA puesto deja la lista vacía por
  // definición (una orden en taller todavía no tiene fecha de entrega) mostrando 42 en el tile
  // (revisión adversarial, mayor).
  const verTaller = () => { setSearch(''); setStatusFilter(ACTIVE_SENTINEL); setTypeFilter(''); setDateField('in'); setDateStart(''); setDateEnd(''); };
  const verListos = () => { setSearch(''); setStatusFilter('Por entregar'); setTypeFilter(''); setDateField('in'); setDateStart(''); setDateEnd(''); };
  const filtrosActivos = !!(search || statusFilter || dateStart || dateEnd || typeFilter);
  const alcance: ScopeInput = { status: statusFilter, dateField, start: dateStart, end: dateEnd };
  const problemaAlcance = scopeProblem({ status: statusFilter, dateField });
  // Lista visible: la cargada por backend (búsqueda + estado) filtrada por trabajo client-side.
  // F44: los KPIs y la línea de reporte usan ESTA lista, no `services`: antes «Total Equipos» y
  // «Monto Total» ignoraban el chip de trabajo activo y mostraban otro número que el de las tarjetas.
  const visibleServices = useMemo(
    () => (typeFilter ? services.filter(s => matchesWorkFilter(s, typeFilter)) : services),
    [services, typeFilter],
  );

  const totalAmount = visibleServices.reduce((a, s) => a + s.amount, 0);
  const listos = visibleServices.filter(s => s.status === 'Por entregar').length;

  // ── F81 — ver el bloque de arriba (abrirAlta / restaurarFiltrosPrevios / nuevaOrden) ───────────
  // Quitar TODOS los filtros de una vez (F44: antes «Limpiar» borraba solo las fechas y quedaba el
  // resto puesto sin que se notara). El eje Recibidos/Entregados se conserva porque sin rango de
  // fechas no filtra nada: eso es el botón A MANO. El reset del alta sí devuelve el eje a «Recibidos».
  const limpiarFiltros = () => {
    const f = clearServiceFilters({ search, statusFilter, typeFilter, dateField, dateStart, dateEnd });
    setSearch(f.search);
    setStatusFilter(f.statusFilter);
    setTypeFilter(f.typeFilter);
    setDateField(f.dateField);
    setDateStart(f.dateStart);
    setDateEnd(f.dateEnd);
  };

  // Órdenes multi-equipo: los equipos con group_id se renderizan juntos bajo un banner de orden
  type GroupItem =
    | { type: 'group'; groupId: string; services: Service[] }
    | { type: 'single'; service: Service };
  const groupItems: GroupItem[] = useMemo(() => {
    const groups = new Map<string, Service[]>();
    const singles: GroupItem[] = [];
    for (const s of visibleServices) {
      if (s.group_id) {
        const arr = groups.get(s.group_id) ?? [];
        arr.push(s);
        groups.set(s.group_id, arr);
      } else {
        singles.push({ type: 'single', service: s });
      }
    }
    const grouped: GroupItem[] = [...groups.entries()].map(([groupId, svcs]) => ({
      type: 'group', groupId, services: svcs,
    }));
    const maxId = (i: GroupItem) => i.type === 'group'
      ? Math.max(...i.services.map(s => s.id))
      : i.service.id;
    return [...grouped, ...singles].sort((a, b) => maxId(b) - maxId(a));
  }, [visibleServices]);

  const statusBadgeVariant = (status: string | null) => {
    switch (status) {
      case 'Entregado': return 'default' as const;
      case 'Por entregar': return 'secondary' as const;
      case 'Cancelado / Devuelto': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  // Tarjeta de un equipo (o de una orden individual). En órdenes multi-equipo muestra
  // "Equipo X/Y" con el número de la orden; los pagos/abonos son POR EQUIPO.
  const renderServiceCard = (s: Service, groupId: string | null, pos: number, count: number) => {
    const balance = s.amount - s.paid_amount;
    // F38: el saldo de la tarjeta se dice en la moneda en que se cobró (+ su equivalencia del día):
    // el operario lee el número en Bs. que le va a pedir al cliente, sin traducir mentalmente.
    const saldoTexto = balanceLabel(orderBalance(s.amount, s.paid_amount ?? 0, paymentsMap[s.id], tasaDia));
    const checklist = parseChecklist(s.device_checklist);
    const hasChecklist = Object.keys(checklist).length > 0;
    const entregado = s.status === 'Entregado';
    const porEntregar = s.status === 'Por entregar';
    const warr = entregado && s.date_out ? warrantyStatus(s.date_out) : 'sin';
    const finalized = isFinalized(s.status);
    // Métodos REALES usados en los pagos (chip honesto); fallback al método del form
    const pays = paymentsMap[s.id] ?? [];
    const realMethods = pays.length > 0
      ? [...new Set(pays.map(p => p.payment_method).filter(Boolean))].map(shortMethodLabel)
      : null;
    // F81: ¿es la orden que se acaba de registrar? Se resalta y la lista baja hasta ella (el
    // `data-nueva` lo lee el efecto de scroll). Se cubren las filas REALES de la orden (`ids`) y, en
    // una recepción multi-equipo, todas las del mismo grupo.
    const esNueva = !!nuevaOrden
      && (nuevaOrden.ids.includes(s.id) || (!!nuevaOrden.groupId && s.group_id === nuevaOrden.groupId));
    return (
      <Card key={s.id} data-nueva={esNueva ? nuevaOrden?.base : undefined} className={cn(
        'overflow-hidden transition-shadow hover:shadow-md border-l-4',
        esNueva && 'ring-2 ring-primary/60 shadow-lg',
        entregado && 'border-emerald-500/40 bg-emerald-500/5 border-l-emerald-500',
        porEntregar && 'border-amber-500/40 bg-amber-500/5 border-l-amber-500',
        !entregado && !porEntregar && ['Cancelado', 'Devuelto', 'Cancelado / Devuelto'].includes(s.status ?? '')
          && 'border-red-500/40 bg-red-500/5 border-l-red-500/70'
      )}>
        <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {groupId ? (
              <span className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
                {groupId}
                <span className="rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-bold">
                  Equipo {pos}/{count}
                </span>
              </span>
            ) : (
              <span className="text-sm font-bold">{s.order_num}</span>
            )}
            {entregado && <CheckCircle2 className="size-4 text-emerald-500" />}
            {porEntregar && <Clock className="size-4 text-amber-500" />}
            <span className="text-[11px] text-muted-foreground">{s.date_in?.slice(0, 16) ?? '-'}</span>
            {/* F34: el técnico de la tarjeta es un BOTÓN — un clic y se cambia sin abrir el form.
                Muestra las iniciales en su color (o el nombre del snapshot si lo borraron). */}
            <button type="button" data-tech-quick={s.id}
              title={`${s.technician ? s.technician : 'Sin técnico asignado'} — clic para cambiar el técnico`}
              aria-label={`Cambiar técnico de la orden ${s.order_num}`}
              onClick={() => setQuickTech(s)}
              className="flex shrink-0 items-center gap-1 rounded-full px-1 -mx-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              {techById(s.technician_id) ? (
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', techById(s.technician_id)!.color)}>
                  {techById(s.technician_id)!.initials}
                </span>
              ) : s.technician ? (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[10px] font-bold text-white">
                  {initialsOf(s.technician)}
                </span>
              ) : (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-[10px] text-muted-foreground">
                  <Users className="size-3" />
                </span>
              )}
              <span className="max-w-24 truncate text-[11px] text-muted-foreground">
                {techById(s.technician_id)?.name ?? s.technician ?? 'Asignar'}
              </span>
            </button>
          </div>
          <Badge variant={statusBadgeVariant(s.status)} className={entregado ? 'bg-success' : undefined}>{s.status}</Badge>
        </CardHeader>
        {!finalized && balance > 0.005 && (
          <div className="px-4 pt-1">
            <UnpaidBanner
              neverPaid={(s.paid_amount ?? 0) <= 0.005}
              balance={balance}
              amount={s.amount}
              paid={s.paid_amount ?? 0}
              saldoTexto={saldoTexto}
            />
          </div>
        )}
        <CardContent className="px-4 pb-4 pt-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                <User className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{s.client ?? '-'}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[s.phone, s.client_ci].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex items-center justify-center size-7 rounded-md bg-muted text-muted-foreground shrink-0">
                <Smartphone className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{s.model ?? '-'}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{s.fault ?? '-'}</p>
              </div>
            </div>

            <div className="rounded-md bg-muted/50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                {s.discount_amount > 0.005 ? (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-muted-foreground line-through">${(s.amount + s.discount_amount).toFixed(2)}</span>
                    <span className="text-sm font-bold">${s.amount.toFixed(2)}</span>
                  </div>
                ) : (
                  <span className="text-sm font-bold">${s.amount.toFixed(2)}</span>
                )}
                {finalized ? (
                  <Badge variant="outline" className="text-danger">{s.status === 'Devuelto' ? 'Devuelto' : 'Cancelado'}</Badge>
                ) : balance <= 0.005 ? (
                  <Badge variant="outline" className="text-success">Cancelado</Badge>
                ) : (s.paid_amount ?? 0) <= 0.005 ? (
                  <Badge variant="outline" className="text-amber-600 border-amber-500/40 bg-amber-500/10">Por pagar {saldoTexto}</Badge>
                ) : (
                  <Badge variant="outline" className="text-danger">{saldoTexto}</Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 mt-1 text-xs text-muted-foreground">
                <span className="truncate">
                  {realMethods ? realMethods.join(' + ') : (s.payment_method ?? '-')}
                  {!realMethods && isMovilOrZelle(s.payment_method) && s.zelle_reference && (
                    <span className="text-[11px] text-muted-foreground"> · ref ····{s.zelle_reference.slice(-4)}</span>
                  )}
                </span>
                {s.paid_amount > 0.005 && <span className="text-emerald-600 font-medium shrink-0">abonado ${s.paid_amount.toFixed(2)}</span>}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {/* F45 — SEÑAL de que el trabajo todavía no tiene técnico (pedido del dueño: «en la
                    tarjeta aparezca una señal con un color: necesita asignar al técnico para ese
                    trabajo»). Es un BOTÓN: un clic abre el selector rápido de F34 y se asigna sin
                    entrar al formulario. No se muestra en órdenes entregadas ni anuladas (el trabajo
                    ya salió: reclamar el técnico después sería ruido permanente en la lista). */}
                {needsTechnician(s) && (
                  <button type="button" data-needs-tech={s.id}
                    title="Esta orden todavía no tiene técnico: hacé clic para asignarlo"
                    aria-label={`Asignar técnico a la orden ${s.order_num}`}
                    onClick={() => setQuickTech(s)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500">
                    <UserPlus className="size-3" /> Falta asignar técnico
                  </button>
                )}
                {parseServiceTypes(s).map(t => (
                  <Badge key={t} variant="outline" className="text-xs whitespace-nowrap">{t}</Badge>
                ))}
                {s.discount_amount > 0.005 && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/40 bg-amber-500/10 whitespace-nowrap">
                    Descuento ${s.discount_amount.toFixed(2)}
                  </Badge>
                )}
                {s.screen_product_id != null && screenProductById.has(s.screen_product_id) && (
                  <Badge variant="outline" className="text-xs whitespace-nowrap bg-primary/5 border-primary/30 text-primary">
                    <Smartphone className="size-3 mr-1" /> {screenProductById.get(s.screen_product_id)}
                  </Badge>
                )}
                {entregado && !s.printed && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/40 bg-amber-500/10 whitespace-nowrap">
                    Sin imprimir orden
                  </Badge>
                )}
                {/* F32: señales de política del taller (informativas, nunca bloquean) */}
                {entregado && !photoOutIsCurrent(s.photo_out_at, s.date_out) && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/40 bg-amber-500/10 whitespace-nowrap"
                    title="Política de la empresa: se le toma foto al teléfono al entregarlo">
                    Sin foto de salida
                  </Badge>
                )}
                {/* Solo en las recepciones de HOY: marcarlo en toda orden vieja sería ruido
                    permanente (las órdenes anteriores a F32 no tienen la anotación). */}
                {ACTIVE_STATUSES.includes(s.status ?? '') && !s.photo_in_at && (s.date_in ?? '').slice(0, 10) === localDate() && (
                  <Badge variant="outline" className="text-xs text-sky-700 border-sky-500/40 bg-sky-500/10 whitespace-nowrap"
                    title="Política de la empresa: se le toma foto al teléfono al recibirlo">
                    Sin foto de entrada
                  </Badge>
                )}
                {payIntentLabel(s.pay_intent) && (
                  <Badge variant="outline" className="text-xs text-primary border-primary/40 bg-primary/5 whitespace-nowrap"
                    title="Lo que dijo el cliente al recibir el equipo">
                    {payIntentLabel(s.pay_intent)}
                  </Badge>
                )}
                {warr === 'activa' && (
                  <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500/40 bg-emerald-500/10 whitespace-nowrap">
                    Garantía hasta {warrantyEnd(s.date_out)}
                  </Badge>
                )}
                {warr === 'vencida' && (
                  <Badge variant="outline" className="text-xs text-muted-foreground whitespace-nowrap">
                    Garantía vencida
                  </Badge>
                )}
                {s.date_out && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="size-3" /> {s.date_out.slice(0, 10)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 border-t pt-3">
                {/* F49: el botón «Cerrar» (asistente de cierre) se quitó de la tarjeta — el cliente
                    lo pidió — y en su lugar va el DESCUENTO de ese servicio, que se refleja en la
                    factura. El asistente de cierre sigue a un toque desde la barra de arriba
                    («Cerrar entrega», o F4 → buscar la orden) y desde «Entregar». */}
                {!finalized && (
                  <Button size="sm" variant="outline"
                    className="flex-1 border-violet-500/50 text-violet-700 hover:bg-violet-500/10"
                    title="Aplicar un descuento a este servicio (sale impreso en la factura)"
                    data-discount={s.id}
                    onClick={() => setDiscountFor(s)}>
                    <Percent className="size-3.5" /> Descuento
                  </Button>
                )}
                {ACTIVE_STATUSES.includes(s.status ?? '') && (
                  <Button size="sm" variant="outline" className="flex-1 text-emerald-700 border-emerald-500/50 hover:bg-emerald-500/10"
                    disabled={delivering?.id === s.id}
                    onClick={() => {
                      // Confirmar solo si el cliente no pagó la totalidad
                      if (s.amount - s.paid_amount > 0.005) setConfirmDeliver(s);
                      else deliver(s);
                    }}>
                    <CheckCircle2 className="size-3.5" /> {delivering?.id === s.id ? 'Entregando...' : 'Entregar'}
                  </Button>
                )}
                {!finalized && (
                  <Button size="sm" className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => setPayFor(s)}>
                    <Banknote className="size-3.5" /> Pago / Abono
                  </Button>
                )}
                {!finalized && ((s.paid_amount ?? 0) > 0.005 || (entregado && (s.amount ?? 0) > 0.005)) ? (
                  <Button size="sm" variant="outline" className="flex-1 text-danger border-danger/40 hover:bg-danger/10"
                    onClick={() => setRefundFor(s)}>
                    <Undo2 className="size-3.5" /> Devolución
                  </Button>
                ) : null}
                {hasChecklist && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-orange-600 hover:bg-orange-500/10"
                          onClick={() => { setEditing(s); setShowForm(true); }}>
                          <ShieldCheck className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs space-y-1">
                          <div className="font-medium">{checklistSummary(s.device_checklist)}</div>
                          {Object.entries(checklist).map(([k, v]) => {
                            const item = CHECKLIST_ITEMS.find(i => i.key === k);
                            if (!item || !v) return null;
                            return <div key={k}>{item.label}: {v === 'si' ? 'Sí' : 'No'}</div>;
                          })}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <Button variant="outline" size="sm" className="flex-1" title={s.printed ? 'Reimprimir orden de servicio' : 'Imprimir orden de servicio'}
                  onClick={() => setPrintFor(s)}>
                  <Printer className="size-3.5" /> {s.printed ? 'Reimprimir' : 'Orden'}
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { setEditing(s); setShowForm(true); }}>
                  Editar
                </Button>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-danger"
                  onClick={() => setDeleting(s)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Servicio Técnico</h1>
          <p className="text-sm text-muted-foreground mt-1">Órdenes de reparación y seguimiento</p>
        </div>
        <div className="flex items-center gap-3">
          {dayOpen === false && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
              <Lock className="size-4" /> Día cerrado — abre el día en Libro Diario para registrar servicios
            </div>
          )}
          {/* F82: con un turno de OTRO día no se dice «Día abierto» (el backend rechaza la
              recepción: la plata de hoy se anotaría en la caja de ayer). */}
          {dayOpen === true && !turnoViejo.stale && (
            <span className="text-sm text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="size-4" /> Día abierto
            </span>
          )}
          <Button variant="outline" onClick={() => setShowQueue(true)} title="Cerrar una entrega (F4) — busca la orden y cobra en un paso">
            <Zap className="size-4" /> Cerrar entrega
          </Button>
          {ab.manageSettings && (
            <Button variant="outline" onClick={() => setShowPrinterSettings(true)} title="Configurar impresora de tickets">
              <Printer className="size-4" /> Impresora
            </Button>
          )}
          {/* F82: con la caja del día anterior sin cerrar, el alta se apaga (el backend la rechaza y
              la orden no se puede guardar): el cartel de abajo dice por qué y lleva al remedio. */}
          <Button onClick={abrirAlta} disabled={turnoViejo.stale}
            title={turnoViejo.stale ? turnoViejoTexto(turnoViejo) : 'Nuevo Servicio (N o F2)'}>
            <Plus className="size-4" /> Nuevo Servicio
          </Button>
        </div>
      </div>

      {/* F82 — LA CAJA DEL DÍA ANTERIOR SIN CERRAR: antes de recibir un equipo, con las dos fechas y
          el camino del remedio a un toque (Libro Diario → Cierres → «Cerrar» de esa fila). */}
      <TurnoViejoBanner turno={turnoViejo} onGoToLedger={onGoToLedger} puedeCerrar={ab.closeDay} />

      {/* ── F56 — RESUMEN DEL DÍA ────────────────────────────────────────────────────────────────
          Lo que el cliente pregunta de verdad («¿cuántas pantallas hiciste hoy?», «¿cuántos equipos
          recibiste hoy?») sin armar filtros a mano y sin el muro de categorías: los números del
          alcance, el desglose por trabajo y —siempre— la línea que dice SOBRE QUÉ se está contando.
          Se calcula con su PROPIO alcance (por defecto HOY) sobre toda la base, así que no lo mueve
          el filtro de la lista; y cada número, al tocarlo, trae esos equipos a la lista. */}
      <Card data-panel="resumen-dia">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">Resumen del día</CardTitle>
              <p className="text-xs text-muted-foreground" data-resumen-scope>
                {summaryScopeLabel(resumen.range, hoyLocal)}
              </p>
            </div>
            <ToggleGroup type="single" value={resumenKind} aria-label="Alcance del resumen"
              onValueChange={v => { if (v) setResumenKind(v as ScopeKind | 'filtros'); }}>
              <ToggleGroupItem value="hoy" className="h-8 px-2.5 text-xs" data-resumen-kind="hoy"
                title="Lo de hoy: por fecha de recibo y por fecha de entrega">Hoy</ToggleGroupItem>
              <ToggleGroupItem value="7d" className="h-8 px-2.5 text-xs" data-resumen-kind="7d"
                title="Hoy y los 6 días anteriores">7 días</ToggleGroupItem>
              <ToggleGroupItem value="mes" className="h-8 px-2.5 text-xs" data-resumen-kind="mes"
                title="Del día 1 del mes hasta hoy">Este mes</ToggleGroupItem>
              <ToggleGroupItem value="filtros" className="h-8 px-2.5 text-xs" data-resumen-kind="filtros"
                title="El mismo rango de fechas que tienen los filtros de la lista">Los filtros</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ResumenTile id="recibidos" titulo="Recibidos" valor={resumen.recibidos} tono="azul"
              cargando={!resumenListo}
              sub={`por fecha de recibo · $${resumen.montoRecibido.toFixed(2)}`}
              onClick={() => verResumenEnLista('in')} />
            {/* F32: este tile es el KPI «Entregados hoy» del dueño — pero SOLO cuando el alcance es
                HOY: con «7 días» o «Este mes» el mismo número diría otra cosa y el enganche mentiría
                (revisión adversarial, mayor). */}
            <ResumenTile id="entregados" titulo="Entregados" valor={resumen.entregados} tono="verde"
              cargando={!resumenListo}
              kpi={resumenKind === 'hoy' ? 'entregados-hoy' : undefined}
              sub={`por fecha de entrega · $${resumen.montoEntregado.toFixed(2)}`}
              onClick={() => verResumenEnLista('out')} />
            <ResumenTile id="taller" titulo="En taller" valor={resumen.taller} tono="ambar"
              cargando={!resumenListo}
              sub="ahora · no depende del alcance" onClick={verTaller} />
            <ResumenTile id="listos" titulo="Listos para entregar" valor={resumen.listos} tono="neutro"
              cargando={!resumenListo}
              sub="ahora · estado «Por entregar»" onClick={verListos} />
          </div>

          {resumenEstado === 'error' && !resumenListo && (
            <p className="text-xs text-warning" data-resumen-error>
              No se pudieron leer los totales del resumen — volvé a intentar en un momento (los números de la lista de abajo sí se leyeron).
            </p>
          )}

          {/* El desglose por trabajo: es la respuesta a «cuántas pantallas hice hoy», sin chips y
              sin ruido — a lo sumo 5 trabajos por eje, con los números alineados. Tocar uno trae
              esos equipos a la lista. Si un equipo tiene 2 trabajos cuenta en cada uno (es el mismo
              criterio de los contadores de arriba, y la línea de alcance lo dice). */}
          <div className="grid gap-4 md:grid-cols-2">
            {([
              ['in', 'Qué se recibió', resumen.porTrabajoRecibidos, resumen.recibidos, resumen.recibidosSinTrabajo, resumen.recibidosNoTrabajo],
              ['out', 'Qué se entregó', resumen.porTrabajoEntregados, resumen.entregados, resumen.entregadosSinTrabajo, resumen.entregadosNoTrabajo],
            ] as const).map(([eje, titulo, lista, total, sinTrabajo, noTrabajo]) => (
              <div key={eje} data-resumen-desglose={eje}>
                <p className="text-xs font-semibold text-muted-foreground">
                  {titulo} <span className="font-normal">({total} {total === 1 ? 'equipo' : 'equipos'})</span>
                </p>
                {!resumenListo ? (
                  <p className="mt-1 text-xs italic text-muted-foreground" data-resumen-vacio={eje}>
                    Leyendo los totales…
                  </p>
                ) : total === 0 ? (
                  <p className="mt-1 text-xs italic text-muted-foreground" data-resumen-vacio={eje}>
                    {resumenKind === 'hoy'
                      ? (eje === 'in' ? 'Todavía no se recibió ningún equipo hoy.' : 'Todavía no salió ningún equipo hoy.')
                      : 'Sin equipos en este alcance.'}
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {topWorks(lista, 5).map(w => (
                      <li key={w.key}>
                        <button type="button" onClick={() => verResumenEnLista(eje, w.key)}
                          data-resumen-work={w.key} data-resumen-work-count={w.total}
                          title={`Ver en la lista: ${w.label} (${w.total})`}
                          className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-xs hover:bg-accent">
                          <span className="truncate">{w.label}</span>
                          <span className="font-semibold tabular-nums">{w.total}</span>
                        </button>
                      </li>
                    ))}
                    {lista.length > 5 && (
                      <li className="px-1.5 pt-0.5 text-[11px] text-muted-foreground">
                        y {lista.length - 5} trabajo{lista.length - 5 === 1 ? '' : 's'} más en este alcance
                      </li>
                    )}
                    {sinTrabajo > 0 && (
                      <li className="px-1.5 pt-0.5 text-[11px] text-muted-foreground">{sinTrabajo} sin trabajo anotado</li>
                    )}
                    {/* F59: si hay garantía/venta anotadas como trabajo, se dice — así el operario
                        entiende por qué el desglose no suma exactamente el total del día. */}
                    {noTrabajo > 0 && (
                      <li className="px-1.5 pt-0.5 text-[11px] text-muted-foreground" data-resumen-no-trabajo={eje}>
                        {noTrabajo} con garantía/venta anotada (no es un trabajo)
                      </li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* La LISTA que se está viendo: estos números SÍ siguen a los filtros y al trabajo elegido
          (F44 — el KPI y las tarjetas de abajo tienen que decir lo mismo). El resumen de arriba, en
          cambio, tiene su propio alcance: por eso van separados y cada uno dice a qué se refiere. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Equipos en la lista</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold" data-kpi="equipos">{visibleServices.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Listos para entregar en la lista</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-warning">{listos}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monto de la lista</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" title="Suma de los equipos que estás viendo (incluye devueltos y cancelados)">${totalAmount.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <EntregadosHoy
        services={entregadosHoy}
        paymentsMap={paymentsMap}
        tasaDia={tasaDia}
        onOpen={s => { setEditing(s); setShowForm(true); }}
        onPrint={s => setPrintFor(s)}
        onSeeAll={verEntregadosHoy}
      />

      {/* ── FILTROS (F44) ────────────────────────────────────────────────────────────────────────
          El estado va PRIMERO (es lo que más se consulta) y arranca en «Todos los estados»: el
          dueño pidió no abrir en «Activos en taller» porque lo entregado —justo lo que el cliente
          pregunta— quedaba escondido. Los tres controles son los mismos de siempre: BÚSQUEDA,
          ESTADO y FECHA (eje Recibidos/Entregados + rango + atajos de período). Un solo botón
          «Limpiar filtros» los quita todos (antes «Limpiar» borraba solo las fechas y el resto
          quedaba puesto sin que se notara). */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente, cédula, modelo, orden..." className="pl-9"
            ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44" aria-label="Filtrar por estado">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos los estados</SelectItem>
            <SelectItem value={ACTIVE_SENTINEL}>Activos en taller</SelectItem>
            {statuses.map(st => (
              <SelectItem key={st.id} value={st.name}>{st.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          {/* F32: el rango puede ir por fecha de RECIBIDO o de ENTREGADO (los rótulos lo dicen).
              F44: al pasar a «Entregados» ya NO se fuerza el estado a Entregado — con el filtro por
              defecto en «Todos los estados» el eje de entrega ya muestra solo lo que tiene fecha de
              entrega, así que el parche `estadoAuto` (y su lista vacía) dejó de ser necesario. */}
          <ToggleGroup type="single" value={dateField} className="h-9"
            onValueChange={v => { if (v) setDateField(v as 'in' | 'out'); }}>
            <ToggleGroupItem value="in" className="h-8 px-2.5 text-xs" title="Filtrar por fecha en que se recibió el equipo">Recibidos</ToggleGroupItem>
            <ToggleGroupItem value="out" className="h-8 px-2.5 text-xs" title="Filtrar por fecha en que se entregó el equipo">Entregados</ToggleGroupItem>
          </ToggleGroup>
          <Input type="date" className="w-36" value={dateStart}
            onChange={e => { setDateStart(e.target.value); if (!e.target.value) setDateEnd(''); }}
            title={dateField === 'out' ? 'Entregados desde' : 'Recibidos desde'}
            aria-label={dateField === 'out' ? 'Entregados desde' : 'Recibidos desde'} />
          <span className="text-xs text-muted-foreground">a</span>
          <Input type="date" className="w-36" value={dateEnd}
            min={dateStart || undefined}
            onChange={e => setDateEnd(e.target.value)}
            title={dateField === 'out' ? 'Entregados hasta' : 'Recibidos hasta'}
            aria-label={dateField === 'out' ? 'Entregados hasta' : 'Recibidos hasta'} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Período:</span>
          <Button variant="ghost" size="sm" onClick={() => setQuickPeriod(0)}>Hoy</Button>
          <Button variant="ghost" size="sm" onClick={() => setQuickPeriod(7)}>7 días</Button>
          <Button variant="ghost" size="sm" onClick={() => setQuickPeriod(30)}>30 días</Button>
          <Button variant="ghost" size="sm" onClick={() => setQuickPeriod(null)}
            title="Ver todo el historial (sin límite de fechas)">Todo el historial</Button>
        </div>
        {filtrosActivos && (
          <Button variant="ghost" size="sm" onClick={limpiarFiltros} data-action="limpiar-filtros"
            title="Quitar la búsqueda, el estado, el rango de fechas y el trabajo elegido">
            Limpiar filtros
          </Button>
        )}
        {/* F32: el pedido del dueño en un solo botón (y la respuesta rápida a «¿cuántas pantallas
            hiciste hoy?»: se pulsa acá y se lee el chip del trabajo) */}
        <Button variant="outline" size="sm" className="border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10"
          onClick={verEntregadosHoy} data-action="entregados-hoy">
          <CheckCircle2 className="size-3.5" /> Entregados hoy
          {entregadosHoy.length > 0 && (
            <span className="ml-1 rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold text-white">{entregadosHoy.length}</span>
          )}
        </Button>
      </div>

      {/* ── TRABAJOS (F44 + F57) ─────────────────────────────────────────────────────────────────
          F44 dejó los números confiables (el conteo de la lista visible, entregados incluidos) y su
          línea de alcance. F57 sacó el MURO DE CHIPS: la pantalla ya no dibuja un botón por etiqueta
          distinta (en la base real del cliente son 49, 24 de ellas con un solo equipo) sino UN solo
          selector con buscador — «que esté oculta y uno elija una específica», pedido del dueño
          (2026-09-21). Los números de la lista se siguen diciendo acá; el desglose de QUÉ se hizo
          (por trabajo) vive en el Resumen del día, que tiene su propio alcance. */}
      <div className="flex flex-col gap-1.5" data-report="trabajos">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <WorkPicker counts={report.porTrabajo} total={services.length} sinTrabajo={report.sinTrabajo}
            sinTrabajoEntregados={report.sinTrabajoEntregados} sinTrabajoTaller={report.sinTrabajoTaller}
            sinTrabajoAnulados={report.sinTrabajoAnulados}
            value={typeFilter} onChange={setTypeFilter} />
          <span className="text-sm text-muted-foreground" data-report-total>
            <span className="font-bold text-foreground">{report.equipos}</span> equipos en la lista
          </span>
          <span className="text-xs text-emerald-700">{report.entregados} entregados</span>
          <span className="text-xs text-warning">{report.taller} en taller</span>
          {report.anulados > 0 && <span className="text-xs text-danger">{report.anulados} devueltos/cancelados</span>}
        </div>
        <p className="text-xs text-muted-foreground" data-report-scope>{scopeLabel(alcance)}</p>
        {pagosSinCargar && (
          <p className="text-xs text-warning" data-note="pagos-no-cargados">
            Lista muy larga: el método de pago real se muestra hasta 120 equipos — acotá el rango de fechas para verlo.
          </p>
        )}
      </div>

      {visibleServices.length === 0 ? (
        <Card>
          {/* F44: el estado vacío explica la CAUSA. Antes decía «Sin servicios registrados» también
              cuando el culpable era el filtro (o una combinación imposible), y eso hacía creer que no
              había servicios. «Sin servicios registrados» queda solo para la base de verdad vacía
              (sin ningún filtro puesto): ahí el backend devuelve todo, así que 0 = no hay nada. */}
          <CardContent className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground"
            data-empty={services.length === 0 && !filtrosActivos ? 'sin-datos' : 'filtro'}>
            {services.length === 0 && !filtrosActivos ? (
              <span>Sin servicios registrados</span>
            ) : (
              <>
                <span>
                  {problemaAlcance === 'activos-sin-entrega'
                    ? 'Ningún equipo con fecha de ENTREGA puede seguir «Activo en taller»: una orden en el taller todavía no tiene fecha de entrega.'
                    : typeFilter
                      // El trabajo elegido no tiene equipos en lo que se está viendo: se dice CON SU
                      // NOMBRE (si no, el operario ve tres números que se contradicen y no sabe por qué).
                      ? 'El trabajo elegido no tiene equipos con estos filtros.'
                      : 'Sin equipos con estos filtros.'}
                </span>
                <span className="text-xs">{scopeLabel(alcance)}</span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {problemaAlcance === 'activos-sin-entrega' && (
                    <Button variant="outline" size="sm" onClick={() => setDateField('in')}>Cambiar a Recibidos</Button>
                  )}
                  {!!typeFilter && (
                    <Button variant="outline" size="sm" onClick={() => setTypeFilter('')} data-empty-quitar-trabajo>
                      Quitar el trabajo
                    </Button>
                  )}
                  {!!statusFilter && (
                    <Button variant="outline" size="sm" onClick={() => setStatusFilter('')}>Ver todos los estados</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={limpiarFiltros}>Limpiar filtros</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {groupItems.map(item => {
            if (item.type === 'group') {
              const svcs = item.services;
              // Las órdenes finalizadas (Devuelto/Cancelado) ya no deben: se excluyen del saldo
              const activas = svcs.filter(s => !isFinalized(s.status));
              const total = activas.reduce((a, s) => a + s.amount, 0);
              const abonado = activas.reduce((a, s) => a + s.paid_amount, 0);
              const saldo = total - abonado;
              // F38: el banner de la orden multi-equipo también dice el saldo en la moneda del cobro;
              // los movimientos son POR EQUIPO, así que se concatenan los de toda la orden.
              const pagosGrupo = activas.flatMap(s => paymentsMap[s.id] ?? []);
              const allFinalized = activas.length === 0;
              return (
                <Fragment key={`g-${item.groupId}`}>
                  <div className="col-span-full rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <Smartphone className="size-4 text-primary" /> Orden {item.groupId}
                    </span>
                    <span className="rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-bold">
                      {svcs.length} equipos
                    </span>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{svcs[0]?.client ?? '-'}</span>
                    <span className="text-xs font-semibold">Total ${total.toFixed(2)}</span>
                    <span className={cn('text-xs font-semibold', allFinalized ? 'text-muted-foreground' : saldo <= 0.005 ? 'text-success' : 'text-danger')}>
                      {allFinalized ? 'Finalizado' : saldo <= 0.005 ? 'Cancelado' : `Abonado $${abonado.toFixed(2)} · Saldo ${balanceLabel(orderBalance(total, abonado, pagosGrupo, tasaDia))}`}
                    </span>
                    <span className="ml-auto text-[11px] text-muted-foreground hidden lg:block">
                      Cada equipo se paga y entrega por separado
                    </span>
                  </div>
                  {!allFinalized && saldo > 0.005 && (
                    <div className="col-span-full">
                      <UnpaidBanner
                        neverPaid={abonado <= 0.005}
                        balance={saldo}
                        amount={total}
                        paid={abonado}
                        saldoTexto={balanceLabel(orderBalance(total, abonado, pagosGrupo, tasaDia))}
                      />
                    </div>
                  )}
                  {svcs.map((s, i) => renderServiceCard(s, item.groupId, i + 1, svcs.length))}
                </Fragment>
              );
            }
            return renderServiceCard(item.service, null, 0, 0);
          })}
        </div>
      )}

      {showForm && (
        <ServiceForm
          service={editing}
          statuses={statuses}
          dayOpen={dayOpen}
          turnoViejo={turnoViejo}
          tiposExtra={tiposExtra}
          onNuevaCategoria={agregarCategoria}
          /* F69: quitar una categoría del LOCAL la saca para todos → la ofrece el dueño
             (`remove_work_type_extra` pide su sesión). Agregar una nueva sí es del mostrador. */
          onQuitarCategoria={ab.manageCatalog ? quitarCategoria : undefined}
          canManageTecnicos={ab.manageCatalog}
          /* F80: el lápiz para editar la ficha del repuesto (precio, stock, compatibilidad) desde el
             wizard es del DUEÑO: el backend (`require_owner`) rechaza a la caja y la convención del
             proyecto es no dibujarle un botón que va a chocar contra el mensaje del PIN. */
          puedeEditarProducto={ab.manageCatalog}
          puedeCerrarCaja={ab.closeDay}
          /* F81 — CERRAR SIN REGISTRAR: si era un ALTA y no se creó nada, los filtros que había
             VUELVEN (un N apretado sin querer no le borra la búsqueda al operario). Si la orden SÍ se
             creó —aunque sea con el botón «Cobrar» del wizard (F79)— NO se restaura: la lista queda
             en el predeterminado mostrando la orden nueva, que es lo que pidió el dueño. */
          onClose={() => {
            const eraAlta = !editing;
            const creada = creadaEnWizard.current;
            creadaEnWizard.current = null;
            setShowForm(false);
            setEditing(null);
            if (eraAlta) {
              if (creada) setNuevaOrden(creada);
              else restaurarFiltrosPrevios();
            }
            refrescar();
          }}
          /* F81: al guardar un ALTA se reafirma el predeterminado (por si algo lo movió mientras el
             wizard estaba abierto) y la tarjeta recién creada queda resaltada con la lista bajada
             hasta ella. En EDICIÓN no se toca nada: `editing` sigue puesto y los filtros son del
             operario. */
          onSaved={(nueva) => {
            const eraAlta = !editing;
            // F81 (hallazgo de la revisión adversarial): si la orden se creó con el botón «Cobrar»
            // del wizard (F79) y después se pulsa «Guardar», `nueva` llega vacía — la orden creada
            // está en el ref. Sin este fallback el resaltado se perdía justo en ese camino.
            const objetivo = nueva ?? creadaEnWizard.current;
            creadaEnWizard.current = null;
            setShowForm(false);
            setEditing(null);
            if (eraAlta) {
              aplicarPredeterminado();
              if (objetivo) setNuevaOrden(objetivo);
            }
            refrescar();
          }}
          /* F79: el botón «Cobrar» del wizard guarda la orden y el registro SIGUE — la lista de atrás
             tiene que mostrar la orden nueva sin cerrar el formulario (por eso `refrescar`, no
             `onSaved`). F81: cuando el wizard trae la orden creada, se guarda para resaltarla al
             cerrarse (detrás del modal nadie vería el resaltado). */
          onListChanged={(creada) => {
            if (creada) creadaEnWizard.current = creada;
            refrescar();
          }}
          /* F77: el comprobante se abre por la MISMA vía que la tarjeta y el asistente de cierre. */
          onPrint={s => setPrintFor(s)}
        />
      )}

      {/* F46: los recordatorios de política (foto de entrada/salida y acuerdo de pago) salen como
          MODAL CENTRADO. El host se monta una sola vez acá, y como los tres momentos que avisan
          (guardar la recepción, entregar y abrir el comprobante) pasan por esta pantalla, alcanza
          con un host. */}
      <PolicyModalHost />

      {/* F49: descuento del servicio desde la tarjeta (se imprime en la factura). */}
      <DiscountDialog
        service={discountFor}
        open={!!discountFor}
        onOpenChange={o => { if (!o) setDiscountFor(null); }}
        onSaved={refrescar}
      />

      <PaymentDialog
        service={payFor}
        open={!!payFor}
        onOpenChange={(o) => { if (!o) setPayFor(null); }}
        dayOpen={dayOpen}
        puedeCerrarCaja={ab.closeDay}
        onSaved={refrescar}
      />

      {/* F34: cambio rápido de técnico (clic en el círculo/nombre del técnico de la tarjeta). */}
      <Dialog open={!!quickTech} onOpenChange={(o) => { if (!o) setQuickTech(null); }}>
        {/* F86 (REQ-8/AC-11) — patrón de la casa: con muchos técnicos la lista se salía de la
            pantalla y no había pie; ahora la lista de opciones es la que se desplaza. */}
        <DialogContent className="sm:max-w-sm max-h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle className="text-base">
              Cambiar técnico · {quickTech?.order_num}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col gap-1" data-quick-tech>
            <p className="text-xs text-muted-foreground">
              {quickTech?.client} · {quickTech?.model}
            </p>
            {technicians.map(t => {
              const actual = quickTech?.technician_id === t.id;
              return (
                <Button key={t.id} type="button" variant={actual ? 'default' : 'ghost'}
                  data-tech-option={t.id} disabled={savingTech}
                  aria-current={actual ? 'true' : undefined}
                  className="justify-start gap-2"
                  onClick={() => quickTech && cambiarTecnico(quickTech, t)}>
                  <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', t.color)}>
                    {t.initials}
                  </span>
                  <span className="truncate">{t.name}</span>
                  {actual && <Check className="ml-auto size-4" />}
                </Button>
              );
            })}
            <Button type="button" variant={quickTech?.technician_id == null ? 'default' : 'ghost'}
              data-tech-option="ninguno" disabled={savingTech}
              aria-current={quickTech?.technician_id == null ? 'true' : undefined}
              className="justify-start gap-2"
              onClick={() => quickTech && cambiarTecnico(quickTech, null)}>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-muted-foreground">
                <Users className="size-3" />
              </span>
              Sin asignar
              {quickTech?.technician_id == null && <Check className="ml-auto size-4" />}
            </Button>
            <p className="pt-1 text-[11px] text-muted-foreground">
              Se guarda al instante en la orden (no se toca ningún otro dato). ¿Falta alguien? Gestioná el
              padrón de técnicos desde el formulario de la orden.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <RefundDialog
        service={refundFor}
        open={!!refundFor}
        onOpenChange={(o) => { if (!o) setRefundFor(null); }}
        dayOpen={dayOpen}
        onGoToLedger={onGoToLedger}
        puedeCerrarCaja={ab.closeDay}
        onSaved={refrescar}
      />

      {/* F30: cola de entregas (F4). Elige la orden y abre el asistente con ella. */}
      <CierreQueueDialog
        open={showQueue}
        onOpenChange={setShowQueue}
        onPick={(s) => setCierreFor(s)}
      />

      {/* F30: asistente de cierre. Pide solo lo que falta (pantalla que se instaló y cobro),
          cobra y entrega en un mismo paso y ofrece el recibo. */}
      <CierreServiceDialog
        service={cierreFor}
        open={!!cierreFor}
        onOpenChange={(o) => { if (!o) setCierreFor(null); }}
        dayOpen={dayOpen}
        puedeCerrarCaja={ab.closeDay}
        onSaved={refrescar}
        onPrint={(s) => setPrintFor(s)}
      />

      <PrintReceiptDialog
        serviceId={printFor?.id ?? null}
        open={!!printFor}
        onOpenChange={(o) => { if (!o) setPrintFor(null); }}
        onPrinted={load}
      />

      <PrinterSettingsDialog open={showPrinterSettings} onOpenChange={setShowPrinterSettings} />

      <AlertDialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar orden?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará la orden {deleting?.order_num} de {deleting?.client}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && handleDelete(deleting)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDeliver} onOpenChange={() => setConfirmDeliver(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Entregar con saldo pendiente</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="flex flex-col gap-2">
                <p>
                  La orden <strong>{confirmDeliver?.order_num}</strong> de {confirmDeliver?.client} aún tiene{' '}
                  <strong className="text-danger">${((confirmDeliver?.amount ?? 0) - (confirmDeliver?.paid_amount ?? 0)).toFixed(2)} pendientes</strong>.
                </p>
                <p className="text-sm text-muted-foreground">
                  El cliente no ha pagado la totalidad del monto. Puedes cobrar el saldo con el botón "Pago / Abono" antes de entregar.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDeliver && deliver(confirmDeliver)}>
              Entregar con saldo pendiente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormDevice {
  model: string;
  color: string;
  fault: string;
  serviceTypes: string[];
  otherFault: string;
  amount: number;
  discount: number;
  payment: string;
  bankFeePercent: number;
  zelleReference: string;
  checklist: Record<string, string>;
  amountTouched: boolean;
  discountTouched: boolean;
  modelPicked: boolean;
  screenProductId: number | null;
  /** true = el técnico confirmó entregar una pantalla AGOTADA (queda faltante) */
  screenConfirm: boolean;
  /**
   * F65c — la pantalla que el operario eligió BUSCÁNDOLA a mano: no venía en la compatibilidad del
   * modelo, así que no está en `screenOptions` y hay que guardarla aparte para poder mostrarla como
   * elegida (y para que los avisos de stock/otra marca sigan funcionando). Es estado de FORMULARIO:
   * no viaja al backend (lo que se guarda es `screen_product_id`).
   */
  screenExtra?: ScreenCandidate | null;
}

function emptyDevice(): FormDevice {
  return {
    model: '', color: '', fault: '', serviceTypes: ['Cambio pantalla'], otherFault: '', amount: 0,
    discount: 0, payment: 'Divisas (USD Cash)', bankFeePercent: 0, zelleReference: '', checklist: checklistDefaults(),
    amountTouched: false, discountTouched: false, modelPicked: false, screenProductId: null,
    // F47: la confirmación de «pantalla agotada» arranca MARCADA — el aviso queda en rojo y el
    // guardado no depende de tocarla (pedido del dueño: «dejarlo predeterminado, que no te bloquee
    // pero sí deje el mensaje en rojo»).
    screenConfirm: true,
  };
}

// Auto-precio al elegir un modelo del catálogo: lo resuelve la regla pura `lib/screen-price.ts`
// (`groupPriceFields` sobre los candidatos YA CARGADOS del modelo, `priceFields` para la pantalla
// elegida). Antes esta cuenta vivía acá (`applyModelPrice`) y tenía dos defectos medidos en F67:
// leía la lista de candidatos del MODELO ANTERIOR y, en efectivo, dejaba el Total en
// 2·contado − lista. Los dos caminos de precio (pantalla y modelo) comparten ahora una sola regla.
// Colores predefinidos del equipo — selección rápida sin escribir.
// F46: se agregaron «Lila» y «Marrón» (pedido del dueño: «en los colores de servicios agregar un
// color más lila y marrón»). El color del equipo se guarda por NOMBRE en la orden, así que sumar
// opciones no toca nada de lo ya registrado.
const DEVICE_COLORS = [
  'Azul', 'Azul oscuro', 'Celeste',
  'Rojo', 'Rosado',
  'Blanco', 'Negro', 'Gris',
  'Amarillo', 'Naranja',
  'Verde', 'Morado', 'Lila',
  'Dorado', 'Marrón', 'Plateado',
];

// Select de color con valores predefinidos (colores viejos escritos a mano se conservan como opción).
function ColorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = value && !DEVICE_COLORS.includes(value)
    ? [...DEVICE_COLORS, value]
    : DEVICE_COLORS;
  return (
    <Select value={value} onValueChange={onChange}>
      {/* F48: `data-ficha-target` para que «Ir al campo» de la ficha deje el foco acá. */}
      <SelectTrigger className={cn(!value && 'text-muted-foreground')} data-ficha-target="color">
        <SelectValue placeholder="Sin especificar" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">— Sin especificar —</SelectItem>
        {options.map(c => (
          <SelectItem key={c} value={c}>
            <span className="inline-flex items-center gap-2">
              <span className={cn('inline-block size-2.5 rounded-full border border-border/50', colorDot(c))} />
              {c}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Punto de color para el Select (clases Tailwind estáticas).
function colorDot(color: string): string {
  const map: Record<string, string> = {
    'Azul': 'bg-blue-500', 'Azul oscuro': 'bg-blue-900', 'Celeste': 'bg-sky-400',
    'Rojo': 'bg-red-600', 'Rosado': 'bg-pink-500',
    'Blanco': 'bg-white', 'Negro': 'bg-neutral-950', 'Gris': 'bg-neutral-400',
    'Amarillo': 'bg-yellow-400', 'Naranja': 'bg-orange-500',
    'Verde': 'bg-green-600', 'Morado': 'bg-purple-600', 'Lila': 'bg-violet-400',
    'Dorado': 'bg-amber-500', 'Marrón': 'bg-amber-800', 'Plateado': 'bg-slate-300',
  };
  return map[color] || 'bg-neutral-400';
}

/**
 * F67 — EL PRECIO DEL REPUESTO, en una sola pieza para los DOS formularios (alta por equipos y
 * edición). Dice de dónde salió el monto que está en el campo y ofrece los otros precios a un toque:
 *
 *  - `Precio de «Pantalla Xiaomi Redmi 10C»: $12.50` → el monto se tomó solo de la ficha ELEGIDA.
 *  - `Precio del modelo: $12.50` → el monto salió del grupo de repuestos del modelo (el respaldo que
 *    ya existía, «el que tengo al lado de modelos»).
 *  - Botón **«Usar precio de la pantalla $P»** cuando el monto es otro (el operario ya lo escribió, o
 *    es el precio que traía la orden): un toque y queda el de la ficha elegida. NUNCA se pisa solo.
 *  - Botón **«Precio del modelo $M»** para volver al del modelo.
 *  - Si la ficha elegida **no tiene precio cargado**, se dice con todas las letras en vez de dejar el
 *    monto vacío sin explicación (hay fichas de inventario sin precio: el taller cobra a mano).
 *
 * Es solo presentación: la cuenta la hace `lib/screen-price.ts` (regla pura probada sin navegador).
 */
function PrecioRepuesto({ fuente, monto, ofertaPantalla, ofertaModelo, elegida, sinPrecio, avisoSinOferta = false, onUsar }: {
  fuente: PriceSource;
  /** El monto que hay HOY en el campo (para no ofrecer el que ya está escrito). */
  monto: number;
  ofertaPantalla: PriceFields | null;
  ofertaModelo: PriceFields | null;
  /** Nombre de la pantalla elegida (para poder decir de qué ficha salió el precio). */
  elegida: string | null;
  /** Hay una pantalla elegida y esa ficha no tiene precio en el catálogo. */
  sinPrecio: boolean;
  /** El monto tiene un número que ya no respalda ninguna oferta (el sistema no lo escribió ahora). */
  avisoSinOferta?: boolean;
  onUsar: (f: PriceFields) => void;
}) {
  const chip = 'inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground';
  const pantalla = ofertaPantalla?.amount ?? null;
  const modelo = ofertaModelo?.amount ?? null;
  const usaPantalla = pantalla != null && sameMoney(monto, pantalla);
  const usaModelo = modelo != null && sameMoney(monto, modelo);
  const rotulo = fuente === 'pantalla'
    ? `Precio de «${elegida ?? 'la pantalla elegida'}»: $${monto.toFixed(2)}`
    : fuente === 'modelo' ? `Precio del modelo: $${monto.toFixed(2)}` : '';
  const hayAlgo = !!rotulo || sinPrecio || avisoSinOferta || (pantalla != null && !usaPantalla) || (modelo != null && !usaModelo);
  if (!hayAlgo) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-precio-repuesto data-precio-fuente={fuente}>
      {rotulo && (
        <span className="text-xs text-muted-foreground" data-precio-rotulo>
          {rotulo}
          {ofertaPantalla && ofertaPantalla.discount > 0 && (
            <span className="ml-1 text-[11px]">(contado ${(ofertaPantalla.amount - ofertaPantalla.discount).toFixed(2)})</span>
          )}
        </span>
      )}
      {pantalla != null && !usaPantalla && (
        <button type="button" className={chip} data-usar-precio-pantalla={pantalla}
          onClick={() => onUsar(ofertaPantalla!)}
          title={`Escribir en el monto el precio de venta de «${elegida ?? 'la pantalla elegida'}»`}>
          Usar precio de la pantalla ${pantalla.toFixed(2)}
        </button>
      )}
      {modelo != null && !usaModelo && (
        <button type="button" className={chip} data-usar-precio-modelo={modelo}
          onClick={() => onUsar(ofertaModelo!)}
          title="Escribir el precio que sale de los repuestos compatibles del modelo">
          {pantalla != null ? `Precio del modelo $${modelo.toFixed(2)}` : `Usar precio del modelo $${modelo.toFixed(2)}`}
        </button>
      )}
      {sinPrecio && (
        <span className="text-[11px] text-amber-600" data-pantalla-sin-precio>
          «{elegida}» no tiene precio cargado en el catálogo: escribí el monto{modelo != null ? ' o usá el del modelo' : ''}.
        </span>
      )}
      {avisoSinOferta && (
        <span className="text-[11px] text-muted-foreground" data-precio-sin-oferta>
          Revisá el monto: este modelo no tiene un precio único en el catálogo. Elegí la pantalla para tomar su precio.
        </span>
      )}
    </div>
  );
}

// Un equipo dentro de una orden multi-equipo (solo modo crear):
// modelo (con sugerencias), monto, trabajos/fallas, blindaje colapsable y finanzas propias.
/**
 * F62 — «+ NUEVA CATEGORÍA» (pedido del dueño, 2026-09-21): «en las categorías o los types, donde
 * sale Otro, cuando vas a hacer un registro poder registrar ahí mismo una nueva categoría con un +».
 *
 * Se escribe el nombre, se guarda en la base (settings `work_types_extra`) y queda ELEGIDA en la
 * orden que se está registrando. Si lo escrito es un sinónimo de una categoría que YA existe (tabla
 * de F58), se AVISA y se guarda con el nombre canónico: es exactamente el problema que F58 arregla,
 * así que no lo volvemos a crear con otro nombre.
 */
function NuevaCategoriaChip({ onAgregar, onCancelar, existentes, locales = [], onQuitar }: {
  onAgregar: (nombre: string) => Promise<string | null>;
  onCancelar: () => void;
  existentes: string[];
  /** F62: las categorías que agregó ESTE local (se pueden quitar desde acá) */
  locales?: string[];
  onQuitar?: (nombre: string) => Promise<boolean>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  // F65 (2ª vuelta): Escape cierra ESTE panel, no el asistente de la orden. Sin esto, Radix (que
  // escucha Escape en la captura de `document`) cerraba el formulario del servicio ENTERO y se perdía
  // la orden que se estaba registrando. Mismo defecto medido y arreglado en el «+ Nueva categoría»
  // del producto (`useEscapeGuard`).
  useEscapeGuard(abierto, () => { setNombre(''); setAbierto(false); onCancelar(); });
  if (!abierto) {
    return (
      <button type="button" data-nueva-categoria
        title="Agregar una categoría nueva de este local (queda guardada para las próximas órdenes)"
        className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        onClick={() => setAbierto(true)}>
        <Plus className="size-3 inline mr-1" /> Nueva categoría
      </button>
    );
  }
  const limpio = nombre.trim();
  const sinonimo = aliasDeTrabajo(limpio);
  const yaExiste = existentes.some(t => foldWork(t) === foldWork(limpio));
  const puede = limpio.length > 0 && !yaExiste && !guardando;
  const guardar = async () => {
    if (!puede) return;
    setGuardando(true);
    const guardado = await onAgregar(limpio);
    setGuardando(false);
    if (guardado) { setNombre(''); setAbierto(false); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-2">
      <Input autoFocus value={nombre} data-nueva-categoria-input
        onChange={e => setNombre(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void guardar(); }
          if (e.key === 'Escape') onCancelar();
        }}
        placeholder="Nombre de la categoría (ej: Cambio de tapa)" className="h-8 w-56 text-sm" />
      <Button type="button" size="sm" className="h-8" disabled={!puede} onClick={() => void guardar()}>
        {guardando ? 'Guardando…' : 'Agregar'}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onCancelar}>Cancelar</Button>
      {yaExiste && <p className="w-full text-[11px] text-danger">Esa categoría ya está en la lista.</p>}
      {!yaExiste && sinonimo && (
        <p className="w-full text-[11px] text-amber-700" data-nueva-categoria-aviso>
          «{limpio}» ya es un trabajo de la lista: se guardará como «{sinonimo}».
        </p>
      )}
      {/* F62: las categorías que ya agregó ESTE local, con su ✕ para deshacer un error de tipeo.
          Quitar una categoría NO toca las órdenes ya registradas (la etiqueta vive en cada orden). */}
      {locales.length > 0 && (
        <div className="w-full border-t border-border/60 pt-1.5">
          <p className="text-[11px] text-muted-foreground">Categorías de este local (quitá las que no uses):</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {locales.map(l => (
              <span key={l} data-categoria-local={l}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]">
                {l}
                {onQuitar && (
                  <button type="button" data-quitar-categoria={l} title="Quitar esta categoría del local"
                    className="text-muted-foreground hover:text-danger" onClick={() => void onQuitar(l)}>✕</button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
/**
 * F80 — LA PANTALLA ELEGIDA, VIVA (no dibuja nada: solo mantiene al día lo que el wizard muestra de la
 * ficha del repuesto). Cuando algo del catálogo cambia (el bus de sincronización, F76), la ficha elegida
 * y la buscada a mano se RELEEN por id:
 *   · si se BORRÓ desde Inventario, se SUELTA la elección — una orden con `screen_product_id` muerto no
 *     se puede entregar (el movimiento de inventario no puede apuntar a una ficha que no existe);
 *   · si cambió (precio o stock), se refresca la copia para que los avisos de stock no mientan;
 *   · si dejó de figurar entre las opciones compatibles (el operario le quitó este modelo a la ficha),
 *     se marca como «elegida a mano» (F65c) para que el aviso lo diga, en vez de quedar una pantalla
 *     invisible que igual descuenta stock.
 * (Los tres casos los marcó la revisión adversarial: «Ficha completa» traía el botón Eliminar al
 * wizard y el atajo permite cambiar la compatibilidad.)
 */
function PantallaViva({ elegidaId, extra, enLaLista, listo, onPerdida, onExtra }: {
  elegidaId: number | null;
  extra: ScreenCandidate | null;
  /** ¿la elegida figura entre las opciones compatibles del modelo? */
  enLaLista: boolean;
  /** ¿ya se resolvió la compatibilidad de este modelo? (evita marcar «buscada» con la lista en camino) */
  listo: boolean;
  onPerdida: () => void;
  onExtra: (c: ScreenCandidate | null) => void;
}) {
  const dataVersion = useDataVersion();
  const perdidaRef = useRef(onPerdida);
  const extraRef = useRef(onExtra);
  perdidaRef.current = onPerdida;
  extraRef.current = onExtra;
  const extraId = extra?.product?.id ?? null;

  // 1) la ficha elegida: ¿sigue existiendo?
  useEffect(() => {
    if (elegidaId == null) return;
    let vivo = true;
    api.getProduct(elegidaId)
      .then(p => { if (vivo && !p) perdidaRef.current(); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [elegidaId, dataVersion]);

  // 2) la copia de la pantalla buscada a mano (F65c): se refresca (o se suelta si ya no está)
  useEffect(() => {
    if (extraId == null) return;
    let vivo = true;
    api.getProduct(extraId)
      .then(p => {
        if (!vivo) return;
        if (!p) { extraRef.current(null); perdidaRef.current(); return; }
        const viejo = extra?.product;
        if (!viejo || p.stock !== viejo.stock || p.price_sale !== viejo.price_sale || p.price_usd !== viejo.price_usd) {
          extraRef.current({ ...(extra as ScreenCandidate), product: p, in_stock: (p.stock ?? 0) > 0 });
        }
      })
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraId, dataVersion]);

  // 3) elegida que ya no figura como compatible: se conserva (es una pantalla real del catálogo y al
  //    entregar se descuenta) pero se marca como elegida a mano para que el aviso lo diga.
  useEffect(() => {
    if (elegidaId == null || !listo || enLaLista) return;
    if (extra?.product.id === elegidaId) return;
    let vivo = true;
    api.getProduct(elegidaId)
      .then(p => {
        if (!vivo || !p) return;
        extraRef.current({ product: p, in_stock: (p.stock ?? 0) > 0, match_quality: 'buscada', brand_match: true, brand_known: false });
      })
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegidaId, enLaLista, listo, dataVersion]);

  return null;
}

/**
 * F80 — EL LÁPIZ DE LA FICHA DEL REPUESTO (el estado y los datos que comparten el alta por equipos y
 * la edición): qué ficha se está editando (`null` = la pantalla que falta), las categorías que necesita
 * el formulario, y la recarga de la compatibilidad al guardar. Una sola implementación para los dos
 * lados del wizard (misma regla que `CobroEnWizard`).
 */
function useFichaDeRepuesto(reloadCompat: () => void) {
  /** `null` = cerrado · `{producto: null}` = alta de la pantalla que falta · `{producto: p}` = editar p */
  const [abierto, setAbierto] = useState<{ producto: Product | null; catPantalla: number } | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const catsRef = useRef<Category[]>([]);
  catsRef.current = cats;
  /**
   * F80 — LAS CATEGORÍAS PRIMERO (bloqueante de la 2ª revisión adversarial, medido en vivo): si el
   * diálogo se montaba con la lista de categorías todavía vacía, la pantalla nueva nacía SIN CATEGORÍA
   * y, como `onlyScreens()` filtra `category_id === 1`, **no aparecía en la lista del wizard** (ni en el
   * buscador, ni en el padrón, ni en el asistente de cierre) aunque el toast dijera «registrada».
   * Por eso el diálogo se abre recién cuando las categorías están (8 filas: milisegundos).
   */
  const abrir = useCallback(async (producto: Product | null) => {
    let lista = catsRef.current;
    if (lista.length === 0) {
      lista = await api.getCategories().catch(() => [] as Category[]);
      setCats(lista);
    }
    // El fallback es el id canónico de Pantalla (1) y NO `cats[0]`: por orden alfabético sería
    // «Accesorio» y la pantalla nacería fuera del padrón.
    setAbierto({ producto, catPantalla: lista.find(c => /^pantalla$/i.test(c.name.trim()))?.id ?? 1 });
  }, []);
  const cerrar = useCallback(() => setAbierto(null), []);
  const guardado = useCallback(() => {
    setAbierto(null);
    // La lista vuelve a pedirse para mostrar el precio/stock REALES (si no, la fila miente). Las OTRAS
    // listas del wizard (buscador libre, la copia de la pantalla buscada a mano, el otro equipo de la
    // misma recepción) se ponen al día solas con el bus de sincronización (F76).
    reloadCompat();
  }, [reloadCompat]);
  return { abierto, cats, abrir, cerrar, guardado };
}

/**
 * F80 — EL DIÁLOGO DE LA FICHA (el mismo para el alta y la edición). Se dibuja UNA vez por formulario
 * y solo cuando hay algo abierto.
 */
function FichaDeRepuestoDialog({ estado, cats, catPantallaId, modelo, puedeCategorias, onClose, onSaved }: {
  estado: { producto: Product | null } | null;
  cats: Category[];
  catPantallaId: number | null;
  modelo: string;
  puedeCategorias: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  if (!estado) return null;
  return (
    <EditarProductoDialog
      producto={estado.producto}
      modeloDelEquipo={modelo}
      categories={cats}
      categoriaSugeridaId={catPantallaId}
      puedeCategorias={puedeCategorias}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function DeviceFields({ device, onChange, methods, index, onRemove, canRemove, hideChecklist = false, onScreenValid, autoFocus = false, tiposExtra = [], onNuevaCategoria, onQuitarCategoria, iva = IVA_DEFAULT, tasa = 0, onCobrar, cobroEstado, cobroAviso, cobrando = false, puedeEditarProducto = false }: {
  device: FormDevice;
  onChange: (patch: Partial<FormDevice>) => void;
  methods: { id: number; name: string }[];
  index: number;
  onRemove: () => void;
  canRemove: boolean;
  hideChecklist?: boolean;
  /** informa al formulario si este equipo tiene resuelta la pantalla */
  onScreenValid?: (index: number, valid: boolean) => void;
  /** F31: al entrar al paso «Equipos» el foco cae en el modelo del primer equipo */
  autoFocus?: boolean;
  /** F62: categorías de trabajo que agregó el local (van después de las canónicas) */
  tiposExtra?: string[];
  /** F62: agrega una categoría nueva y devuelve el nombre GUARDADO (null si falló) */
  onNuevaCategoria?: (nombre: string) => Promise<string | null>;
  /** F74 — la configuración del IVA y la tasa del turno (para el desglose del monto) */
  iva?: IvaConfig;
  tasa?: number;
  /** F62: quita una categoría del local */
  onQuitarCategoria?: (nombre: string) => Promise<boolean>;
  /** F79 — el cobro de ESTE equipo (el botón vive al lado del color); sin la prop no se dibuja */
  onCobrar?: (index: number) => void;
  /** F79 — el estado del dinero de este equipo (solo cuando la orden ya existe) */
  cobroEstado?: EstadoCobro | null;
  /** F79 — lo que hay que decir antes de cobrar (aviso, nunca bloqueo) */
  cobroAviso?: string | null;
  /** F79 — hay un guardado en curso (el botón de cobro se apaga) */
  cobrando?: boolean;
  /** F80 — sesión master: se dibuja el lápiz para editar la ficha del repuesto sin salir del wizard */
  puedeEditarProducto?: boolean;
}) {
  const [showChecklist, setShowChecklist] = useState(false);

  const isPos = device.payment.includes('Punto');
  const isZelle = device.payment.includes('Zelle');
  const isPagoMovil = device.payment.includes('Móvil') || device.payment.includes('Movil');
  const isDivisas = device.payment === 'Divisas (USD Cash)';
  // Monto = PRECIO del servicio; Total a pagar = Monto − Descuento (lo que se guarda)
  const deviceNet = Math.max(0, device.amount - device.discount);

  // Compatibilidad resuelta por el backend para el modelo escrito
  const { candidates, loading: compatLoading, alDia: compatAlDia, reload: reloadCompat } = useCompatibleProducts(device.model);
  // F80: el lápiz de la ficha del repuesto (precio, stock, compatibilidad) sin salir del wizard.
  const ficha = useFichaDeRepuesto(reloadCompat);
  const screenOptions = useMemo(() => onlyScreens(candidates), [candidates]);
  // F65c: si el operario buscó OTRA pantalla (que no está en la compatibilidad del modelo), se suma
  // a las opciones para que figure como ELEGIDA y con sus avisos (stock / otra marca). El gate
  // (`screenOk`) solo pide que haya una elegida, así que esto no lo relaja: lo hace visible.
  const screenOptionsTodas = useMemo(
    () => (device.screenExtra && !screenOptions.some(o => o.product.id === device.screenExtra!.product.id)
      ? [device.screenExtra, ...screenOptions]
      : screenOptions),
    [screenOptions, device.screenExtra],
  );
  const isScreenJob = device.serviceTypes.includes('Cambio pantalla');
  // F63: con un trabajo que NO es de pantalla, el bloque de compatibilidad se consulta igual (la
  // consulta ya se hacía) pero se muestra plegado, para no llenar el formulario de un trabajo simple.
  const [verCompat, setVerCompat] = useState(false);

  /**
   * F53 — la pantalla de REFERENCIA del modelo elegido en el padrón (`phones.default_product_id`).
   * Viene con la fila del combobox (el mismo dato que el local fija en Inventario → Productos →
   * «Por modelo»); `autoScreen` la usa para auto-seleccionarla.
   */
  const [refProductId, setRefProductId] = useState<number | null>(null);
  useEffect(() => {
    // al escribir un modelo a mano (o al abrir una orden vieja) se busca su referencia en el padrón
    const label = device.model.trim();
    if (label.length < 3) { setRefProductId(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.getPhoneModelsInUse(label, 5, false)
        .then(list => {
          if (!alive) return;
          const fila = list.find(m => m.label.trim().toLowerCase() === label.toLowerCase());
          setRefProductId(fila?.default_product_id ?? null);
        })
        .catch(() => { if (alive) setRefProductId(null); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [device.model]);

  // El formulario necesita saber si este equipo tiene la pantalla resuelta
  const screenValid = screenOk(device.serviceTypes, device.screenProductId, screenOptionsTodas);
  useEffect(() => {
    onScreenValid?.(index, screenValid);
  }, [index, screenValid, onScreenValid]);

  // La pantalla de REFERENCIA del modelo se elige sola (F53); sin referencia, UNA sola con stock Y de
  // la MISMA marca del teléfono (evita que el operario entregue una agotada por descuido y que se
  // descuente la pantalla de OTRO teléfono por coincidir el texto del modelo). Regla pura
  // en lib/screen-rules.ts.
  useEffect(() => {
    if (!isScreenJob || device.screenProductId != null) return;
    const auto = autoScreen(screenOptions, refProductId);
    if (auto) onChange({ screenProductId: auto.product.id, screenConfirm: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenOptions, isScreenJob, device.screenProductId, refProductId]);

  // F65c: al CAMBIAR de modelo, la pantalla buscada a mano del modelo anterior deja de tener sentido
  // (era «otra pantalla» para ESE teléfono): se suelta para no arrastrar un repuesto de otro equipo.
  useEffect(() => {
    if (device.screenExtra) onChange({ screenExtra: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.model]);

  /**
   * F89 — Y TAMBIÉN LA PANTALLA ELEGIDA, si ya no es de este modelo.
   *
   * Medido con su catálogo (2026-10-05): con un equipo en «A35E» la pantalla se elige sola (y toma su
   * precio, $15); al cambiar el modelo a «Camon 17» la pantalla del A35E **seguía elegida** —y con ella
   * su precio— aunque no esté en la compatibilidad del Camon 17: el operario veía un repuesto de OTRO
   * modelo puesto en el equipo (su queja: «no puede darme de otro modelo que no es») y el monto quedaba
   * en el precio del modelo anterior.
   *
   * La regla: cuando los candidatos ya son de ESTE modelo (`alDia`) y la pantalla elegida no está entre
   * ellos, se suelta. El operario que quiera OTRA pantalla la busca a mano con «buscar otra pantalla»
   * (esa sí se conserva como `screenExtra`, con sus avisos) — y en el asistente de cierre no se toca
   * nada: la elección ya es definitiva y no hay cambio de modelo.
   */
  useEffect(() => {
    if (!compatAlDia || device.screenProductId == null) return;
    const esta = screenOptionsTodas.some(o => o.product.id === device.screenProductId);
    if (!esta) onChange({ screenProductId: null, screenConfirm: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compatAlDia, screenOptionsTodas, device.model, device.screenProductId]);

  const selectModel = (label: string) => {
    // F67: acá SOLO se elige el modelo. El precio (de la pantalla elegida o del grupo del modelo) lo
    // escribe el efecto de abajo, cuando los candidatos de ESTE modelo ya están cargados: antes se
    // aplicaba en esta misma pasada con `candidates` — la lista del modelo ANTERIOR.
    onChange({ model: label, modelPicked: true });
  };

  // ── F67 — EL PRECIO DEL REPUESTO ─────────────────────────────────────────────────────────────
  // La pantalla ELEGIDA es el dato exacto (es la ficha que se instala): su precio de venta manda. El
  // precio del grupo de repuestos del MODELO («el que tengo al lado de modelos») queda de respaldo
  // —se usa cuando la pantalla no tiene precio cargado— y siempre disponible como botón para volver.
  //
  // Las DOS ofertas se calculan solo con `compatAlDia` (los candidatos cargados son de ESTE modelo):
  // durante el rebote de la consulta, `candidates` todavía es la lista del modelo anterior y de ahí no
  // se saca plata (`useCompatibleProducts` lo declara con `alDia`).
  const pantallaElegida = useMemo(
    () => (compatAlDia ? screenOptionsTodas.find(o => o.product.id === device.screenProductId) ?? null : null),
    [compatAlDia, screenOptionsTodas, device.screenProductId],
  );
  // La pantalla solo aporta precio si el trabajo incluye «Cambio pantalla»: con otro trabajo (batería,
  // software…) el bloque de pantalla es SOLO de referencia (F63) y su precio no puede mover el monto.
  const ofertaPantalla = useMemo(
    () => (isScreenJob && pantallaElegida ? priceFields(pantallaElegida.product, isDivisas) : null),
    [isScreenJob, pantallaElegida, isDivisas],
  );
  const ofertaModelo = useMemo(
    () => (compatAlDia ? groupPriceFields(candidates.map(c => c.product), isDivisas) : null),
    [compatAlDia, candidates, isDivisas],
  );
  // Qué se escribe SOLO (sin que nadie lo pida) cuando el monto todavía es de la regla:
  //  · con «Cambio pantalla» → el precio de la ficha elegida y, si esa ficha no tiene precio, el del modelo;
  //  · con otro trabajo → el precio del modelo (la pantalla es de referencia), y **nunca** si la ficha
  //    elegida SÍ tiene precio: ese precio ya se había escrito y destildar el trabajo no puede rebajar
  //    (ni subir) el monto en silencio.
  const precioPantallaElegida = useMemo(
    () => (pantallaElegida ? priceFields(pantallaElegida.product, isDivisas) : null),
    [pantallaElegida, isDivisas],
  );
  const ofertaAuto = isScreenJob
    ? (precioPantallaElegida ?? ofertaModelo)
    : (precioPantallaElegida ? null : ofertaModelo);
  const fuente = priceSource(device.amount, ofertaPantalla?.amount ?? null, ofertaModelo?.amount ?? null);

  // Se escribe solo mientras el operario no haya tocado el monto (`pricePatch`): lo que él escribió
  // NUNCA se pisa, y el descuento CALCULADO viaja con el monto sugerido (no se le rebaja a un precio
  // que escribió él).
  const aplicarPrecio = useMemo(
    () => pricePatch(ofertaAuto, { amount: device.amountTouched, discount: device.discountTouched }),
    [ofertaAuto, device.amountTouched, device.discountTouched],
  );
  useEffect(() => {
    const cambios: Partial<FormDevice> = {};
    if (aplicarPrecio.amount !== undefined && !sameMoney(aplicarPrecio.amount, device.amount)) cambios.amount = aplicarPrecio.amount;
    if (aplicarPrecio.discount !== undefined && !sameMoney(aplicarPrecio.discount, device.discount)) cambios.discount = aplicarPrecio.discount;
    if (Object.keys(cambios).length > 0) onChange(cambios);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aplicarPrecio, device.amount, device.discount]);

  /** Un toque del operario: se escribe la oferta y queda como SU elección (no se vuelve a tocar). */
  const usarPrecio = (f: PriceFields) =>
    onChange({ amount: f.amount, discount: f.discount, amountTouched: true, discountTouched: true });

  /**
   * El monto a mano: se limpia el descuento CALCULADO (el que puso la regla, que él no escribió) — el
   * precio que se cobra es el que él escribió. Un descuento suyo (`discountTouched`) se conserva.
   */
  const teclearMonto = (v: number) =>
    onChange({ ...amountTypedPatch(v, device.discountTouched), amountTouched: true });

  // Catálogo sin precios para este modelo: el descuento se escribe a mano
  // F67 (revisión adversarial): el aviso se decide con la MISMA regla de precio, no con `price_sale`
  // crudo — una ficha con venta 0 y precio contado cargado SÍ se cobra (el contado), así que decir
  // «sin precios en el catálogo» al lado de un monto que la regla acaba de escribir sería mentir.
  const noCatalogPrice = useMemo(
    () => candidates.length > 0 && candidates.every(c => priceFields(c.product, isDivisas) == null),
    [candidates, isDivisas],
  );
  // El monto quedó con un número que ya no respalda ninguna oferta (típico: se cambió el modelo y el
  // nuevo no tiene un precio único): se dice, porque el monto «sin tocar» parece escrito a mano.
  const avisoSinOferta = !device.amountTouched && device.amount > 0 && !ofertaAuto && !compatLoading
    && !ofertaPantalla && !ofertaModelo && device.model.trim().length >= 3;

  return (
    <div className="rounded-xl border border-border/70 p-4 flex flex-col gap-3" data-device={index}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Smartphone className="size-4 text-primary" /> Equipo {index + 1}
        </p>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
          onClick={onRemove} disabled={!canRemove}>
          <Trash2 className="size-3.5" /> Quitar
        </Button>
      </div>

      {/* F77b — EL MÉTODO DE PAGO VA PRIMERO (pedido del dueño, 2026-09-25): «el método de pago, el
          mensaje debería preguntarlo antes, en el paso 2 «Equipo», antes de colocar el modelo de
          teléfono, así le avisa para colocar el monto o un producto en ese momento». Con el cliente
          enfrente, primero se acuerda CÓMO paga y recién después se cargan modelo, monto y repuesto. */}
      <div className="grid grid-cols-2 gap-4" data-device-pay={index}>
        <div className="space-y-2">
          <label className="text-sm font-medium">Método de Pago</label>
          {/* F31: los 3 métodos que más se usan a un toque; el resto en «Otros métodos…» */}
          <PaymentMethodPicker
            methods={methods}
            value={device.payment}
            size="sm"
            onChange={v => {
              const patch: Partial<FormDevice> = { payment: v };
              if (v.includes('Punto')) patch.bankFeePercent = DEFAULT_PUNTO_FEE;
              onChange(patch);
            }}
          />
        </div>
        {isPos && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Comisión Punto (%)</label>
            <Input type="number" step={0.1} min={0} max={100} value={device.bankFeePercent}
              onChange={e => onChange({ bankFeePercent: Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground">
              Comisión: ${((deviceNet * device.bankFeePercent) / 100).toFixed(2)} · Neto: ${(deviceNet - (deviceNet * device.bankFeePercent) / 100).toFixed(2)}
            </p>
          </div>
        )}
        {!isPos && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Moneda</label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center gap-1.5">
              <span className="font-semibold">{currencySymbol(methodCurrency(device.payment))}</span>
              <span className="text-muted-foreground text-xs">
                {methodCurrency(device.payment) === 'VES' ? 'Bolívares (según método)' : 'Dólares (según método)'}
              </span>
            </div>
          </div>
        )}
      </div>

      {(isZelle || isPagoMovil) && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Referencia</label>
          <Input value={device.zelleReference} onChange={e => onChange({ zelleReference: e.target.value })}
            placeholder="Número de referencia (últimos 4 dígitos)..." />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Modelo *</label>
          <ModelCombobox
            value={device.model}
            onChange={(label, phone) => {
              // F53: la fila del padrón trae la pantalla de REFERENCIA del modelo → se guarda acá
              // (y `autoScreen` la elige sola un instante después).
              setRefProductId(phone?.default_product_id ?? null);
              selectModel(label);
            }}
            autoFocus={autoFocus}
            placeholder="Buscar el modelo del teléfono (ej: Spark 10 Pro)…"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Monto ($) — precio del servicio</label>
          {/* F49b (pedido del dueño, 2026-09-23): «el descuento ocupa demasiado, tengo el botón de
              descuento en la card». El descuento pasa AL LADO del precio — se escribe y el total se ve
              en el acto, como en la factura — en vez de ocupar un renglón entero con dos líneas de
              ayuda (las mismas palabras ahora están en el `title` del campo). */}
          <div className="flex items-center gap-2">
            <Input type="number" step={0.01} min={0} value={device.amount}
              aria-label="Monto ($) del servicio"
              onChange={e => teclearMonto(Number(e.target.value))} />
            <span className="shrink-0 text-xs text-muted-foreground" aria-hidden>−</span>
            <Input type="number" step={0.01} min={0} value={device.discount || ''} placeholder="Desc."
              aria-label="Descuento ($) del servicio" data-field="descuento-servicio"
              title="Descuento en $ sobre el precio. Se imprime en la factura y aplica con cualquier método de pago. (En una orden ya guardada se cambia desde el botón «Descuento» de la tarjeta.)"
              className="w-24 shrink-0"
              onChange={e => onChange({ discount: Math.max(0, Number(e.target.value)), discountTouched: true })} />
          </div>
          {/* F74 — EL IVA de este equipo (con el IVA apagado no se dibuja nada): dice la misma cuenta
              que se va a guardar y a imprimir, con la tasa del turno. */}
          <IvaDesglose importe={Math.max(0, device.amount - device.discount)} cfg={iva} tasa={tasa}
            campo={`iva-desglose-equipo-${index + 1}`} />
          {/* F67 — el precio del repuesto: de dónde salió el monto y los otros precios a un toque.
              (La línea «Precio lista … · Efectivo sugerido …» se quitó: era una SEGUNDA cuenta del
              mismo precio y podía contradecir al rótulo de acá abajo — el rótulo dice la verdad de lo
              que se escribió, contado incluido.) */}
          <PrecioRepuesto
            fuente={fuente} monto={device.amount}
            ofertaPantalla={ofertaPantalla} ofertaModelo={ofertaModelo}
            elegida={pantallaElegida ? partLabel(pantallaElegida.product) : null}
            sinPrecio={isScreenJob && !!pantallaElegida && !ofertaPantalla}
            avisoSinOferta={avisoSinOferta}
            onUsar={usarPrecio} />
          {device.discount > 0.005 ? (
            <p className="text-xs font-semibold text-emerald-700" data-total-descuento>
              ${device.amount.toFixed(2)} − ${device.discount.toFixed(2)} = <span className="text-sm">Total ${deviceNet.toFixed(2)}</span>
            </p>
          ) : noCatalogPrice && (
            <p className="text-xs text-muted-foreground">Sin precios en el catálogo para este modelo: escribí el precio a mano.</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Color del equipo <span className="text-danger">*</span></label>
          <ColorSelect value={device.color} onChange={c => onChange({ color: c })} />
          {/* F48: el color es obligatorio; se dice acá (además de la ficha y del «Falta: …» del pie). */}
          {!device.color.trim() && <p className="text-xs text-danger">Elegí el color del equipo</p>}
          {/* F79 — EL COBRO, AL LADO DEL COLOR (el espacio que el dueño señaló). El método de pago se
              sigue eligiendo arriba, en esta misma tarjeta: acá se COBRA lo acordado. La orden todavía
              no existe, así que el botón lleva el monto de ESTE equipo y al tocarlo la guarda y abre
              el «Pago / Abono» de siempre. */}
          {onCobrar && (
            <CobroEnWizard modo="crear" total={totalACobrar(deviceNet, iva)}
              estado={cobroEstado} aviso={cobroAviso} cobrando={cobrando}
              onClick={() => onCobrar(index)} bloqueado={!!cobroEstado?.motivo} />
          )}
        </div>
      </div>

      {/* ── F63/F65c — LA PANTALLA DEL MODELO, JUNTO AL MODELO ──────────────────────────────────
          Pedido del dueño (2026-09-21): «dependiendo del modelo del equipo, si tiene compatibilidad
          en pantalla para ese modelo tiene que dejarme seleccionar la compatibilidad si tiene».
          Y (2026-09-23): «el input debería estar cerca al colocar el modelo… que pueda elegir la
          pantalla de ese modelo o su compatibilidad, pero con el beneficio de buscar otra pantalla
          que desee el operador seleccionar». Antes el bloque vivía abajo de todo (después de los
          trabajos y de la falla): ahora va JUSTO DEBAJO del modelo/monto/color, que es donde el
          operario acaba de escribir el teléfono y decide qué repuesto le pone.
          El comportamiento del gate no cambió: con «Cambio pantalla» va abierto y la elección es
          obligatoria (`screenOk`); con otro trabajo queda la línea informativa con la cantidad de
          repuestos compatibles y se abre a un toque (informativo, no descuenta stock). */}
      {!isScreenJob && !compatLoading && screenOptionsTodas.length > 0 && (
        <button type="button" data-ver-compat
          onClick={() => setVerCompat(v => !v)}
          title="Ver los repuestos de pantalla compatibles con este modelo"
          className="self-start rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
          <Smartphone className="size-3 inline mr-1" />
          Compatibilidad de pantalla: {screenOptionsTodas.length} repuesto{screenOptionsTodas.length === 1 ? '' : 's'}
          {verCompat ? ' — ocultar' : ' — ver'}
        </button>
      )}

      {(isScreenJob || verCompat) && (
        <ScreenSelect
          screenProductId={device.screenProductId}
          screenOptions={screenOptionsTodas}
          loading={compatLoading}
          confirmed={device.screenConfirm}
          descuenta={isScreenJob}
          permiteBuscar
          efectivo={isDivisas}
          onPickOtra={c => onChange({ screenExtra: c })}
          onChange={id => onChange({ screenProductId: id })}
          onConfirm={v => onChange({ screenConfirm: v })}
          /* F80: el lápiz (solo master) edita la ficha ahí mismo; y si la pantalla no está en el
             catálogo, se registra desde el mismo lugar con su stock. El alta pide el MODELO escrito:
             con menos de 3 letras la ficha nacería sin compatibilidad (un repuesto huérfano). */
          onEditarProducto={puedeEditarProducto ? p => ficha.abrir(p) : undefined}
          onRegistrarPantalla={puedeEditarProducto && device.model.trim().length >= 3 ? () => ficha.abrir(null) : undefined}
        />
      )}

      <FichaDeRepuestoDialog
        estado={ficha.abierto}
        cats={ficha.cats}
        catPantallaId={ficha.abierto?.catPantalla ?? 1}
        modelo={device.model}
        puedeCategorias={puedeEditarProducto}
        onClose={ficha.cerrar}
        /* F80: editar la ficha marca el MONTO como escrito por el operario: así el precio nuevo NO se
           escribe solo en la orden (regla F67: se ofrece con un toque). Si no, corregir un precio en la
           ficha movía la orden sin que nadie lo pidiera (lo marcó la revisión adversarial). */
        onSaved={() => { onChange({ amountTouched: true }); ficha.guardado(); }}
      />

      {/* F80 — la pantalla elegida se relee por id: si la ficha se borró, se suelta; si cambió su
          precio/stock, se refresca; y si dejó de figurar como compatible, se muestra como «elegida a
          mano» (F65c) en vez de quedar invisible descontando igual. */}
      <PantallaViva
        elegidaId={device.screenProductId}
        extra={device.screenExtra ?? null}
        enLaLista={screenOptionsTodas.some(o => o.product.id === device.screenProductId)}
        listo={!compatLoading && compatAlDia}
        onPerdida={() => onChange({ screenProductId: null })}
        onExtra={c => onChange({ screenExtra: c })}
      />

      <div className="space-y-2">
        {/* F62: el rótulo y el botón «+ Nueva categoría» van juntos: el operario agrega la categoría
            del local sin salir del formulario, y queda elegida en ESTE equipo. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            Trabajos / Fallas * <span className="font-normal text-muted-foreground">(elige todas las que apliquen)</span>
          </span>
          {onNuevaCategoria && (
            <NuevaCategoriaChip existentes={[...SERVICE_TYPES, ...tiposExtra]} locales={tiposExtra} onQuitar={onQuitarCategoria} onCancelar={() => {}}
              onAgregar={async (nombre) => {
                const guardado = await onNuevaCategoria(nombre);
                if (guardado && !device.serviceTypes.includes(guardado)) {
                  onChange({ serviceTypes: [...device.serviceTypes, guardado] });
                }
                return guardado;
              }} />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {[...SERVICE_TYPES, ...tiposExtra].map(t => {
            const active = device.serviceTypes.includes(t);
            return (
              <button key={t} type="button"
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                )}
                onClick={() => onChange({
                  serviceTypes: active ? device.serviceTypes.filter(x => x !== t) : [...device.serviceTypes, t]
                })}>
                {active && <Check className="size-3 inline mr-1" />}
                {t}
              </button>
            );
          })}
        </div>
        {device.serviceTypes.length === 0 && (
          <p className="text-xs text-danger">Elige al menos un trabajo o falla</p>
        )}
        {device.serviceTypes.includes('Otro') && (
          <>
            <Input value={device.otherFault} onChange={e => onChange({ otherFault: e.target.value })}
              placeholder="Describe el trabajo (ej: Cambio de pin de carga, placa de carga, trampilla...)" />
            {/* F58: si lo escrito es un sinónimo de un trabajo de la lista, se GUARDA el canónico.
                Avisa (nunca bloquea): el operario ve con qué nombre va a quedar en los contadores. */}
            {aliasDeTrabajo(device.otherFault) && (
              <p className="text-[11px] text-muted-foreground" data-alias-aviso>
                Se guardará como <span className="font-medium text-foreground">«{aliasDeTrabajo(device.otherFault)}»</span>: ya es un trabajo de la lista.
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Falla / Trabajo realizado <span className="font-normal text-muted-foreground">(opcional)</span></label>
        <Textarea value={device.fault} onChange={e => onChange({ fault: e.target.value })}
          placeholder="Ej: Pantalla rota, se cambió por Incell nueva. Teléfono no enciende, se reemplazó batería..." />
      </div>

      {!hideChecklist && (
        <div className="space-y-2">
          <Button type="button" variant="outline" size="sm" className="w-full bg-orange-500/10 border-orange-500/60 text-orange-700 hover:bg-orange-500/20 hover:text-orange-800"
            onClick={() => setShowChecklist(v => !v)}>
            <ShieldCheck className="size-3.5" /> Blindaje del equipo
            <span className="text-muted-foreground text-xs">
              {Object.values(device.checklist).filter(v => v === 'si' || v === 'no').length}/{CHECKLIST_ITEMS.length}
            </span>
          </Button>
          {showChecklist && (
            <div className="rounded-md border border-border/60 p-3 space-y-2">
              <ChecklistGrid value={device.checklist}
                onChange={cl => onChange({ checklist: cl })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Grid de blindaje reutilizable (wizard): toggles Sí/No + "Marcar todo Sí" como reset.
// Al crear, Chip (SIM) y Forro/funda arrancan en "No" (checklistDefaults): normalmente se
// le entregan al cliente — el operario los cambia a "Sí" solo si los deja en el equipo.
function ChecklistGrid({ value, onChange }: {
  value: Record<string, string>;
  onChange: (cl: Record<string, string>) => void;
}) {
  const markedCount = Object.values(value).filter(v => v === 'si' || v === 'no').length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Marca Sí/No el estado real al recibir el equipo. Chip y forro/funda vienen en
          "No" (normalmente se le entregan al cliente): cámbialos a "Sí" solo si los deja
          en el equipo. Protege al taller ante reclamos.
        </p>
        <Button type="button" size="sm" variant="outline" className="shrink-0"
          onClick={() => onChange(Object.fromEntries(CHECKLIST_ITEMS.map(i => [i.key, 'si'])))}
          disabled={CHECKLIST_ITEMS.every(i => value[i.key] === 'si')}>
          Marcar todo Sí
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {CHECKLIST_ITEMS.map(item => {
          const val = value[item.key] ?? '';
          return (
            <div key={item.key} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-1.5">
              <span className="text-sm flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-full shrink-0', item.dot)} />
                {item.label}
              </span>
              <ToggleGroup type="single" size="sm" value={val}
                onValueChange={v => onChange({ ...value, [item.key]: v })}
                className="shrink-0">
                <ToggleGroupItem value="si" variant="outline"
                  className={cn('min-w-12 data-[state=on]:bg-emerald-600 data-[state=on]:text-white data-[state=on]:hover:bg-emerald-600',
                    val === 'si' ? 'bg-emerald-600 text-white hover:bg-emerald-600' : '')}>
                  Sí
                </ToggleGroupItem>
                <ToggleGroupItem value="no" variant="outline"
                  className={cn('min-w-12 data-[state=on]:bg-destructive data-[state=on]:text-white data-[state=on]:hover:bg-destructive',
                    val === 'no' ? 'bg-destructive text-white hover:bg-destructive' : '')}>
                  No
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {markedCount === 0
          ? 'Nada marcado — el operario lo decide al recibir el equipo.'
          : `${markedCount} de ${CHECKLIST_ITEMS.length} ítems revisados.`}
      </p>
    </div>
  );
}

// F32 — POLÍTICA DEL TALLER dentro del formulario: qué dijo el cliente sobre el pago y si la
// foto de SALIDA ya está tomada. Se anota al guardar con el comando angosto `set_service_policy`
// y NO bloquea nada: son recordatorios registrados, no requisitos.
function PolicyFields({ payIntent, onPayIntent, photoOut, onPhotoOut, showPhotoOut, equipos }: {
  payIntent: 'sin' | 'ahora' | 'al_retirar';
  onPayIntent: (v: 'sin' | 'ahora' | 'al_retirar') => void;
  photoOut: boolean;
  onPhotoOut: (v: boolean) => void;
  showPhotoOut: boolean;
  equipos: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3" data-policy-block="pago">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Banknote className="size-3.5 text-warning" /> ¿El cliente paga ahora o al retirar?
        </span>
        <ToggleGroup type="single" value={payIntent} className="h-8"
          onValueChange={v => { if (v) onPayIntent(v as 'sin' | 'ahora' | 'al_retirar'); }}>
          <ToggleGroupItem value="sin" className="h-7 px-2.5 text-xs">Sin preguntar</ToggleGroupItem>
          <ToggleGroupItem value="ahora" className="h-7 px-2.5 text-xs">Paga ahora</ToggleGroupItem>
          <ToggleGroupItem value="al_retirar" className="h-7 px-2.5 text-xs">Paga al retirar</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {/* F77b: la frase «con qué método paga se elige arriba» se fue — con la pregunta del pago al
          principio del paso del equipo, el método puede estar DEBAJO (alta: dentro de la tarjeta del
          equipo) o en otro paso (edición: Finanzas). Decir «arriba» era mentirle al operario. */}
      <p className="text-[11px] text-muted-foreground">
        Pregúntale al cliente y elegí una opción: queda visible en la orden y en la lista, así el saldo no
        aparece «de la nada» cuando venga a retirar el equipo. El método con el que paga se elige en el
        equipo (en la misma tarjeta, debajo de esta pregunta).
      </p>
      {/* F77b: la foto de SALIDA se saca de acá y vive en su propio control para poder ponerla donde
          se elige el ESTADO (paso Finanzas, edición) y no quedar desconectada del control que la
          revela. En el alta nunca se ofrece (el equipo recién entra: entregar es un acto aparte). */}
      {showPhotoOut && <PhotoOutField photoOut={photoOut} onPhotoOut={onPhotoOut} equipos={equipos} />}
    </div>
  );
}

/**
 * F77b — «Ya le tomé la foto de SALIDA al equipo», en su propio control para poder ubicarlo DONDE
 * CORRESPONDE: en EDICIÓN tiene que estar al lado del selector de ESTADO (paso «Finanzas»), que es el
 * que decide si el equipo ya salió; antes vivía pegado al bloque del pago y, al mover ese bloque al
 * principio del paso del equipo, el tilde quedaba apareciendo en una pantalla donde el operario todavía
 * no había elegido el estado (hallazgo MAYOR de la revisión adversarial de F77).
 */
function PhotoOutField({ photoOut, onPhotoOut, equipos }: {
  photoOut: boolean;
  onPhotoOut: (v: boolean) => void;
  equipos: number;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2">
      <input type="checkbox" className="mt-0.5 size-4" checked={photoOut} data-policy="photo_out"
        onChange={e => onPhotoOut(e.target.checked)} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Camera className="size-3.5 text-success" /> Ya le tomé la foto de SALIDA al equipo
        </span>
        <span className="block text-[11px] text-muted-foreground">
          Política de la empresa: se le toma foto al teléfono cuando se entrega{equipos > 1 ? ` (los ${equipos} equipos de la orden)` : ''}.
        </span>
      </span>
    </label>
  );
}

/**
 * F77 — EL CHECK QUE CIERRA EL REGISTRO (pedido del dueño: «al final salga para imprimir… con un check
 * predeterminado que pregunte si va a imprimir o después; la ayuda es aprovechar el mismo proceso de
 * wizard para cerrar el registro completo»).
 *
 * Vive en el ÚLTIMO paso del wizard (en crear «Revisar y guardar», en editar «Cierre de la orden»),
 * arranca MARCADO y lo único que hace es decidir si al guardar se abre el comprobante. No es un gate:
 * destildado, la orden se guarda igual (y por eso el pie del paso no dice «Falta:» nunca por esto).
 */
function PrintOnSaveField({ value, onChange, equipos }: {
  value: boolean;
  onChange: (v: boolean) => void;
  equipos: number;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2" data-print-block="guardar">
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-0.5 size-4" checked={value}
          onChange={e => onChange(e.target.checked)} data-field="imprimir-al-guardar" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Printer className="size-3.5 text-primary" /> Imprimir la orden ahora
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Al guardar se abre el comprobante de esta orden (el papel sale con su botón «Imprimir»). Si lo
            destildás, la orden se guarda igual y la imprimís después con el botón «Orden» de la tarjeta.
          </span>
          {equipos > 1 && (
            <span className="mt-0.5 block text-[11px] text-amber-700">
              Con {equipos} equipos se abre el comprobante del equipo 1; los demás se imprimen desde su tarjeta.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}

/**
 * F79 — EL BOTÓN DE COBRO DEL PASO 2, AL LADO DEL COLOR DEL EQUIPO.
 *
 * Pedido del dueño (2026-09-26): «el botón de pago en servicio también que aparezca en el wizard,
 * que en el mismo wizard podamos cobrar sin problema… hay un espacio al lado del color de equipo,
 * meterlo ahí… pero si revisa arriba te sale método de pago también: esté todo bien ordenado,
 * óptimo, no sea confuso. Para poder cobrar al cliente, seguir el proceso del wizard. Y dejamos la
 * misma opción como la tenemos actualmente».
 *
 * Qué ES: el botón que abre el MISMO diálogo «Pago / Abono» de la tarjeta (en el alta, primero
 * guarda la orden, porque un cobro necesita una orden guardada y con número).
 * Qué NO ES: una segunda forma de cobrar, ni otra pregunta del método de pago. El método se sigue
 * eligiendo arriba, en la tarjeta de cada equipo (F77b), y el acuerdo «paga ahora / al retirar» en
 * su bloque de política: acá solo se COBRA lo que ya se acordó, al lado del color del equipo.
 *
 * La etiqueta («Cobrar $30.00» en el alta, «Cobrar / Abono» al editar), la ayuda y el estado del
 * dinero los decide la regla pura `lib/wizard-cobro.ts` — una sola implementación para los dos
 * modos y para las pruebas.
 */
const TONO_COBRO: Record<EstadoCobro['tono'], string> = {
  'sin-monto': 'text-muted-foreground',
  pendiente: 'text-warning',
  parcial: 'text-warning',
  cobrado: 'text-success',
  'a-favor': 'text-warning',
  cerrada: 'text-muted-foreground',
};

function CobroEnWizard({ modo, total, estado, aviso, onClick, bloqueado = false, cobrando = false }: {
  modo: 'crear' | 'editar';
  /** el monto que se va a cobrar (en el alta, el de ESE equipo) */
  total: number;
  /**
   * El estado del dinero — SOLO cuando la orden ya existe (en el alta, antes del primer cobro, no hay
   * nada que contar: mostrar «Por cobrar $30.00» de una orden que todavía no está guardada sería
   * inventar un estado). Sin estado, el botón queda con su etiqueta y su ayuda, nada más.
   */
  estado?: EstadoCobro | null;
  /** lo que hay que decir ANTES de cobrar (monto sin guardar, o por qué no se guardó) */
  aviso?: string | null;
  onClick: () => void;
  bloqueado?: boolean;
  /** hay un guardado en curso: el botón se apaga (además del candado de reentrada del guardado) */
  cobrando?: boolean;
}) {
  const ayuda = ayudaCobro(modo);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-success/30 bg-success/5 p-2" data-cobro-wizard={modo}>
      <Button type="button" variant="outline" size="sm" className="w-full justify-center gap-1.5"
        onClick={onClick} disabled={bloqueado || cobrando} title={ayuda}
        data-action="cobrar-equipo" data-cobro-modo={modo}>
        <Banknote className="size-3.5 text-success" /> {etiquetaCobro(modo, total)}
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground">{ayuda}</p>
      {/* El estado se dice SIEMPRE con números reales (lo cobrado, el saldo) o con el motivo por el
          que no se puede cobrar (orden cancelada/devuelta) — nunca con una estimación. */}
      {estado && (
        <p className={cn('text-[11px] font-medium', TONO_COBRO[estado.tono])} data-cobro-estado={estado.tono}>
          {estado.texto}
        </p>
      )}
      {aviso && <p className="text-[11px] font-medium text-danger" data-cobro-aviso>{aviso}</p>}
    </div>
  );
}

function ServiceForm({ service, statuses, dayOpen, turnoViejo, onClose, onSaved, onPrint, onListChanged, tiposExtra = [], onNuevaCategoria, onQuitarCategoria, canManageTecnicos = true, puedeEditarProducto = false, puedeCerrarCaja = true }: {
  service: Service | null;
  statuses: ServiceStatus[];
  dayOpen: boolean | null;
  /** F82: el turno abierto es de OTRO día → no se puede recibir (el backend lo rechaza). */
  turnoViejo: TurnoViejo;
  onClose: () => void;
  /**
   * F81: al guardar un ALTA el wizard devuelve la orden REALMENTE creada (número, filas y grupo) para
   * que la lista la resalte y baje hasta ella; en EDICIÓN no manda nada, porque los filtros del
   * operario no se tocan.
   */
  onSaved: (nueva?: NuevaOrden) => void;
  /**
   * F77: abrir el comprobante de la orden (vista previa + imprimir). Se usa para CERRAR EL REGISTRO
   * dentro del propio wizard: al guardar, si el check «Imprimir la orden ahora» está marcado, se abre
   * el comprobante de la orden recién guardada. Es la MISMA vía que usan la tarjeta, el panel de
   * entregados y el asistente de cierre (`setPrintFor`), no una segunda forma de imprimir.
   */
  onPrint?: (s: Service) => void;
  /**
   * F79: refrescar la LISTA sin cerrar el wizard. El botón «Cobrar» del paso 2 guarda la orden y el
   * registro SIGUE (el operario va al blindaje y al paso final), así que no puede usarse `onSaved`
   * — ese cierra el formulario. Se pasa el `refrescar` del padre.
   */
  onListChanged?: (creada?: NuevaOrden) => void;
  /** F62: categorías de trabajo que agregó el local (van después de las canónicas) */
  tiposExtra?: string[];
  /** F62: agrega una categoría nueva y devuelve el nombre GUARDADO (null si falló) */
  onNuevaCategoria?: (nombre: string) => Promise<string | null>;
  /** F62: quita una categoría del local */
  onQuitarCategoria?: (nombre: string) => Promise<boolean>;
  /** F69: el padrón de técnicos es del dueño (`add/update/delete_technician` piden su sesión) */
  canManageTecnicos?: boolean;
  /**
   * F80 — EL LÁPIZ DE LA FICHA DEL REPUESTO: `add_product`/`update_product` son del DUEÑO
   * (`require_owner` en el backend), así que el lápiz se dibuja solo con la sesión master — a la caja
   * no se le muestra un botón que va a chocar contra el mensaje del PIN (convención de F65).
   */
  puedeEditarProducto?: boolean;
  /** F82: ¿esta sesión puede cerrar el día? (cerrar es del dueño) — lo dice el cartel del wizard. */
  puedeCerrarCaja?: boolean;
}) {
  const [orderNum, setOrderNum] = useState('');
  // F74 — LA CONFIGURACIÓN DEL IVA (y la tasa del turno abierto). La lee cualquiera: la caja necesita
  // saber si hay IVA para desglosar lo que cobra. El desglose que se ve en el formulario sale de la
  // MISMA regla pura que el guardado, la factura y el libro del período (`src/lib/iva.ts`).
  const [iva, setIva] = useState<IvaConfig>(IVA_DEFAULT);
  const [tasaIva, setTasaIva] = useState(0);
  useEffect(() => {
    let vivo = true;
    api.getTaxConfig().then(g => { if (vivo) setIva(parseIvaConfig(g)); }).catch(() => {});
    api.getActiveDay().then(d => { if (vivo) setTasaIva(d?.tasa_bcv ?? 0); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [clientCi, setClientCi] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [model, setModel] = useState('');
  const [fault, setFault] = useState('');
  const [color, setColor] = useState('');
  const [serviceTypes, setServiceTypes] = useState<string[]>(['Cambio pantalla']);
  const [otherFault, setOtherFault] = useState('');
  const [amount, setAmount] = useState(0);
  const [payment, setPayment] = useState('Divisas (USD Cash)');
  const [dateOut, setDateOut] = useState('');
  const [status, setStatus] = useState('Recibido');
  // F32: señales de POLÍTICA del taller que el operario anota mientras arma la orden (se guardan
  // al guardar, con el comando angosto `set_service_policy`; nunca bloquean nada).
  const [photoInDone, setPhotoInDone] = useState(false);
  const [photoOutDone, setPhotoOutDone] = useState(false);
  const [payIntentSel, setPayIntentSel] = useState<'sin' | 'ahora' | 'al_retirar'>('sin');
  const [observations, setObservations] = useState('');
  // F77 — IMPRIMIR AL CERRAR EL REGISTRO (pedido del dueño: «al final salga para imprimir con un
  // check predeterminado que pregunte si va a imprimir o después; la idea es aprovechar el mismo
  // proceso del wizard para cerrar el registro completo»). Arranca MARCADO y vive en el último paso:
  // al guardar se abre el COMPROBANTE de la orden que se acaba de crear. El comprobante es una vista
  // previa (el papel sale con su botón «Imprimir»), así que marcarlo de fábrica no gasta papel.
  const [imprimirAhora, setImprimirAhora] = useState(true);
  const [checklist, setChecklist] = useState<Record<string, string>>(service ? {} : checklistDefaults());
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [bankFeePercent, setBankFeePercent] = useState(0);
  const [zelleReference, setZelleReference] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [clientOpen, setClientOpen] = useState(false);
  const [clientSugs, setClientSugs] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientHistory, setClientHistory] = useState<Service[]>([]);
  const modelPicked = useRef(false);
  const clientPicked = useRef(false);
  /**
   * F79 — el candado de reentrada del guardado (ver `guardarOrden`): un ref y no un estado, porque
   * dos clics despachados en la MISMA tarea ven el mismo valor y ambos pasarían.
   */
  const guardandoRef = useRef(false);
  const amountTouched = useRef(false);
  const discountTouched = useRef(false);
  const [discount, setDiscount] = useState(0);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [svc, setSvc] = useState<Service | null>(service);
  const [screenProductId, setScreenProductId] = useState<number | null>(null);
  const [screenConfirm, setScreenConfirm] = useState(true);  // F47: arranca marcada (ver emptyDevice)
  /** F65c: la pantalla que el operario buscó a mano (ver `screenOptionsTodas`). */
  const [screenExtra, setScreenExtra] = useState<ScreenCandidate | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [techSel, setTechSel] = useState('');
  const [showTechDialog, setShowTechDialog] = useState(false);
  // Órdenes multi-equipo (solo modo crear): un cliente, N teléfonos en una sola orden
  const [devices, setDevices] = useState<FormDevice[]>([emptyDevice()]);
  /**
   * F79 — LA ORDEN QUE YA SE GUARDÓ DESDE EL WIZARD. La crea el botón «Cobrar» del paso 2 (un cobro
   * necesita una orden guardada, con número y fila en la base). Mientras exista, el botón del último
   * paso ACTUALIZA estas filas en vez de crear una segunda orden — es lo que pidió el dueño: «en el
   * mismo wizard podamos cobrar… y seguir el proceso del wizard».
   *
   * `rows` va en el MISMO orden que `devices` (equipo 1 = orden base, 2+ = base-A/B, como los numera
   * el backend). Por eso, con la orden ya guardada, no se agregan ni se quitan equipos desde acá:
   * el mapeo fila ↔ equipo no se puede romper.
   */
  const [ordenCreada, setOrdenCreada] = useState<{ base: string; rows: Service[] } | null>(null);
  /** F79: lo que hay que decir junto al botón de cobro (por qué no se guardó, o monto sin guardar). */
  const [cobroAviso, setCobroAviso] = useState<string | null>(null);
  /** F79: en QUÉ equipo se tocó el botón (el aviso se dibuja solo ahí, no en las N tarjetas). */
  const [cobroAvisoEn, setCobroAvisoEn] = useState<number | null>(null);
  /**
   * F79: el cobro se abrió desde el botón del PASO 2 (y no desde el «Registrar Pago / Abono» del
   * último paso). En EDICIÓN eso decide si al guardar el pago se cierra el registro: el botón del
   * último paso conserva el comportamiento de siempre (cierra) y el del paso 2 NO (así lo que el
   * operario tenga escrito sigue ahí — en edición cobrar no guarda nada).
   */
  const [cobroDesdePaso2, setCobroDesdePaso2] = useState(false);
  const setDevice = (i: number, patch: Partial<FormDevice>) =>
    setDevices(prev => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const addDevice = () => setDevices(prev => [...prev, emptyDevice()]);
  const removeDevice = (i: number) =>
    setDevices(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Tipo PRIMARIO = el primero elegido (compatibilidad con service_type y auto-inventario)
  const serviceType = serviceTypes[0] ?? 'Cambio pantalla';

  // Validez por equipo: cada DeviceFields resuelve su compatibilidad en el backend
  // y avisa si la pantalla quedó sin elegir (no se puede saber desde acá sin las opciones).
  const [deviceScreenValid, setDeviceScreenValid] = useState<Record<number, boolean>>({});
  const onScreenValid = useCallback((i: number, valid: boolean) => {
    setDeviceScreenValid(prev => (prev[i] === valid ? prev : { ...prev, [i]: valid }));
  }, []);

  const devicesValid = devices.length > 0 &&
    devices.every((d, i) => d.model.trim() && d.serviceTypes.length > 0 && d.color.trim() && (deviceScreenValid[i] ?? true));

  const isPos = payment.includes('Punto');
  const isZelle = payment.includes('Zelle');
  const isPagoMovil = payment.includes('Móvil') || payment.includes('Movil');
  // F67: en efectivo el precio que se cobra es el de contado (`price_usd`) — la regla del precio lo
  // necesita igual que en el alta (antes esto se preguntaba dentro de `applyModelPrice`).
  const isDivisasEdit = payment === 'Divisas (USD Cash)';

  const currentTech = technicians.find(t => t.id === Number(techSel));

  const loadTechnicians = async (revalidate = false) => {
    const list = await api.getTechnicians().catch(() => [] as Technician[]);
    setTechnicians(list);
    if (revalidate && techSel && !list.some(t => t.id === Number(techSel))) setTechSel('');
    // F45 (pedido del dueño: «cuando vas a crear un nuevo servicio [el técnico] esté predeterminado
    // como sin asignar… que me deje seguir registrando el servicio nuevo»): al CREAR **no se
    // preselecciona** ningún técnico. Antes se prellenaba con el último usado (`last_technician` en
    // localStorage) y el operario registraba con un nombre que quizá no era el que iba a reparar el
    // equipo; ahora arranca en «Sin asignar» y —si nadie lo asigna— la TARJETA lo reclama con la
    // señal ámbar «Falta asignar técnico» (un clic y se asigna, con el selector rápido de F34).
    // En EDICIÓN se conserva el técnico que ya tiene la orden (lo carga el efecto de `service`).
  };

  useEffect(() => {
    // Ya NO se carga el catálogo completo (1126 filas): la compatibilidad y los
    // precios del modelo los resuelve el backend por modelo (find_compatible_products).
    loadTechnicians();
  }, []);

  useEffect(() => {
    api.getPaymentMethods().then(setMethods);
    if (service) {
      setOrderNum(service.order_num ?? '');
      setClient(service.client ?? '');
      setPhone(service.phone ?? '');
      setClientCi(service.client_ci ?? '');
      setClientAddress(service.client_address ?? '');
      setModel(service.model ?? '');
      setFault(service.fault ?? '');
      setColor(service.color ?? '');
      const parsedTypes = parseServiceTypes(service);
      const knownTypes = parsedTypes.filter(t => SERVICE_TYPES.includes(t));
      const customTypes = parsedTypes.filter(t => !SERVICE_TYPES.includes(t));
      setServiceTypes(knownTypes.length > 0 ? knownTypes : ['Cambio pantalla']);
      setOtherFault(customTypes.join(', '));
      setAmount(service.amount + (service.discount_amount ?? 0));
      amountTouched.current = true;
      setDiscount(service.discount_amount ?? 0);
      discountTouched.current = true;
      setPayment(service.payment_method ?? 'Divisas (USD Cash)');
      setDateOut(service.date_out ?? '');
      setStatus(service.status ?? 'Por entregar');
      setPhotoInDone(!!service.photo_in_at);
      // La foto de SALIDA solo cuenta si es de ESTA entrega: una orden reabierta y todavía sin
      // entregar no puede mostrar el tilde marcado con la foto de la entrega anterior (el mismo
      // criterio que usan el chip «Sin foto de salida» y el asistente de cierre).
      setPhotoOutDone(photoOutIsCurrent(service.photo_out_at, service.date_out));
      setPayIntentSel(service.pay_intent === 'ahora' || service.pay_intent === 'al_retirar' ? service.pay_intent : 'sin');
      setObservations(service.observations ?? '');
      setChecklist(parseChecklist(service.device_checklist));
      setBankFeePercent(service.bank_fee_percent ?? 0);
      setZelleReference(service.zelle_reference ?? '');
      setCurrency(service.currency ?? 'USD');
      setClientId(service.client_id ?? null);
      setTechSel(service.technician_id ? String(service.technician_id) : '');
      setScreenProductId(service.screen_product_id ?? null);
      api.getServicePayments(service.id).then(setPayments).catch(() => setPayments([]));
    } else {
      api.nextOrderNum().then(setOrderNum);
      setPayments([]);
      setClientId(null);
      setScreenProductId(null);
    }
  }, [service]);

  useEffect(() => {
    if (client.trim().length > 0) {
      api.suggestClients(client.trim(), 8).then(sugs => {
        setClientSugs(sugs.filter(s => s.name !== client.trim()));
        setClientOpen(sugs.length > 0 && !clientPicked.current);
      });
    } else {
      setClientSugs([]);
      setClientOpen(false);
    }
  }, [client]);

  useEffect(() => {
    if (clientId != null) {
      api.getClientServices(clientId)
        .then(list => setClientHistory(list.filter(s => s.id !== service?.id)))
        .catch(() => setClientHistory([]));
    }
  }, [clientId, service?.id]);

  const selectClient = (c: Client) => {
    clientPicked.current = true;
    setClient(c.name);
    setClientId(c.id);
    if (c.phone && !phone) setPhone(c.phone);
    if (c.ci && !clientCi) setClientCi(c.ci);
    if (c.address && !clientAddress) setClientAddress(c.address);
    setClientOpen(false);
  };

  // Compatibilidad del modelo (backend) para el modo edición de UNA orden
  const { candidates, loading: compatLoading, alDia: compatAlDia, reload: reloadCompatEdit } = useCompatibleProducts(model);
  // F80: el lápiz de la ficha del repuesto también en la EDICIÓN (mismo diálogo, misma llave).
  const fichaEdit = useFichaDeRepuesto(reloadCompatEdit);
  const screenOptions = useMemo(() => onlyScreens(candidates), [candidates]);
  // F65c: la pantalla buscada A MANO (no estaba en la compatibilidad del modelo) se suma como opción.
  const screenOptionsTodas = useMemo(
    () => (screenExtra && !screenOptions.some(o => o.product.id === screenExtra.product.id)
      ? [screenExtra, ...screenOptions]
      : screenOptions),
    [screenOptions, screenExtra],
  );
  const isScreenJobEdit = serviceTypes.includes('Cambio pantalla');

  /** F53 — pantalla de REFERENCIA del modelo (se busca en el padrón cuando la orden ya tiene modelo). */
  const [refProductIdEdit, setRefProductIdEdit] = useState<number | null>(null);
  useEffect(() => {
    const label = model.trim();
    if (label.length < 3) { setRefProductIdEdit(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.getPhoneModelsInUse(label, 5, false)
        .then(list => {
          if (!alive) return;
          const fila = list.find(m => m.label.trim().toLowerCase() === label.toLowerCase());
          setRefProductIdEdit(fila?.default_product_id ?? null);
        })
        .catch(() => { if (alive) setRefProductIdEdit(null); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [model]);

  // La referencia del modelo manda (F53); sin ella, UNA sola pantalla con stock Y de la MISMA marca
  // del teléfono (regla pura `autoScreen`; antes esta puerta —el modo EDICIÓN— seguía con la regla
  // vieja «una sola con stock» y podía asignar la pantalla de OTRO teléfono al guardar).
  useEffect(() => {
    if (!isScreenJobEdit || screenProductId != null) return;
    const auto = autoScreen(screenOptions, refProductIdEdit);
    if (auto) { setScreenProductId(auto.product.id); setScreenConfirm(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenOptions, isScreenJobEdit, screenProductId, refProductIdEdit]);

  const selectModel = (label: string) => {
    // F67: el precio ya NO se aplica acá con `candidates` (que en esta pasada es la lista del modelo
    // anterior). En EDICIÓN, además, no se aplica solo nunca: una orden guardada no cambia de monto
    // por cambiar de modelo — el operario lo pide a un toque con el botón de abajo.
    modelPicked.current = true;
    setModel(label);
  };

  // ── F67 — EL PRECIO DEL REPUESTO (modo edición) ──────────────────────────────────────────────
  // Misma regla que en el alta (`lib/screen-price.ts`), pero acá **solo se ofrece**: el monto de una
  // orden guardada es un dato de la orden (puede llevar meses cobrado) y nadie lo cambia sin querer.
  // Igual que en el alta, las ofertas esperan a que los candidatos sean de ESTE modelo (`alDia`).
  const pantallaElegidaEdit = useMemo(
    () => (compatAlDia ? screenOptionsTodas.find(o => o.product.id === screenProductId) ?? null : null),
    [compatAlDia, screenOptionsTodas, screenProductId],
  );
  const ofertaPantallaEdit = useMemo(
    () => (isScreenJobEdit && pantallaElegidaEdit ? priceFields(pantallaElegidaEdit.product, isDivisasEdit) : null),
    [isScreenJobEdit, pantallaElegidaEdit, isDivisasEdit],
  );
  const ofertaModeloEdit = useMemo(
    () => (compatAlDia ? groupPriceFields(candidates.map(c => c.product), isDivisasEdit) : null),
    [compatAlDia, candidates, isDivisasEdit],
  );
  const fuenteEdit = priceSource(amount, ofertaPantallaEdit?.amount ?? null, ofertaModeloEdit?.amount ?? null);
  const usarPrecioEdit = (f: PriceFields) => {
    amountTouched.current = true;
    discountTouched.current = true;
    setAmount(f.amount);
    setDiscount(f.discount);
  };

  // Normaliza una cédula para buscar: quita prefijo V-/E-, espacios y guiones
  const normCi = (s: string) => s.trim().replace(/^[VvEe]-?\s*/, '').replace(/\D/g, '');

  const needCi = !service && !clientId;

  // Catálogo sin precios para este modelo: el descuento se escribe a mano (hint honesto).
  // F67: se decide con la MISMA regla de precio (una ficha con venta 0 y contado cargado SÍ se cobra).
  const editNoCatalogPrice = useMemo(
    () => candidates.length > 0 && candidates.every(c => priceFields(c.product, isDivisasEdit) == null),
    [candidates, isDivisasEdit],
  );
  // F48: el color del equipo es OBLIGATORIO en los dos modos (pedido del dueño: «en los colores que
  // sea un campo requerido; si no selecciono un color lo salte de una vez a que elija un color»).
  // El aviso lo dice con el paso del color, y la ficha lleva al selector con un toque.
  const colorMissing = !color.trim() ? 'Elegí el color del equipo' : null;

  // F47: el ÚNICO bloqueo de la pantalla es no haberla elegido (sin eso el inventario bajaría del
  // repuesto equivocado). Que la pantalla esté AGOTADA ya no bloquea: se avisa en rojo en el
  // selector (`ScreenSelect`) y el guardado sigue disponible.
  const screenMissing = screenOk(serviceTypes, screenProductId, screenOptions) === false
    ? 'Elige la pantalla exacta a instalar'
    : null;

  /**
   * F79 — LO QUE FALTA PARA GUARDAR, en un solo lugar: lo usan el botón del último paso, el botón
   * «Cobrar» del paso 2 y el atajo Ctrl+Enter. Antes vivía adentro de `save()`; con un segundo botón
   * que también guarda, la lista tiene que ser UNA (dos verdades sobre lo mismo se separan solas).
   * OJO: el MONTO **no** es un bloqueo del guardado. El paso del wizard pide un monto para avanzar,
   * pero una orden de $0 es legítima (garantía, cortesía, descuento del 100%) y hay órdenes reales
   * así en la base: bloquear acá dejaba esas órdenes sin poder guardarse.
   */
  const bloqueosDeGuardado = (): string[] => {
    const bloqueos: string[] = [];
    if (saving) bloqueos.push('ya se está guardando');
    if (dayOpen === false) bloqueos.push('abrir el día en Libro Diario');
    // F82: la caja del día anterior sin cerrar. Se dice con la fecha y el camino (no un «no se
    // puede»). OJO (revisión adversarial): el backend rechaza lo mismo al CREAR (`add_service_order`
    // → `require_open_day_para`), pero **editar** una orden existente va por `update_service`, que NO
    // tiene gate de día: bloquear la edición es una decisión de la UI (misma asimetría deliberada que
    // «entregar sí, cobrar no»), no una paridad con el backend.
    if (turnoViejo.stale) bloqueos.push(`cerrar la caja del ${fechaLegible(turnoViejo.fechaTurno)} (Libro Diario → Cierres)`);
    if (needCi && !clientCi.trim()) bloqueos.push('cédula del cliente nuevo');
    // Los mismos datos que apagan el botón, pero DICHOS: antes este `return` era mudo y desde el
    // medio del wizard (o con Ctrl+Enter) el guardado no hacía nada y no explicaba por qué.
    if (service) {
      if (!client) bloqueos.push('nombre del cliente');
      if (!model || serviceTypes.length === 0) bloqueos.push('modelo y trabajo del equipo');
      if (colorMissing) bloqueos.push(colorMissing);
      if (screenMissing) bloqueos.push(screenMissing);
    } else {
      if (!client) bloqueos.push('nombre del cliente');
      devices.forEach((d, i) => {
        const n = devices.length > 1 ? ` del equipo ${i + 1}` : '';
        if (!d.model.trim()) bloqueos.push(`modelo${n}`);
        if (d.serviceTypes.length === 0) bloqueos.push(`trabajo o falla${n}`);
        if (!d.color.trim()) bloqueos.push(`color del equipo${n}`);   // F48: dato obligatorio
        if (deviceScreenValid[i] === false) bloqueos.push(`elegir la pantalla${n}`);
      });
    }
    return bloqueos;
  };

  /**
   * Las filas de una orden multi-equipo EN ORDEN DE EQUIPO (base, base-A, base-B…). Es el orden con
   * el que el backend numera los equipos (`add_service_order`), así que es lo único que permite
   * mapear fila ↔ equipo sin adivinar (la consulta devuelve las filas en su propio orden).
   */
  const filasEnOrdenDeEquipo = (base: string, filas: Service[]): Service[] =>
    devices
      .map((_, i) => {
        const num = i === 0 ? base : `${base}-${String.fromCharCode(65 + i - 1)}`;
        return filas.find(r => r.order_num === num);
      })
      .filter((r): r is Service => !!r);

  /**
   * F79 — ACTUALIZAR LA ORDEN QUE YA SE GUARDÓ DESDE EL WIZARD (la creó el botón «Cobrar»). Cada
   * equipo es una fila propia, así que se actualiza fila por fila con la ÚNICA vía permitida
   * (`updateOrderKeepingFields`): lo que no se manda se CONSERVA — sobre todo el dinero ya cobrado y
   * sus pagos, la fecha de entrega y las observaciones. La fila se relee ANTES de escribir para no
   * pisar nada cambiado desde otra pantalla (una entrega hecha desde la tarjeta, por ejemplo).
   */
  const actualizarEquiposCreados = async (
    creada: { base: string; rows: Service[] }, techName: string, techId: number | null,
  ): Promise<Service[]> => {
    // La orden tiene que tener una fila por equipo (no debería fallar: con la orden guardada no se
    // agregan ni se quitan equipos). Si el wizard perdió las filas en memoria —una recarga fallida— se
    // relee la orden del backend ANTES de escribir: actualizar el equipo equivocado es peor que un
    // aviso. Si tampoco así coinciden, se corta con un mensaje claro (nunca se escribe a medias).
    let filasBase = creada.rows;
    if (filasBase.length !== devices.length) {
      const nuevas = await api.getServices(creada.base, '', '', '', 'in').catch(() => [] as Service[]);
      const recuperadas = filasEnOrdenDeEquipo(creada.base,
        nuevas.filter(r => r.order_num === creada.base || (r.order_num ?? '').startsWith(`${creada.base}-`)));
      if (recuperadas.length === devices.length) filasBase = recuperadas;
      else throw new Error(`la orden ${creada.base} no tiene los mismos equipos que el formulario`
        + ` (${recuperadas.length} en la base, ${devices.length} acá): revisala en su tarjeta`
        + ' — para no pisar el equipo equivocado no se guardó nada.');
    }
    const rows: Service[] = [];
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      const fila = filasBase[i];
      if (!fila) continue;
      const typesArr = [...d.serviceTypes];
      // F58: misma normalización del texto libre que en el alta y la edición (una sola regla).
      if (d.serviceTypes.includes('Otro') && d.otherFault.trim()) agregarTrabajoDeOtro(typesArr, d.otherFault.trim());
      const actual = await api.getService(fila.id).catch(() => fila);
      await updateOrderKeepingFields(actual, {
        client, phone, clientCi, clientAddress,
        model: d.model, color: d.color, fault: d.fault,
        serviceType: typesArr[0] ?? 'Cambio pantalla',
        serviceTypes: JSON.stringify(typesArr),
        // La MISMA cuenta que usa el alta (monto − descuento, con el IVA que corresponda): el monto
        // que se guarda es el que paga el cliente.
        amount: totalACobrar(Math.max(0, d.amount - d.discount), iva),
        discountAmount: d.discount,
        paymentMethod: d.payment,
        currency: methodCurrency(d.payment),
        screenProductId: d.screenProductId,
        deviceChecklist: JSON.stringify(d.checklist),
        bankFeePercent: d.bankFeePercent,
        zelleReference: d.zelleReference,
        status,
        technician: techName, technicianId: techId,
      });
      rows.push(await api.getService(fila.id).catch(() => actual));
    }
    return rows;
  };

  /**
   * F79 — LOS RECORDATORIOS DE LA RECEPCIÓN (foto de ENTRADA + preguntar el pago), con los datos
   * vivos del formulario y una sola implementación para los dos momentos en que la recepción queda
   * guardada: el botón de cobro del paso 2 y el guardado que cierra el registro. Nunca bloquean y no
   * se apilan (el aviso es el mismo para la misma orden).
   */
  const avisosDeRecepcion = (ids: number[], alCerrar: () => void) => {
    if (service || ids.length === 0) return;
    firePolicyReminders(
      receiveReminders(
        {
          photo_in_at: photoInDone ? 'si' : null,
          photo_out_at: photoOutDone ? 'si' : null,
          pay_intent: payIntentSel === 'sin' ? null : payIntentSel,
          date_out: null,
        },
        { devices: devices.length, status },
      ),
      ids,
      alCerrar,
    );
  };

  /**
   * F79 — GUARDAR (y, si se pidió, COBRAR) EN UNA SOLA FUNCIÓN. Es el camino de siempre con un
   * destino nuevo:
   *   · `cobrarEquipo` — al terminar de guardar se abre el MISMO diálogo «Pago / Abono» de la
   *     tarjeta, sobre la fila de ESE equipo, y el registro SIGUE abierto (el wizard va al blindaje
   *     y su «Guardar» ACTUALIZA esta orden, sin duplicarla).
   */
  const guardarOrden = async (opts: { cobrarEquipo?: number } = {}) => {
    // F79 — CANDADO DE REENTRADA (bloqueante de la revisión adversarial, reproducido en vivo): `saving`
    // es ESTADO de React y dentro de la MISMA tarea todavía vale `false`, así que tres clics
    // despachados juntos (un script, un autoclicker, un segundo handler futuro) pasaban los tres el
    // guard y creaban TRES órdenes para el mismo registro — plata y stock contados tres veces. El ref
    // corta de forma SINCRÓNICA y se libera en el `finally`. (El doble clic humano —dos tareas
    // separadas— ya lo frenaba `saving`; esto cierra la otra puerta.)
    if (guardandoRef.current) return;
    const bloqueos = bloqueosDeGuardado();
    if (bloqueos.length > 0) {
      const aviso = `No se guardó — falta: ${bloqueos.join(' · ')}`;
      setAvisoGuardar(aviso);
      // F79: el aviso se dibuja SOLO debajo del botón del equipo que se tocó (no en las N tarjetas).
      if (opts.cobrarEquipo !== undefined) { setCobroAviso(aviso); setCobroAvisoEn(opts.cobrarEquipo); }
      return;
    }
    guardandoRef.current = true;
    setAvisoGuardar(null);
    setCobroAviso(null);
    setCobroAvisoEn(null);
    setSaving(true);
    // F77: la orden que se va a imprimir al terminar (null = no se imprime nada). Se resuelve en cada
    // rama con la fila REALMENTE guardada, no con los datos del formulario.
    let paraImprimir: Service | null = null;
    // F79: las filas de la orden — las que ya existían por un cobro anterior, o las que se crean ahora.
    let filas: Service[] = ordenCreada?.rows ?? [];
    // F81: la orden creada en ESTE guardado (solo en el alta) — se arma con las filas que devolvió el
    // backend y viaja al padre para resaltar la tarjeta. Se guarda en LOCAL: `setOrdenCreada` es
    // estado de React y en este mismo tick todavía valdría lo viejo.
    let creada: NuevaOrden | undefined;
    try {
      let cid = clientId;
      if (client && !cid) {
        cid = await api.addOrFindClient(client, phone, clientCi, clientAddress);
      }
      const techName = currentTech?.name ?? '';
      const techId = currentTech?.id ?? null;
      // F45: ya NO se recuerda el «último técnico» en localStorage (ver `loadTechnicians`): el
      // elegido se guarda en la ORDEN, que es donde tiene que estar. Sin técnico la orden se guarda
      // igual y la tarjeta la reclama con la señal ámbar.
      if (service) {
        const checklistJson = JSON.stringify(checklist);
        // El texto de "Otro" se guarda como trabajo propio (badge propio en la orden)
        const typesArr = [...serviceTypes];
        // F58: se guarda la etiqueta CANÓNICA si lo escrito es un sinónimo aprobado («bateria» →
        // «Cambio batería»): el contador del taller no se parte en dos y el operario no tiene que
        // acordarse de la ortografía exacta. No bloquea nada: normaliza y avisa.
        if (serviceTypes.includes('Otro') && otherFault.trim()) agregarTrabajoDeOtro(typesArr, otherFault.trim());
        const serviceTypesJson = JSON.stringify(typesArr);
        await api.updateService(service.id, client, phone, model, fault, serviceType, serviceTypesJson, Math.max(0, amount - discount), payment, dateOut, status, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, checklistJson, techName, techId, color, screenProductId, discount);
        // F32: las señales de política que se marcaron en el formulario (si no cambió nada, no
        // se escribe nada) — nunca tumban el guardado.
        await anotarPoliticaSinRomper([service.id]);
        // F77: se relee la orden guardada para el comprobante (así se imprime lo que quedó en la base,
        // con el mismo número de orden y los datos ya normalizados).
        paraImprimir = await api.getService(service.id).catch(() => null);
        // F79: la fila de la orden en EDICIÓN (la usa el cobro del paso 2: se cobra sobre la orden
        // RECIÉN guardada, no sobre lo que haya quedado en memoria).
        filas = paraImprimir ? [paraImprimir] : [];
      } else if (ordenCreada) {
        // ── F79 — LA ORDEN YA EXISTE (la creó el botón «Cobrar»): se ACTUALIZA, no se duplica. Es el
        // camino del «Guardar» del último paso después de haber cobrado, y el de un segundo equipo
        // que se cobra: primero se escriben los cambios del formulario y recién después se abre el
        // cobro (nunca se cobra un monto viejo).
        filas = await actualizarEquiposCreados(ordenCreada, techName, techId);
        setOrdenCreada(o => (o ? { ...o, rows: filas } : o));
        await anotarPoliticaSinRomper(filas.map(r => r.id));
        paraImprimir = filas.find(r => r.order_num === ordenCreada.base) ?? filas[0] ?? null;
      } else {
        const inputs: ServiceDeviceInput[] = devices.map(d => {
          const typesArr = [...d.serviceTypes];
          // F58: misma normalización que en la edición (una sola regla).
          if (d.serviceTypes.includes('Otro') && d.otherFault.trim()) agregarTrabajoDeOtro(typesArr, d.otherFault.trim());
          return {
            model: d.model,
            color: d.color,
            fault: d.fault,
            service_type: d.serviceTypes[0] ?? 'Cambio pantalla',
            service_types: JSON.stringify(typesArr),
            // Monto = precio; Total a pagar (guardado) = Monto − Descuento (con el IVA «agregado»,
            // el total cobrado es ese monto MÁS el IVA: `amount` es siempre lo que paga el cliente).
            amount: totalACobrar(Math.max(0, d.amount - d.discount), iva),
            discount_amount: d.discount,
            // F74 — la alícuota viaja con la orden: un reporte de un período cerrado no cambia
            // porque después se mueva la alícuota (misma regla que «un cierre no se recalcula»).
            iva_rate: ivaActivo(iva) ? iva.alicuota : 0,
            iva_mode: ivaActivo(iva) ? iva.modo : '',
            payment_method: d.payment,
            observations: '',
            bank_fee_percent: d.bankFeePercent,
            zelle_reference: d.zelleReference,
            currency: methodCurrency(d.payment),
            device_checklist: JSON.stringify(d.checklist),
            screen_product_id: d.screenProductId,
            // F32: el estado lo elige el operario (por defecto «Recibido»; antes la orden nacía
            // en «Por entregar» por un default silencioso de la base y el flujo se saltaba).
            status,
          };
        });
        // addServiceOrder es transaccional y asigna los números: equipo 1 = base, 2+ = base-A, base-B…
        // (el backend usa `b'A' + (i-1)`; 1 solo equipo → sin group_id, exactamente como antes)
        const base = await api.addServiceOrder(client, phone, clientCi, clientAddress, cid, techName, techId, inputs);
        // F32: filas creadas (una por equipo) para anotar la política y recordar lo pendiente
        const nuevas = await api.getServices(base, '', '', '', 'in').catch(() => [] as Service[]);
        // F79: las filas se guardan EN ORDEN DE EQUIPO (base, base-A, base-B…). Es lo que permite que
        // el wizard siga con ESTA orden —cobrar otro equipo, corregir el blindaje— y que el botón del
        // último paso la ACTUALICE en vez de crear una segunda orden.
        filas = filasEnOrdenDeEquipo(base, nuevas.filter(r => r.order_num === base || (r.order_num ?? '').startsWith(`${base}-`)));
        setOrdenCreada({ base, rows: filas });
        creada = nuevaOrdenDe(filas, base);   // F81: lo que el padre resalta al cerrar(se) el wizard
        // El número que se ve en el paso Cliente pasa a ser el REAL (antes era el «próximo»).
        setOrderNum(base);
        await anotarPoliticaSinRomper(filas.map(r => r.id));
        // F77: el comprobante que se abre al terminar es el de la orden BASE (equipo 1). Con varios
        // equipos no se abren N comprobantes: los demás se imprimen desde su tarjeta (y el bloque del
        // último paso lo dice). Si la relectura no trajo la fila base (la consulta falló), NO se imprime
        // nada: abrir el comprobante de una variante vieja `base-…` sería imprimir otra orden. La orden
        // ya quedó guardada y se imprime desde su tarjeta.
        paraImprimir = filas.find(r => r.order_num === base) ?? null;
      }
      // F79 — EL COBRO DENTRO DEL WIZARD. La orden ya está guardada (recién creada o actualizada
      // arriba), así que se abre el MISMO diálogo «Pago / Abono» de la tarjeta sobre la fila de ESE
      // equipo: no hay una segunda forma de cobrar ni un segundo formulario de pago. El registro NO
      // termina acá: no se cierra el wizard y no se imprime (eso es del «Guardar» del último paso).
      if (opts.cobrarEquipo !== undefined) {
        const fila = filas[opts.cobrarEquipo];
        if (fila) {
          setSvc(fila);
          setShowPayDialog(true);
        } else {
          setCobroAviso('La orden quedó guardada, pero no se pudo abrir el cobro de ese equipo. Cobralo desde su tarjeta.');
          setCobroAvisoEn(opts.cobrarEquipo);
        }
        // F79 — LOS RECORDATORIOS DE LA RECEPCIÓN SALEN TAMBIÉN ACÁ. Si el operario cobra y después
        // cierra el wizard sin pasar por el último paso, la recepción YA quedó guardada: callarse la
        // política (la foto del teléfono y el acuerdo de pago) dejaría la recepción sin aviso, que es
        // justo lo contrario de lo que pide el taller. Se encolan y aparecen cuando el wizard se
        // cierre; el guardado final los vuelve a calcular frescos y el mismo aviso para la misma orden
        // no se apila (dedupe por id).
        avisosDeRecepcion(filas.map(r => r.id), () => onListChanged?.(creada));
        onListChanged?.(creada);
        return;
      }
      onSaved(creada);
      // F79: salen acá, en el guardado que CIERRA el registro, aunque la orden se haya creado antes
      // con el botón de cobro — así el aviso es el de lo que falta de verdad en ese momento.
      // F81: la callback va envuelta para que la orden creada llegue como DATO (nunca `map(onSaved)`,
      // que le pasaría el índice del array como si fuera la orden).
      avisosDeRecepcion(filas.map(r => r.id), () => onSaved(creada));
      // F77 — CERRAR EL REGISTRO CON LA IMPRESIÓN: se abre el COMPROBANTE de la orden recién guardada
      // por la MISMA vía que usa la tarjeta (`onPrint` → `setPrintFor`). Va DESPUÉS de `onSaved()`:
      // así el wizard ya se cerró y el aviso de política que quedó encolado se puede dibujar (F54: el
      // modal nunca se dibuja sobre un diálogo abierto). Si el operario destildó el check, o si no hay
      // fila que imprimir, no se abre nada y la orden igual quedó guardada.
      if (imprimirAhora && onPrint && paraImprimir) {
        try { onPrint(paraImprimir); } catch { /* el comprobante es un extra: la orden ya está guardada */ }
      }
    } catch (e) {
      // F79: el guardado NUNCA puede quedar mudo. Antes, un error del backend (una orden que ya no
      // existe, el día que se cerró en el medio) rechazaba la promesa sin que el operario viera nada
      // —y con dos botones que guardan, ese silencio se vuelve «no hizo nada, toco de nuevo»—. Se dice
      // también junto al botón de cobro, que es donde estaba mirando.
      const aviso = `No se guardó — ${e instanceof Error ? e.message : String(e)}`;
      setAvisoGuardar(aviso);
      setCobroAviso(aviso);
      setCobroAvisoEn(opts.cobrarEquipo ?? 0);
    } finally {
      guardandoRef.current = false;
      setSaving(false);
    }
  };

  // Abonado total del servicio en $ (el backend convierte pagos en Bs con la tasa del día del pago)
  const abonadoUsd = svc?.paid_amount ?? 0;
  // Saldo honesto: positivo = pendiente, negativo = excedente (se cobró de más).
  // F67 (revisión adversarial): la deuda es el TOTAL (monto − descuento), no el monto lista — es lo
  // que se guarda en la orden, lo que imprime la factura y lo que cuenta `orderBalance`. Con lista 28 y
  // descuento 3 el pie decía «Por pagar $28.00» cuando la deuda era 25 (venía así de antes de F67, pero
  // el botón nuevo de F67 invita a crear el descuento desde este mismo paso).
  const totalOrden = Math.max(0, amount - discount);
  const saldoUsd = totalOrden - abonadoUsd;
  const excedenteUsd = -Math.min(0, saldoUsd);
  const totalAbonadoBs = payments.reduce((a, p) => a + (p.currency === 'VES' ? p.amount : 0), 0);

  // ── F79 — EL COBRO DENTRO DEL WIZARD ─────────────────────────────────────────────────────────
  /**
   * El estado del dinero de la ORDEN GUARDADA en modo edición (lo cobrado de verdad y el saldo).
   * Se lee de `svc` (la fila de la base), no del formulario: si el operario acaba de cambiar el monto
   * sin guardar, el cobro sigue siendo sobre lo guardado y `avisoMontoSinGuardar` lo dice.
   */
  const estadoCobroEditar = estadoCobro({
    total: svc?.amount ?? service?.amount ?? totalOrden,
    pagado: svc?.paid_amount ?? 0,
    status: svc?.status ?? service?.status ?? status,
  });

  /** El estado del dinero de UN equipo del alta — null mientras la orden todavía no existe (antes de
   *  eso solo se sabe el monto del formulario, y no se inventa un «cobrado»). */
  const estadoCobroEquipo = (i: number): EstadoCobro | null => {
    const fila = ordenCreada?.rows[i];
    if (!fila) return null;
    return estadoCobro({ total: fila.amount, pagado: fila.paid_amount ?? 0, status: fila.status });
  };

  /**
   * EL BOTÓN DE COBRO DEL PASO 2 (al lado del color del equipo).
   *   · ALTA: la orden todavía no existe → se guarda (se crea) con TODO lo cargado y se abre el cobro
   *     de ESE equipo. Si ya se había creado (segundo equipo, o se vuelve a cobrar), primero se
   *     actualiza lo que el operario haya cambiado y después se abre: nunca un monto viejo.
   *   · EDICIÓN: la orden YA existe → **el botón NO guarda nada** (es la opción de siempre: «la misma
   *     que tenemos actualmente», decisión del dueño). Guardar desde un botón de COBRO tendría efectos
   *     de dinero que nadie pidió: si el formulario trae el estado en «Entregado», guardar descuenta el
   *     stock, estampa la fecha de entrega (y con ella la garantía y la caja del día) aunque después el
   *     operario cancele el pago. Para eso está el botón del último paso. Lo que sí se avisa es si el
   *     monto escrito no es el guardado: el cobro trabaja sobre la orden guardada (y el registro queda
   *     abierto al guardar el pago, así que lo escrito NO se pierde).
   */
  const cobrarEquipo = (i: number) => {
    if (service) {
      setCobroAviso(avisoMontoSinGuardar(totalOrden, svc?.amount ?? service.amount));
      setSvc(svc ?? service);
      setCobroDesdePaso2(true);
      setShowPayDialog(true);
      return;
    }
    void guardarOrden({ cobrarEquipo: i });
  };

  /**
   * F79 — EL AVISO QUE VA DEBAJO DEL BOTÓN DE **UN** EQUIPO. Dos cosas distintas y nunca las dos
   * juntas: (a) el motivo por el que el último clic de cobro no guardó — solo en el equipo que se
   * tocó, no en todas las tarjetas (un fallo del equipo 2 no tiene por qué pintar de rojo el botón
   * del equipo 1); y (b) el monto que el formulario todavía no guardó cuando la orden ya existe: el
   * clic siguiente GUARDA ese monto y cobra ESE monto, así que el aviso lo dice con esas palabras (si
   * dijera «se cobra el guardado» mentiría: se guarda y se cobra lo que el operario escribió).
   */
  const avisoCobroEquipo = (i: number): string | null => {
    if (cobroAviso && cobroAvisoEn === i) return cobroAviso;
    const fila = ordenCreada?.rows[i];
    if (!fila) return null;
    const totalFormulario = totalACobrar(Math.max(0, devices[i].amount - devices[i].discount), iva);
    return avisoMontoPendiente(totalFormulario, fila.amount);
  };

  // Moneda SIEMPRE derivada del método de pago (harness): nunca editable
  useEffect(() => {
    setCurrency(methodCurrency(payment));
  }, [payment]);

  const doDeletePayment = async (pid: number) => {
    await api.deleteServicePayment(pid);
    const p = await api.getServicePayments(service!.id);
    setPayments(p);
    const s = await api.getService(service!.id).catch(() => service);
    setSvc(s);
    onSaved();
  };

  // Wizard paso a paso (navegable): cada paso con su validación. Blindaje es OPCIONAL
  // (siempre done — el operario decide al recibir); la falla también es opcional.
  const steps = service
    ? [
        { label: 'Cliente', done: client.trim().length > 0 && (!needCi || clientCi.trim().length > 0) },
        // F48: el COLOR del equipo es dato obligatorio (pedido del dueño). Vive en este mismo paso,
        // así que exigirlo no encierra a nadie: se elige de la lista y «Siguiente» se habilita.
        { label: 'Equipo', done: !!model && serviceTypes.length > 0 && !!color.trim() },
        { label: 'Blindaje', done: true },
        // El MONTO **no** es un paso bloqueante en EDICIÓN: no bloquea el guardado (una orden de $0
        // es legítima) y este paso NO es el último, así que exigirlo acá dejaba al operario
        // ENCERRADO en «Finanzas»: «Siguiente» apagado, sin botón Guardar (solo se dibuja en el
        // último paso) y sin poder llegar a «Cierre» (fecha de salida, observaciones y pagos).
        // Queda como AVISO en la ficha de ingreso y en el pie del último paso.
        { label: 'Finanzas', done: true },
        { label: 'Cierre', done: true },
      ]
    : [
        // La cédula del cliente NUEVO es obligatoria para guardar: se pide ya en el paso 1 para que
        // «Siguiente» y el aviso «Falta: …» digan lo mismo (antes el botón avanzaba y el guardado
        // fallaba al final).
        { label: 'Cliente', done: client.trim().length > 0 && (!needCi || clientCi.trim().length > 0) },
        // F48: el color del equipo es obligatorio (mismo criterio en crear y editar).
        { label: 'Equipos', done: devices.length > 0 && devices.every(d => d.model.trim() && d.serviceTypes.length > 0 && d.color.trim()) },
        { label: 'Blindaje', done: true },
        // Mismo criterio que en edición: el monto se AVISA, no bloquea (el paso «Revisar» es el
        // último, así que el guardado siempre se alcanza; el monto vive en la ficha como pendiente).
        { label: 'Revisar', done: true },
      ];
  const stepCurrent = steps.findIndex(s => !s.done);
  // Paso activo del wizard: 0 Cliente, 1 Equipo(s), 2 Blindaje, 3 Finanzas/Revisar, (4 Cierre)
  const [wizStep, setWizStep] = useState(0);
  const goTo = (i: number) => {
    if (i < wizStep || stepCurrent === -1) setWizStep(i);
  };

  /**
   * F48 — «IR AL CAMPO» de la ficha (el «te va llevando de la mano» del dueño): además de cambiar de
   * paso, deja el FOCO en el control de ese dato (`data-ficha-target="<clave>"`), así el operario
   * escribe/toca sin buscar. Si el control no declara el atributo, se enfoca el primer input del paso.
   */
  const irAlCampo = (step: number, key?: string) => {
    setWizStep(Math.max(0, Math.min(step, steps.length - 1)));
    if (!key) return;
    // El paso tiene que pintarse antes de poder enfocar: se reintenta unas cuantas veces.
    let intentos = 0;
    const enfocar = () => {
      const el = document.querySelector<HTMLElement>(`[data-ficha-target="${key}"]`);
      if (el) { el.focus(); return; }
      if (++intentos < 6) setTimeout(enfocar, 80);
    };
    setTimeout(enfocar, 60);
  };

  // ── F33: FICHA DE INGRESO (el asistente que pide un dato por vez) ─────────────────────────
  // Se arma más abajo, cuando ya están resueltos el monto (por equipo) y la compatibilidad de la
  // pantalla: ver `const ficha = buildFicha(...)`.

  // F31: aviso de por qué NO se guardó (por ejemplo al usar Ctrl+Enter con el día cerrado o sin cédula).
  const [avisoGuardar, setAvisoGuardar] = useState<string | null>(null);

  // Al entrar a un paso el foco va al primer campo (menos mouse, menos tipeo en el mostrador).
  const clientRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (wizStep === 0) clientRef.current?.focus();
  }, [wizStep]);

  // El cliente casi siempre dice el TELÉFONO: con 5+ dígitos se buscan clientes conocidos y un
  // toque los trae completos. `suggest_clients` del backend ya busca por nombre, teléfono y
  // cédula (con la cédula primero) — antes solo se disparaba desde el campo Cliente.
  // Se prueban las DOS formas: solo dígitos (teléfonos guardados sin separadores) y el texto tal
  // como se escribió (teléfonos guardados con guion, que el `LIKE` del backend no normaliza).
  const [phoneSugs, setPhoneSugs] = useState<Client[]>([]);
  useEffect(() => {
    const digitos = phone.replace(/\D/g, '');
    const crudo = phone.trim();
    if (service || clientId != null || digitos.length < 5) { setPhoneSugs([]); return; }
    let alive = true;
    const limpiar = (list: Client[]) => list.filter(c => c.phone && c.name !== client.trim());
    const t = setTimeout(() => {
      api.suggestClients(digitos, 4)
        .then(async list => {
          if (!alive) return;
          if (list.length > 0 || crudo === digitos) { setPhoneSugs(limpiar(list)); return; }
          const conGuion = await api.suggestClients(crudo, 4).catch(() => [] as Client[]);
          if (alive) setPhoneSugs(limpiar(conGuion));
        })
        .catch(() => { if (alive) setPhoneSugs([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [phone, service, clientId, client]);

  // Qué le falta AL PASO ACTUAL para poder avanzar/guardar: se dice en pantalla en lugar de dejar
  // el botón apagado sin explicación (el último paso espeja EXACTAMENTE el `disabled` del botón).
  const faltaEnPaso = (() => {
    const falta: string[] = [];
    if (dayOpen === false) falta.push('abrir el día en Libro Diario');
    if (turnoViejo.stale) falta.push(`cerrar la caja del ${fechaLegible(turnoViejo.fechaTurno)} (Libro Diario → Cierres)`);
    if (wizStep === 0) {
      if (!client.trim()) falta.push('nombre del cliente');
      if (needCi && !clientCi.trim()) falta.push('cédula del cliente nuevo');
    } else if (wizStep === 1) {
      if (service) {
        if (!model.trim()) falta.push('modelo del equipo');
        if (serviceTypes.length === 0) falta.push('trabajo o falla');
        if (screenMissing) falta.push(screenMissing);
      } else {
        devices.forEach((d, i) => {
          const n = devices.length > 1 ? ` del equipo ${i + 1}` : '';
          if (!d.model.trim()) falta.push(`modelo${n}`);
          if (d.serviceTypes.length === 0) falta.push(`trabajo o falla${n}`);
        });
      }
    } else if (wizStep === steps.length - 1) {
      // Último paso: lo mismo que bloquea el botón Guardar (así nunca queda un botón apagado mudo).
      // El MONTO no entra acá: no bloquea el guardado (una orden de $0 es legítima) y la ficha ya lo
      // muestra como pendiente. Antes decía «Falta: monto» con el botón encendido.
      if (!client.trim()) falta.push('nombre del cliente');
      if (needCi && !clientCi.trim()) falta.push('cédula del cliente nuevo');
      if (service) {
        if (!model.trim()) falta.push('modelo del equipo');
        if (serviceTypes.length === 0) falta.push('trabajo o falla');
        if (screenMissing) falta.push(screenMissing);
      } else {
        devices.forEach((d, i) => {
          const n = devices.length > 1 ? ` del equipo ${i + 1}` : '';
          if (!d.model.trim()) falta.push(`modelo${n}`);
          if (d.serviceTypes.length === 0) falta.push(`trabajo o falla${n}`);
          // Equipo con «Cambio pantalla» y sin pantalla elegida: es lo que apaga Guardar en crear
          if (deviceScreenValid[i] === false) falta.push(`elegir la pantalla${n}`);
        });
      }
    }
    return falta;
  })();

  // ── F32: POLÍTICA del taller (foto de entrada/salida y acuerdo de pago) ───────────────────
  // Se anota SOLO lo que cambió, con el comando angosto `set_service_policy` (una columna, con
  // whitelist). Nunca bloquea el guardado: si esto falla, la orden ya quedó guardada y se avisa.
  const aplicarPolitica = async (ids: number[]) => {
    const intent = payIntentSel === 'sin' ? '' : payIntentSel;
    const prevIn = service?.photo_in_at ? 'si' : '';
    const prevOut = service?.photo_out_at ? 'si' : '';
    const prevIntent = service?.pay_intent ?? '';
    for (const id of ids) {
      if ((photoInDone ? 'si' : '') !== prevIn) await api.setServicePolicy(id, 'photo_in', photoInDone ? 'si' : '');
      if ((photoOutDone ? 'si' : '') !== prevOut) await api.setServicePolicy(id, 'photo_out', photoOutDone ? 'si' : '');
      if (intent !== prevIntent) await api.setServicePolicy(id, 'pay_intent', intent);
    }
  };
  const anotarPoliticaSinRomper = async (ids: number[]) => {
    if (ids.length === 0) return;
    try {
      await aplicarPolitica(ids);
    } catch (e) {
      toast.error(`La orden quedó guardada, pero no se pudieron anotar los recordatorios: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── F33: FICHA DE INGRESO (el asistente que pide un dato por vez) ─────────────────────────
  // Las reglas viven en `lib/ficha.ts` (puro, con pruebas): acá se le pasan los datos vivos del
  // formulario y ella dice qué mostrar y qué dato toca pedir AHORA.
  // El monto se evalúa POR EQUIPO en multi-equipo (igual que el pie del paso), no por la suma.
  const montoOk = service
    ? Math.max(0, amount - discount) > 0
    : devices.length > 0 && devices.every(d => Math.max(0, d.amount - d.discount) > 0);
  // En multi-equipo la ficha resume TODOS los equipos (la orden es del cliente que llega con sus
  // teléfonos): si a UNO le falta modelo o trabajo, el dato queda en «falta» — que es exactamente lo
  // que frena el guardado (`devicesValid`). Antes la ficha miraba solo el equipo 1 y podía decir
  // «Lista para guardar» con el botón apagado.
  const equiposOk = devices.length > 0 && devices.every(d => d.model.trim() && d.serviceTypes.length > 0);
  const modelosEquipos = devices.map(d => d.model.trim()).filter(Boolean);
  const tiposEquipos = [...new Set(devices.flatMap(d => d.serviceTypes))];
  const fallasEquipos = devices.map(d => d.fault.trim()).filter(Boolean);
  // Blindaje agregado: un dato solo se da por cargado si TODOS los equipos coinciden (si difieren,
  // el detalle por equipo vive en el paso Blindaje; mostrar el del primero sería mentir).
  const checklistComun = (key: string) => {
    const primero = devices[0]?.checklist[key] ?? '';
    return primero && devices.every(d => (d.checklist[key] ?? '') === primero) ? primero : '';
  };
  const checklistFicha = Object.fromEntries(
    CHECKLIST_ITEMS.map(it => [it.key, checklistComun(it.key)]).filter(([, v]) => v),
  );
  // La PANTALLA sí bloquea el guardado en los dos modos (`devicesValid` en crear, `screenMissing`
  // en editar): la ficha tiene que marcarla como obligatoria y saber si ya está resuelta.
  const pantallasOk = devices.every((_, i) => deviceScreenValid[i] !== false);
  const ficha = buildFicha(service ? {
    mode: 'editar', client, clientCi, needCi, phone, clientAddress,
    model, color, checklist, serviceTypes, fault,
    amount: Math.max(0, amount - discount), amountOk: montoOk,
    payIntent: payIntentSel === 'sin' ? null : payIntentSel,
    status, technician: currentTech?.name ?? service.technician ?? '',
    photoInAt: photoInDone ? (service.photo_in_at ?? 'si') : null,
    needsScreen: isScreenJobEdit, hasScreenOptions: screenOptions.length > 0,
    screenChosen: !screenMissing,
    checklistTotal: CHECKLIST_ITEMS.length, equipos: 1,
  } : {
    mode: 'crear', client, clientCi, needCi, phone, clientAddress,
    model: equiposOk ? modelosEquipos.join(' · ') : '',
    color: devices[0]?.color ?? '',
    checklist: checklistFicha,
    serviceTypes: equiposOk ? tiposEquipos : [],
    fault: fallasEquipos.join(' · '),
    amount: devices.reduce((a, d) => a + Math.max(0, d.amount - d.discount), 0), amountOk: montoOk,
    payIntent: payIntentSel === 'sin' ? null : payIntentSel,
    status, technician: currentTech?.name ?? '',
    photoInAt: photoInDone ? 'si' : null,
    needsScreen: devices.some(d => d.serviceTypes.includes('Cambio pantalla')),
    hasScreenOptions: devices.some((d, i) => deviceScreenValid[i] === false || d.screenProductId != null),
    screenChosen: pantallasOk,
    checklistTotal: CHECKLIST_ITEMS.length, equipos: devices.length,
  });
  // El monto NO bloquea el guardado, así que el pie lo dice como NOTA (no como «Falta:»): una orden
  // de $0 es legítima (garantía, cortesía, descuento del 100%).
  const sinMonto = service ? !(Math.max(0, amount - discount) > 0) : !montoOk;
  // El paso siguiente del PROCESO según el estado (una línea informativa al pie de la ficha).
  const pasoDelProceso = nextStep(status, {
    technician: currentTech?.name ?? '', hasPaid: (svc?.paid_amount ?? 0) > 0.005,
    payIntent: payIntentSel === 'sin' ? null : payIntentSel,
    needsScreen: service ? isScreenJobEdit : devices.some(d => d.serviceTypes.includes('Cambio pantalla')),
    screenChosen: service ? screenProductId != null : devices.every(d => !!d.screenProductId),
  });

  // F33: acá estaba el aviso flotante que salía al ABRIR una recepción. Se quitó: el usuario lo
  // sintió invasivo («no me deja ver lo que estoy registrando»). La política del taller ahora se
  // recuerda DENTRO del formulario, en la ficha de ingreso (foto de ENTRADA / pago acordado), y el
  // recordatorio flotante solo aparece si el operario guarda sin haberlos marcado (eso ya no tapa
  // el formulario: el diálogo se cerró). El foco sigue arrancando en Cliente (F31) sin que nada se
  // lo robe.

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        // F33: el foco del primer campo lo pone el PROPIO diálogo. Antes lo hacía, de rebote, el
        // aviso flotante que salía al abrir (y al quitarlo, el foco quedaba en el botón «Nuevo
        // Servicio»): Radix enfoca el contenedor al abrir y su efecto corre DESPUÉS del nuestro,
        // así que el `useEffect([wizStep])` no alcanzaba. Con `onOpenAutoFocus` el foco arranca en
        // Cliente (o en el primer campo del paso) sin que nada se lo robe.
        onOpenAutoFocus={e => { e.preventDefault(); clientRef.current?.focus(); }}
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { void guardarOrden(); return; }
          // F31: Enter en un campo de texto AVANZA al paso siguiente cuando el paso está completo
          // (nunca guarda: eso sigue siendo Ctrl+Enter o el botón del último paso). No se dispara
          // si el propio campo ya usó el Enter —el buscador de modelo hace preventDefault al
          // elegir— ni desde un textarea, donde Enter es un salto de línea.
          const t = e.target as HTMLElement | null;
          if (e.key === 'Enter' && !e.defaultPrevented && !e.shiftKey
            && t?.tagName === 'INPUT' && wizStep < steps.length - 1 && steps[wizStep].done) {
            e.preventDefault();
            setWizStep(w => w + 1);
          }
        }}>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>{service ? `Editar ${service.order_num}` : 'Nuevo Servicio Técnico'}</DialogTitle>
        </DialogHeader>
        {/* F82 — el aviso de la caja del día anterior sale AL ABRIR el formulario (no al guardar):
            así el operario no carga toda la ficha para que después no se pueda guardar. */}
        <TurnoViejoBanner turno={turnoViejo} className="shrink-0" puedeCerrar={puedeCerrarCaja} />
        {service?.status === 'Entregado' && service.date_out && warrantyStatus(service.date_out) === 'activa' && (
          <div className="shrink-0 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            <ShieldCheck className="size-4 shrink-0" />
            <span>
              <strong>En garantía</strong> — vence el {warrantyEnd(service.date_out)}. Si es un reclamo, reábrelo (cambia el estado) y al entregarlo la garantía reinicia sus 7 días.
            </span>
          </div>
        )}
        {service?.status === 'Entregado' && service.date_out && warrantyStatus(service.date_out) === 'vencida' && (
          <div className="shrink-0 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" />
            <span>Garantía vencida el {warrantyEnd(service.date_out)}</span>
          </div>
        )}
        <FormStepper steps={steps} current={wizStep} onNavigate={goTo} />
        {/* F33: el ASISTENTE es la ficha de ingreso. Dos líneas compactas — progreso de la ficha y
            el dato que toca pedir AHORA con su guía — y «Ver ficha» para los 4 bloques completos.
            No hay nada flotando encima del formulario (el usuario lo sintió invasivo) y cada dato
            de la ficha lleva a su paso para corregirlo sin perder el resto. */}
        <FichaIngreso
          ficha={ficha}
          nextProcess={pasoDelProceso}
          className="shrink-0"
          onGoToStep={irAlCampo}
        />
        {/* F79 — LA ORDEN YA ESTÁ GUARDADA (la creó el botón «Cobrar» del paso 2). Es el aviso que
            evita la confusión que el dueño temía («que no sea confuso»): dice el número REAL de la
            orden, que el botón del último paso la ACTUALIZA (no crea otra) y qué se cobró de cada
            equipo, con los números reales de la base. */}
        {ordenCreada && (
          <Alert className="shrink-0 border-success/40 bg-success/5 py-2" data-orden-guardada={ordenCreada.base}>
            <CheckCircle2 className="size-4 text-success" />
            <AlertDescription className="flex flex-col gap-1 text-[11px] text-foreground">
              <span className="font-semibold">{avisoOrdenGuardada(ordenCreada.base, devices.length)}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {devices.map((_, i) => {
                  const est = estadoCobroEquipo(i);
                  if (!est) return null;
                  return (
                    <span key={i} className={cn('font-medium', TONO_COBRO[est.tono])} data-cobro-equipo={i + 1}>
                      Equipo {i + 1}: {est.texto}
                    </span>
                  );
                })}
              </span>
            </AlertDescription>
          </Alert>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-4">
          {wizStep === 0 && (
          <>
          <div className="text-sm text-muted-foreground">
            Orden: <strong>{orderNum}</strong>
          </div>

          <SectionTitle step={1} title="Cliente" />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente *</label>
              <Input ref={clientRef} value={client} onChange={e => { clientPicked.current = false; setClient(e.target.value); setClientId(null); }}
                onBlur={() => {
                  // Cédula de primero: si lo escrito coincide con un cliente EXISTENTE,
                  // toma sus datos automáticamente; si no, registra nuevo al guardar.
                  const q = normCi(client);
                  if (q) {
                    api.findClientByCi(q).then(c => { if (c) selectClient(c); }).catch(() => {});
                  }
                  if (client.trim() && !clientPicked.current) setClient(titleCase(client));
                }}
                placeholder="Buscar por nombre o cédula (V-12345678)..." />
              {clientOpen && clientSugs.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {clientSugs.map(c => (
                    <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0 transition-colors"
                      onClick={() => selectClient(c)}>
                      <span className="font-medium">{c.name}</span>
                      {c.ci && <span className="text-muted-foreground text-xs ml-2">{c.ci}</span>}
                      {c.phone && <span className="text-muted-foreground text-xs ml-2">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Teléfono</label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0412-1234567" />
              {/* F31: el cliente conocido aparece al escribir su teléfono (un toque lo trae) */}
              {phoneSugs.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md overflow-hidden">
                  <p className="px-3 pt-2 text-[11px] text-muted-foreground">Cliente conocido con ese teléfono:</p>
                  {phoneSugs.map(c => (
                    <button key={c.id} type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0 transition-colors"
                      onClick={() => { selectClient(c); setPhoneSugs([]); }}>
                      <span className="font-medium">{c.name}</span>
                      {c.ci && <span className="text-muted-foreground text-xs ml-2">{c.ci}</span>}
                      {c.phone && <span className="text-muted-foreground text-xs ml-2">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cédula {needCi && '*'}</label>
              <Input value={clientCi} onChange={e => setClientCi(e.target.value)} placeholder="V-12345678" />
              {needCi && !clientCi.trim() && (
                <p className="text-xs text-danger">Obligatoria para cliente nuevo</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Dirección</label>
              <Input value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {/* F45: el rótulo se deja CORTO a propósito (el «se puede asignar después» ya lo dice la
                  ficha de ingreso al pie del dato, y alargar el rótulo empujaba el contenido del paso). */}
              <label className="text-sm font-medium">Técnico responsable</label>
              <Select value={techSel} onValueChange={setTechSel}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin asignar</SelectItem>
                  {technicians.map(t => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      <span className="flex items-center gap-2">
                        <span className={cn('inline-block size-3 rounded-full', t.color)} />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canManageTecnicos && (
              <div className="flex items-end">
                <Button variant="outline" className="w-full" onClick={() => setShowTechDialog(true)}>
                  <Users className="size-4" /> Técnicos
                </Button>
              </div>
            )}
          </div>

          {clientId != null && clientHistory.length === 0 && (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              Sin historial previo de servicios para este cliente
            </p>
          )}
          {clientHistory.length > 0 && (
            <div className="rounded-lg border border-border/70 p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Wrench className="size-4" /> Historial del cliente
              </p>
              <div className="divide-y divide-border/60">
                {clientHistory.slice(0, 6).map(h => (
                  <div key={h.id} className="py-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {parseServiceTypes(h).map(t => (
                          <Badge key={t} variant="outline" className="text-[11px] shrink-0">{t}</Badge>
                        ))}
                        <span className="text-sm font-medium truncate">{h.model ?? '-'}</span>
                      </div>
                      <span className="text-xs font-semibold shrink-0">${h.amount.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">{h.date_in ? h.date_in.slice(0, 10) : '-'}</span>
                      <Badge variant="outline" className="text-[11px] shrink-0">{h.status}</Badge>
                    </div>
                    {h.fault && <p className="text-xs text-muted-foreground line-clamp-1">{h.fault}</p>}
                  </div>
                ))}
              </div>
              {clientHistory.length > 6 && (
                <p className="text-xs text-muted-foreground">+{clientHistory.length - 6} más</p>
              )}
            </div>
          )}

          </>
          )}

          {wizStep === 1 && (service ? (
            <>
          <SectionTitle step={2} title="Equipo y diagnóstico" />
          {/* F77b: la pregunta del pago se hace ACÁ, al principio del paso del equipo — igual que en
              el alta, con el cliente enfrente. La foto de SALIDA NO va acá: depende del ESTADO, que se
              elige en «Finanzas», así que vive en ese paso (donde el operario pone «Entregado»). */}
          <PolicyFields
            payIntent={payIntentSel}
            onPayIntent={setPayIntentSel}
            photoOut={photoOutDone}
            onPhotoOut={setPhotoOutDone}
            showPhotoOut={false}
            equipos={1}
          />

          {/* F77b: el MÉTODO DE PAGO, también ANTES del modelo (el pedido del dueño vale para el alta
              y para la edición: las dos pasan por este paso). Antes vivía en «Finanzas», después del
              modelo. Con Punto se autocompleta la comisión y la moneda/referencia salen del método. */}
          <div className="grid grid-cols-2 gap-4" data-device-pay="edit">
            <div className="space-y-2">
              <label className="text-sm font-medium">Método de Pago</label>
              {/* F31: acceso directo a los más usados; el resto en «Otros métodos…» */}
              <PaymentMethodPicker
                methods={methods}
                value={payment}
                size="sm"
                onChange={v => {
                  setPayment(v);
                  if (v.includes('Punto')) setBankFeePercent(DEFAULT_PUNTO_FEE);
                }}
              />
            </div>
            {isPos ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Comisión Punto (%)</label>
                <Input type="number" step={0.1} min={0} max={100} value={bankFeePercent}
                  onChange={e => setBankFeePercent(Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">
                  Comisión: ${((amount * bankFeePercent) / 100).toFixed(2)} · Neto: ${(amount - (amount * bankFeePercent) / 100).toFixed(2)}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">Moneda</label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center gap-1.5">
                  <span className="font-semibold">{currencySymbol(methodCurrency(payment))}</span>
                  <span className="text-muted-foreground text-xs">
                    {methodCurrency(payment) === 'VES' ? 'Bolívares (según método)' : 'Dólares (según método)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {(isZelle || isPagoMovil) && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Referencia</label>
              <Input value={zelleReference} onChange={e => setZelleReference(e.target.value)}
                placeholder="Número de referencia (últimos 4 dígitos)..." data-field="referencia-edit" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Modelo *</label>
              <ModelCombobox
                value={model}
                onChange={selectModel}
                placeholder="Buscar el modelo del teléfono (ej: Spark 10 Pro)…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Monto ($)</label>
              {/* F49b: el descuento va al lado del precio (misma idea que el wizard de alta). */}
              <div className="flex items-center gap-2">
                <Input type="number" step={0.01} min={0} value={amount}
                  aria-label="Monto ($) del servicio"
                  onChange={e => {
                    const patch = amountTypedPatch(Number(e.target.value), discountTouched.current);
                    amountTouched.current = true;
                    setAmount(patch.amount ?? 0);
                    if (patch.discount !== undefined) setDiscount(patch.discount);
                  }} />
                <span className="shrink-0 text-xs text-muted-foreground" aria-hidden>−</span>
                <Input type="number" step={0.01} min={0} value={discount || ''} placeholder="Desc."
                  aria-label="Descuento ($) del servicio" data-field="descuento-servicio"
                  title="Descuento en $ sobre el precio. Se imprime en la factura y aplica con cualquier método de pago. (En una orden ya guardada se cambia desde el botón «Descuento» de la tarjeta.)"
                  className="w-24 shrink-0"
                  onChange={e => { discountTouched.current = true; setDiscount(Math.max(0, Number(e.target.value))); }} />
              </div>
              {/* F67 — el precio del repuesto acá SOLO se ofrece: una orden guardada no cambia de
                  monto sola (el monto puede estar cobrado hace meses). */}
              <PrecioRepuesto
                fuente={fuenteEdit} monto={amount}
                ofertaPantalla={ofertaPantallaEdit} ofertaModelo={ofertaModeloEdit}
                elegida={pantallaElegidaEdit ? partLabel(pantallaElegidaEdit.product) : null}
                sinPrecio={isScreenJobEdit && !!pantallaElegidaEdit && !ofertaPantallaEdit}
                onUsar={usarPrecioEdit} />
              {discount > 0.005 ? (
                <p className="text-xs font-semibold text-emerald-700" data-total-descuento>
                  ${amount.toFixed(2)} − ${discount.toFixed(2)} = <span className="text-sm">Total ${Math.max(0, amount - discount).toFixed(2)}</span>
                </p>
              ) : editNoCatalogPrice && (
                <p className="text-xs text-muted-foreground">Sin precios en el catálogo para este modelo: escribí el precio a mano.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Color del equipo</label>
            <ColorSelect value={color} onChange={setColor} />
            {/* F79 — EL COBRO, AL LADO DEL COLOR (el espacio que el dueño señaló). En EDICIÓN la orden
                ya existe, así que abre el MISMO «Pago / Abono» de la tarjeta sin guardar nada: es la
                opción de siempre, ahora también acá. Si el monto cambió sin guardar, el aviso lo dice
                (el cobro trabaja sobre la orden guardada). */}
            <CobroEnWizard modo="editar" total={svc?.amount ?? service.amount}
              estado={estadoCobroEditar} aviso={cobroAviso} cobrando={saving}
              onClick={() => cobrarEquipo(0)} bloqueado={!!estadoCobroEditar.motivo} />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                Trabajos / Fallas * <span className="font-normal text-muted-foreground">(elige todas las que apliquen)</span>
              </span>
              {/* F62: en EDICIÓN el «+» agrega la categoría al local y la deja elegida en la orden. */}
              {onNuevaCategoria && (
                <NuevaCategoriaChip existentes={[...SERVICE_TYPES, ...tiposExtra]} locales={tiposExtra} onQuitar={onQuitarCategoria} onCancelar={() => {}}
                  onAgregar={async (nombre) => {
                    const guardado = await onNuevaCategoria(nombre);
                    if (guardado) setServiceTypes(prev => (prev.includes(guardado) ? prev : [...prev, guardado]));
                    return guardado;
                  }} />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {[...SERVICE_TYPES, ...tiposExtra].map(t => {
                const active = serviceTypes.includes(t);
                return (
                  <button key={t} type="button"
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                    )}
                    onClick={() => setServiceTypes(prev => active ? prev.filter(x => x !== t) : [...prev, t])}>
                    {active && <Check className="size-3 inline mr-1" />}
                    {t}
                  </button>
                );
              })}
            </div>
            {serviceTypes.length === 0 && (
              <p className="text-xs text-danger">Elige al menos un trabajo o falla</p>
            )}
            {serviceTypes.includes('Otro') && (
              <>
                <Input value={otherFault} onChange={e => setOtherFault(e.target.value)}
                  placeholder="Describe el trabajo (ej: Cambio de pin de carga, placa de carga, trampilla...)" />
                {aliasDeTrabajo(otherFault) && (
                  <p className="text-[11px] text-muted-foreground" data-alias-aviso>
                    Se guardará como <span className="font-medium text-foreground">«{aliasDeTrabajo(otherFault)}»</span>: ya es un trabajo de la lista.
                  </p>
                )}
              </>
            )}
          </div>

          {isScreenJobEdit && (
            <ScreenSelect
              screenProductId={screenProductId}
              screenOptions={screenOptionsTodas}
              loading={compatLoading}
              confirmed={screenConfirm}
              permiteBuscar
              efectivo={isDivisasEdit}
              onPickOtra={setScreenExtra}
              onChange={setScreenProductId}
              onConfirm={setScreenConfirm}
              /* F80: el lápiz, igual que en el alta (solo master). */
              onEditarProducto={puedeEditarProducto ? p => fichaEdit.abrir(p) : undefined}
              onRegistrarPantalla={puedeEditarProducto && model.trim().length >= 3 ? () => fichaEdit.abrir(null) : undefined}
            />
          )}

          <FichaDeRepuestoDialog
            estado={fichaEdit.abierto}
            cats={fichaEdit.cats}
            catPantallaId={fichaEdit.abierto?.catPantalla ?? 1}
            modelo={model}
            puedeCategorias={puedeEditarProducto}
            onClose={fichaEdit.cerrar}
            onSaved={() => { amountTouched.current = true; fichaEdit.guardado(); }}
          />

          <PantallaViva
            elegidaId={screenProductId}
            extra={screenExtra}
            enLaLista={screenOptionsTodas.some(o => o.product.id === screenProductId)}
            listo={!compatLoading && compatAlDia}
            onPerdida={() => setScreenProductId(null)}
            onExtra={setScreenExtra}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">Falla / Trabajo realizado <span className="font-normal text-muted-foreground">(opcional)</span></label>
            <Textarea value={fault} onChange={e => setFault(e.target.value)}
              placeholder="Ej: Pantalla rota, se cambió por Incell nueva. Teléfono no enciende, se reemplazó batería..." />
          </div>

          </>
          ) : (
            <>
              <SectionTitle step={2} title={`Equipos (${devices.length})`} />
              {/* F77b — LA PREGUNTA DEL PAGO SE HACE ACÁ (pedido del dueño, 2026-09-25): «el mensaje
                  debería preguntarlo antes, en el paso 2 «Equipo», antes de colocar el modelo de
                  teléfono, así le avisa para colocar el monto o un producto en ese momento». Es el
                  MISMO control de siempre (mismo estado, una sola fuente) movido al principio del
                  paso: el operario pregunta con el cliente enfrente y recién después carga el equipo. */}
              <PolicyFields
                payIntent={payIntentSel}
                onPayIntent={setPayIntentSel}
                photoOut={photoOutDone}
                onPhotoOut={setPhotoOutDone}
                showPhotoOut={false}
                equipos={devices.length}
              />
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800" data-pay-early-hint>
                Aprovechá que el cliente está enfrente: al lado de cada equipo está el <strong>método de pago</strong>,
                y abajo el <strong>monto</strong> y —si lleva repuesto— el <strong>producto (la pantalla)</strong> que se
                le va a instalar. Cuando el monto y el color ya estén, tocá <strong>«Cobrar»</strong> (al lado del
                color del equipo): la orden se guarda y se abre el mismo <strong>Pago / Abono</strong> de siempre.
              </p>
              {ordenCreada && (
                <p className="rounded-md bg-success/10 px-3 py-2 text-[11px] text-foreground" data-equipos-fijos-paso>
                  {avisoEquiposFijos(ordenCreada.base)}
                </p>
              )}
              <div className="space-y-3">
                {devices.map((d, i) => (
                  <DeviceFields key={i} device={d} onChange={patch => setDevice(i, patch)} iva={iva} tasa={tasaIva}
                    methods={methods} index={i} onScreenValid={onScreenValid} autoFocus={false}
                    tiposExtra={tiposExtra} onNuevaCategoria={onNuevaCategoria} onQuitarCategoria={onQuitarCategoria} /* F31: no se auto-enfoca el combobox de modelo: al enfocarse abre su lista de 60 modelos tapando los campos */                    onRemove={() => removeDevice(i)} canRemove={devices.length > 1 && !ordenCreada} hideChecklist
                    /* F79: el cobro de ESTE equipo, al lado de su color, con SU aviso (un fallo del
                       equipo 2 no pinta de rojo el botón del equipo 1). */
                    onCobrar={cobrarEquipo} cobroEstado={estadoCobroEquipo(i)} cobroAviso={avisoCobroEquipo(i)}
                    cobrando={saving} puedeEditarProducto={puedeEditarProducto} />
                ))}
              </div>
              <Button type="button" variant="outline" onClick={addDevice} disabled={devices.length >= 10 || !!ordenCreada}
                title={ordenCreada ? avisoEquiposFijos(ordenCreada.base) : undefined}>
                <Plus className="size-4" /> Agregar otro equipo
              </Button>
              {devices.length > 1 && (
                <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                  {devices.length} equipos se guardan bajo una sola orden. Cada equipo tiene su propio
                  monto, pagos y entrega — el cliente puede pagar o abonar cada teléfono por separado.
                </p>
              )}
            </>
          ))}

          {wizStep === 2 && (
            <>
              <SectionTitle step={3} title="Blindaje del equipo (opcional)" tone="orange" />
              {/* F32: política de la empresa — la foto de ENTRADA se toma al revisar el equipo.
                  Es opcional: solo se anota para que quede el registro. */}
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <input type="checkbox" className="mt-0.5 size-4" checked={photoInDone}
                  onChange={e => setPhotoInDone(e.target.checked)} data-policy="photo_in" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Camera className="size-3.5 text-primary" /> Ya le tomé la foto de ENTRADA al equipo
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Política de la empresa: se le toma foto al teléfono al recibirlo{devices.length > 1 ? ` (los ${devices.length} equipos)` : ''}.
                  </span>
                </span>
              </label>
              {service ? (
                <ChecklistGrid value={checklist} onChange={setChecklist} />
              ) : (
                <div className="space-y-3">
                  {devices.map((d, i) => (
                    <div key={i} className="rounded-xl border border-border/70 p-4 space-y-2">
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Smartphone className="size-4 text-primary" /> Equipo {i + 1}
                        {d.model && <span className="text-muted-foreground font-normal text-xs truncate">— {d.model}</span>}
                      </p>
                      <ChecklistGrid value={d.checklist} onChange={cl => setDevice(i, { checklist: cl })} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {wizStep === 3 && (service ? (
            <>
              <SectionTitle step={4} title="Finanzas y estado" />
              {/* F77b: el MÉTODO DE PAGO (y su comisión/moneda/referencia) se mudó al paso del
                  EQUIPO, arriba del modelo — igual que en el alta: el pedido del dueño es preguntar
                  cómo paga ANTES de cargar el teléfono, y la edición pasa por el mismo paso 2. Acá
                  queda el ESTADO, que es lo que este paso decide. */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Estado</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map(s => (
                      <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* F77b: el acuerdo de pago se pregunta en el paso del EQUIPO (arriba, antes del
                  modelo) y no se repite acá; la foto de SALIDA sí queda al lado del ESTADO, que es el
                  control que decide si el equipo ya salió (misma condición de siempre: solo con un
                  estado de salida; si no, el tilde aparecería antes de elegir el estado). */}
              {(isDelivered(status) || status === 'Por entregar') && (
                <PhotoOutField
                  photoOut={photoOutDone}
                  onPhotoOut={setPhotoOutDone}
                  equipos={1}
                />
              )}
            </>
          ) : (
            <>
              <SectionTitle step={4} title="Revisar y guardar" />
              {/* F32: el ESTADO con el que nace la orden (antes quedaba en el default silencioso
                  «Por entregar» y el flujo del taller arrancaba a mitad de camino). La guía de
                  arriba explica qué pide cada estado. */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Estado del equipo</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-field="nuevo-estado"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* Solo estados de TALLER: entregar (o anular) es un acto aparte y se hace
                        cambiando el estado con el asistente «Cerrar» — ahí el backend descuenta
                        el stock, escribe la fecha de entrega y arranca la garantía. El backend
                        aplica la misma regla. */}
                    {statuses.filter(st => isCreatableStatus(st.name)).map(s => (
                      <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Lo normal es recibirlo en <strong>{DEFAULT_NEW_STATUS}</strong>: la guía de arriba te dice
                  qué falta para ese estado y cuál es el siguiente. Para entregar el equipo usá «Cerrar»
                  (o «Entregar») en la tarjeta: ahí se cobra, se descuenta el stock y queda la fecha.
                </p>
              </div>

              {/* F77b: el acuerdo de pago NO se vuelve a preguntar acá — se pregunta en el paso
                  «Equipos», antes del modelo (una sola vez y con el cliente enfrente). */}
              <div className="space-y-3">
                <div className="rounded-lg border border-border/70 p-4 space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <User className="size-4 text-primary" /> {client.trim() || 'Cliente'}
                    {clientCi && <span className="text-muted-foreground font-normal text-xs">· {clientCi}</span>}
                  </p>
                  {devices.map((d, i) => {
                    const net = Math.max(0, d.amount - d.discount);
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            <Smartphone className="size-3.5 inline mr-1 text-primary" /> {d.model || `Equipo ${i + 1}`}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {d.serviceTypes.map(t => <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>)}
                            {d.discount > 0.005 && <Badge variant="outline" className="text-[11px] text-emerald-600">Descuento ${d.discount.toFixed(2)}</Badge>}
                            {/* F31: el blindaje se ve acá también (es lo que se firma en el recibo) */}
                            <Badge variant="outline" className="text-[11px] text-orange-600">
                              Blindaje {Object.values(d.checklist).filter(v => v === 'si' || v === 'no').length}/{CHECKLIST_ITEMS.length}
                              {Object.values(d.checklist).filter(v => v === 'si').length > 0
                                && ` · ${Object.values(d.checklist).filter(v => v === 'si').length} con Sí`}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold">${net.toFixed(2)}</p>
                          <p className="text-[11px] text-muted-foreground">{d.payment}</p>
                          {/* F79: lo COBRADO de verdad de este equipo, si la orden ya se guardó desde
                              el wizard (mismo texto y mismos números que el botón del paso 2). */}
                          {(() => {
                            const est = estadoCobroEquipo(i);
                            if (!est) return null;
                            return (
                              <p className={cn('text-[11px] font-medium', TONO_COBRO[est.tono])} data-cobro-resumen={i + 1}>
                                {est.texto}
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between border-t pt-2 text-sm">
                    <span className="text-muted-foreground">Total a cobrar ({devices.length} equipo{devices.length === 1 ? '' : 's'})</span>
                    <span className="font-bold text-lg">${devices.reduce((a, d) => a + Math.max(0, d.amount - d.discount), 0).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {/* F79: con la orden YA guardada (la creó el botón de cobro) este texto no puede
                        seguir diciendo que «se crea la orden»: el botón del pie dice «Actualizar
                        orden» y el aviso verde dice que no crea otra. */}
                    {ordenCreada
                      ? `La orden ${ordenCreada.base} ya está guardada: «Actualizar orden» la corrige (no crea otra). La garantía de 7 días se aplica al entregar el equipo.`
                      : 'Al guardar se crea la orden con el número siguiente. La garantía de 7 días se aplica al entregar el equipo.'}
                  </p>
                </div>
              </div>

              {/* F77: el registro se cierra acá — guardar y (por defecto) abrir el comprobante. */}
              <PrintOnSaveField value={imprimirAhora} onChange={setImprimirAhora} equipos={devices.length} />
            </>
          ))}

          {service && wizStep === 4 && (
            <>
              <SectionTitle step={5} title="Cierre de la orden" />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Fecha Salida</label>
                  <Input type="date" value={dateOut} onChange={e => setDateOut(e.target.value)} />
                  <p className="text-xs text-muted-foreground">La garantía de 7 días se cuenta desde esta fecha (o desde el día que se entregue).</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Observaciones</label>
                  <Textarea value={observations} onChange={e => setObservations(e.target.value)} />
                </div>
              </div>

              <div className="rounded-lg border border-border/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Banknote className="size-4 text-emerald-600" /> Pagos y Abonos
                  </p>
                  {/* F94 — UN COBRO YA NO SE BLOQUEA POR LA CAJA: la plata del abono entra en la caja
                      del DÍA QUE SE ELIGE (y si ese día no tenía caja, el sistema se la crea). Antes
                      este botón se apagaba con el día cerrado o con la caja vieja abierta y el
                      mostrador no podía anotar un cobro atrasado. El cartel de arriba sigue avisando
                      para FACTURAR (ventas y órdenes), que es donde el turno viejo sí bloquea. */}
                  <Button variant="outline" size="sm" onClick={() => setShowPayDialog(true)}>
                    <Plus className="size-3.5" /> Registrar Pago / Abono
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted/60 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
                    <p className="font-bold">${totalOrden.toFixed(2)}</p>
                    {discount > 0.005 && (
                      <p className="text-[11px] text-muted-foreground">lista ${amount.toFixed(2)} − desc. ${discount.toFixed(2)}</p>
                    )}
                  </div>
                  <div className="rounded-md bg-muted/60 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Abonado</p>
                    <p className="font-bold text-emerald-600">
                      ${abonadoUsd.toFixed(2)}
                      {totalAbonadoBs > 0 && <span className="text-foreground font-medium"> + Bs. {totalAbonadoBs.toFixed(2)}</span>}
                    </p>
                  </div>
                  <div className="rounded-md px-3 py-2 border">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Saldo</p>
                    {isFinalized(service?.status) ? (
                      <p className="font-bold text-muted-foreground">{service?.status === 'Devuelto' ? 'Devuelto' : 'Cancelado'}</p>
                    ) : saldoUsd < -0.005 ? (
                      <p className="font-bold text-warning">Excedente ${excedenteUsd.toFixed(2)}</p>
                    ) : payments.length === 0 ? (
                      <p className="font-bold text-amber-600">Por pagar ${saldoUsd.toFixed(2)}</p>
                    ) : saldoUsd > 0.005 ? (
                      <p className="font-bold text-danger">${saldoUsd.toFixed(2)} pendiente</p>
                    ) : (
                      <p className="font-bold text-success">Cancelado</p>
                    )}
                  </div>
                </div>
                {payments.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead>Notas</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">{p.payment_date ? p.payment_date.slice(0, 16) : '-'}</TableCell>
                          <TableCell className="text-right font-medium">
                            {isRefund(p) ? (
                              <span className="text-danger">-{currencySymbol(p.currency)}{Math.abs(p.amount).toFixed(2)}</span>
                            ) : (
                              <>{currencySymbol(p.currency)}{p.amount.toFixed(2)}</>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {isRefund(p) ? <span className="font-medium text-danger">Devolución</span> : (p.payment_method ?? '-')}
                            {!isRefund(p) && isMovilOrZelle(p.payment_method) && p.zelle_reference && (
                              <span className="block text-xs text-muted-foreground">····{p.zelle_reference.slice(-4)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{p.notes ?? '-'}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                              onClick={() => doDeletePayment(p.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* F77: el registro se cierra acá — guardar y (por defecto) abrir el comprobante.
                  Va en el ÚLTIMO paso (Cierre), al lado del botón que guarda, igual que en el alta. */}
              <PrintOnSaveField value={imprimirAhora} onChange={setImprimirAhora} equipos={1} />
            </>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t pt-3">
          <div className="flex w-full items-center justify-between gap-2">
            {/* F79: si la orden ya se guardó desde este wizard (botón «Cobrar»), cerrar NO cancela
                nada — se dice, para que nadie crea que pierde el registro ni que tiene que guardar
                otra vez para que exista. */}
            <Button variant="outline" onClick={onClose}
              title={ordenCreada ? `La orden ${ordenCreada.base} ya está guardada: cerrar no la borra (se corrige desde su tarjeta).` : undefined}>
              {ordenCreada ? 'Cerrar' : 'Cancelar'}
            </Button>
            {/* F31: decir QUÉ FALTA en vez de dejar el botón apagado sin explicación, y recordar
                el teclado (Enter avanza · Ctrl+Enter guarda). */}
            <div className="flex min-w-0 flex-1 flex-col items-end gap-1 px-2">
              {avisoGuardar && (
                <span className="text-right text-[11px] font-medium text-danger">{avisoGuardar}</span>
              )}
              {faltaEnPaso.length > 0 && (
                <span className="text-right text-[11px] text-danger">Falta: {faltaEnPaso.join(' · ')}</span>
              )}
              {/* El monto NO bloquea (una orden de $0 es legítima): se dice como nota, no como falta. */}
              {sinMonto && faltaEnPaso.length === 0 && (
                <span className="text-right text-[11px] text-muted-foreground">
                  Sin monto: se guarda en $0 (podés cargarlo después)
                </span>
              )}
              <span className="text-right text-[11px] text-muted-foreground">
                {wizStep < steps.length - 1
                  ? 'Enter avanza · Ctrl+Enter guarda'
                  : (service || ordenCreada ? 'Ctrl+Enter actualiza · Esc cierra' : 'Ctrl+Enter guarda · Esc cierra')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {wizStep > 0 && (
                <Button type="button" variant="outline" onClick={() => setWizStep(w => w - 1)}>
                  Anterior
                </Button>
              )}
              {wizStep < steps.length - 1 ? (
                <Button type="button" onClick={() => setWizStep(w => w + 1)} disabled={!steps[wizStep].done}>
                  Siguiente
                </Button>
              ) : (
                <Button onClick={() => guardarOrden()} title="Ctrl+Enter" disabled={saving || dayOpen === false || turnoViejo.stale || !client || (service ? (!model || !!screenMissing || !!colorMissing) : !devicesValid) || (needCi && !clientCi.trim())}>
                  {/* F77: el botón dice lo que va a pasar — guardar y abrir el comprobante (o solo
                      guardar si el operario destildó el check del paso).
                      F79: con la orden ya guardada desde el botón de cobro, este botón ACTUALIZA esa
                      orden (y lo dice), para que nadie espere una segunda orden ni un duplicado. */}
                  {saving
                    ? 'Guardando...'
                    : (service
                        ? (imprimirAhora ? 'Actualizar e imprimir' : 'Actualizar Servicio')
                        : ordenCreada
                          ? (imprimirAhora ? 'Actualizar e imprimir' : 'Actualizar orden')
                          : (imprimirAhora
                              ? `Guardar e imprimir${devices.length > 1 ? ` (${devices.length} equipos)` : ''}`
                              : `Guardar Servicio${devices.length > 1 ? ` (${devices.length} equipos)` : ''}`))}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      <PaymentDialog
        service={svc}
        open={showPayDialog}
        onOpenChange={setShowPayDialog}
        dayOpen={dayOpen}
        puedeCerrarCaja={puedeCerrarCaja}
        onSaved={() => {
          if (!svc) return;
          api.getServicePayments(svc.id).then(setPayments).catch(() => setPayments([]));
          api.getService(svc.id).then(fresh => {
            setSvc(fresh);
            // F79: si el cobro fue sobre una fila de la orden creada desde el wizard, se refresca acá
            // para que el paso 2 muestre el cobro AL INSTANTE (el operario VE que la plata entró, con
            // el saldo real) y para que el próximo guardado trabaje sobre la fila al día.
            setOrdenCreada(o => (o && o.rows.some(r => r.id === fresh.id)
              ? { ...o, rows: o.rows.map(r => (r.id === fresh.id ? fresh : r)) }
              : o));
          }).catch(() => {});
          // F79: en el ALTA el cobro NO cierra el registro (el wizard sigue al blindaje). En EDICIÓN
          // se conserva el comportamiento de siempre (guardar un abono cierra el registro) SALVO que
          // el cobro se haya abierto desde el botón del paso 2: ahí el registro se queda abierto para
          // no tirar lo que el operario tenga escrito (en edición cobrar no guarda nada).
          if (service && !cobroDesdePaso2) onSaved();
          else onListChanged?.();
          setCobroDesdePaso2(false);
        }}
      />

      <TechniciansDialog
        open={showTechDialog}
        technicians={technicians}
        onOpenChange={setShowTechDialog}
        onChanged={() => loadTechnicians(true)}
      />
    </Dialog>
  );
}