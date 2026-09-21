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
// F32: recordatorios de política (foto / pago) y panel de los teléfonos entregados hoy. Las reglas
// viven en módulos puros con pruebas (lib/service-guide, lib/reminders): acá solo se conectan.
// F33: el asistente de recepción es la FICHA DE INGRESO (dentro del formulario, compacta) — se
// quitó el aviso flotante al registrar porque tapaba lo que el operario estaba escribiendo.
import { FichaIngreso } from './FichaIngreso';
import { firePolicyReminders } from './policy-actions';
import { PolicyModalHost } from './PolicyModal';
import DiscountDialog from './DiscountDialog';
import { EntregadosHoy } from './EntregadosHoy';
import { buildFicha } from '@/lib/ficha';
import { nextStep, DEFAULT_NEW_STATUS, isCreatableStatus, photoOutIsCurrent, needsTechnician } from '@/lib/service-guide';
import { deliverReminders, receiveReminders, payIntentLabel, isDelivered } from '@/lib/reminders';
// Piezas compartidas con el asistente de cierre (Harness F30): el stepper del wizard y la
// elección de la pantalla exacta viven en archivos propios para no tener dos copias.
import { FormStepper } from './FormStepper';
import { ScreenSelect, useCompatibleProducts } from './ScreenPicker';
import { asPhoneEntry, autoScreen, onlyScreens, screenOk } from '@/lib/screen-rules';
import { updateOrderKeepingFields } from '@/lib/service-update';
// F38: el saldo se dice en la moneda en que se cobró (+ equivalencia del día). Regla pura con test node.
import { orderBalance, balanceLabel } from '@/lib/order-balance';
import { DEFAULT_PUNTO_FEE } from '@/lib/payment-math';
// F44: TRABAJOS HECHOS — los contadores de la lista cuentan LO QUE SE ESTÁ VIENDO (entregados
// incluidos) con la misma regla que el filtro, y la línea de alcance dice sobre qué se cuenta.
// Reglas puras con prueba node (`tools/service_report_test.ts`).
import { ACTIVE_SENTINEL, NO_WORK_FILTER, matchesWorkFilter, scopeLabel, scopeProblem, serviceReport } from '@/lib/service-report';
import type { ScopeInput } from '@/lib/service-report';
import { cn, methodCurrency, currencySymbol, warrantyEnd, warrantyStatus, CHECKLIST_ITEMS, checklistDefaults, parseChecklist, checklistSummary, SERVICE_TYPES, parseServiceTypes, partLabel, initialsOf, titleCase, isRefund, isFinalized, shortMethodLabel, localDate, addDays } from '@/lib/utils';
import type { Service, ServicePayment, ServiceStatus, Product, Client, Technician, ServiceDeviceInput } from '../types';
import type { PhoneModelEntry } from '@/lib/utils';

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="size-4" /> Técnicos</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          La marca de color + iniciales identifica quién reparó cada equipo. Los cambios se guardan al salir del campo.
        </p>
        <div className="space-y-2">
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
        {error && <p className="text-sm text-danger">{error}</p>}
        <DialogFooter>
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

export default function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
  const [search, setSearch] = useState('');
  // F44 (pedido del dueño: «el filtro predeterminado debería ser todos los estados, el que tengo
  // actual es activos en taller, no debería ser ese»): `''` = TODOS LOS ESTADOS. Antes la lista
  // abría con el sentinel `__activos__` y, como lo entregado no está activo, el mostrador abría en
  // una lista vacía (en la base real las 4 órdenes son Entregado/Devuelto) justo cuando el cliente
  // pregunta «¿cuántas pantallas hiciste?». El eje Recibidos/Entregados sigue igual: con el eje de
  // ENTREGA una orden sin `date_out` no entra por sí sola, así que ya no hace falta forzar el estado.
  const [statusFilter, setStatusFilter] = useState('');
  // F32: eje del rango de fechas — 'in' recibidos (histórico) · 'out' ENTREGADOS (permite
  // «entregados hoy», que con el eje de recibido era imposible de ver).
  const [dateField, setDateField] = useState<'in' | 'out'>('in');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  // F32: teléfonos entregados HOY (fecha de entrega), para el panel y el KPI del dueño.
  const [entregadosHoy, setEntregadosHoy] = useState<Service[]>([]);
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
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Atajos de teclado: N/F2 = Nuevo Servicio, F4 = cerrar una entrega (cola), / = buscar.
  // Solo cuando NO se está escribiendo en un campo (o el dialog está cerrado).
  // F30: F4 no debe apilar la cola sobre otro diálogo ya abierto.
  const algunDialogoAbierto = showForm || showQueue || !!payFor || !!refundFor || !!printFor
    || !!deleting || !!cierreFor || !!confirmDeliver || showPrinterSettings;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === 'n' || e.key === 'N' || e.key === 'F2') && !typing && !showForm) {
        e.preventDefault();
        setEditing(null);
        setShowForm(true);
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
  }, [showForm, algunDialogoAbierto]);

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

  useEffect(() => { load(); }, []);
  useEffect(() => { api.getProducts('', null).then(setCatalog).catch(() => {}); }, []);
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
    api.getActiveDay().then(d => { setDayOpen(!!d); setTasaDia(d?.tasa_bcv ?? 0); }).catch(() => setDayOpen(true));
  }, []);

  const handleDelete = async (s: Service) => {
    await api.deleteService(s.id);
    setDeleting(null);
    load();
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
      load();
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
  };

  // F44 — TRABAJOS HECHOS: los contadores cuentan LA LISTA QUE SE ESTÁ VIENDO (búsqueda + estado +
  // rango de fechas), con los ENTREGADOS INCLUIDOS. Antes se contaban solo las órdenes activas
  // (`enTaller`), así que al filtrar por «Entregado» —justo cuando el dueño quiere contar lo que ya
  // salió— desaparecían todos los chips, y los trabajos escritos a mano («Otro») no tenían contador.
  // El reporte y el filtro salen del MISMO módulo puro (`lib/service-report`), así el número del chip
  // no puede mentir: dice exactamente las tarjetas que aparecen al hacerle clic.
  const report = useMemo(() => serviceReport(services), [services]);
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

  // Quitar TODOS los filtros de una vez (F44: antes «Limpiar» borraba solo las fechas y quedaba el
  // resto puesto sin que se notara; el eje Recibidos/Entregados se conserva porque sin rango no filtra).
  const limpiarFiltros = () => {
    setSearch('');
    setStatusFilter('');
    setDateStart('');
    setDateEnd('');
    setTypeFilter('');
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
    return (
      <Card key={s.id} className={cn(
        'overflow-hidden transition-shadow hover:shadow-md border-l-4',
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
          {dayOpen === true && (
            <span className="text-sm text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="size-4" /> Día abierto
            </span>
          )}
          <Button variant="outline" onClick={() => setShowQueue(true)} title="Cerrar una entrega (F4) — busca la orden y cobra en un paso">
            <Zap className="size-4" /> Cerrar entrega
          </Button>
          <Button variant="outline" onClick={() => setShowPrinterSettings(true)} title="Configurar impresora de tickets">
            <Printer className="size-4" /> Impresora
          </Button>
          <Button onClick={() => { setEditing(null); setShowForm(true); }} title="Nuevo Servicio (N o F2)">
            <Plus className="size-4" /> Nuevo Servicio
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          {/* F44: el KPI cuenta LA LISTA (con el chip de trabajo y los filtros puestos), no todo lo
              que trajo el backend: antes este número no coincidía con las tarjetas de abajo. */}
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Equipos en la lista</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold" data-kpi="equipos">{visibleServices.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Listos para entregar</CardTitle></CardHeader>
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
        {/* F32: el dueño quiere ver de un vistazo los teléfonos que SALIERON hoy (fecha de entrega) */}
        <Card
          role="button"
          tabIndex={0}
          title="Ver los teléfonos entregados hoy (por fecha de entrega)"
          onClick={verEntregadosHoy}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); verEntregadosHoy(); } }}
          className="cursor-pointer border-emerald-500/30 bg-emerald-500/5 transition-shadow hover:shadow-md"
          data-kpi="entregados-hoy"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-600" /> Entregados hoy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-700">{entregadosHoy.length}</div>
            <p className="text-[11px] text-muted-foreground">por fecha de entrega · clic para filtrar</p>
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

      {/* ── TRABAJOS HECHOS (F44) ────────────────────────────────────────────────────────────────
          La respuesta a «¿cuántas pantallas hice hoy?» sin adivinar: cuántos equipos y QUÉ trabajos
          hay en lo que se está viendo, con los entregados incluidos, y —debajo— sobre qué se está
          contando (estado, eje de fecha y rango) para poder decirlo con seguridad. */}
      <div className="flex flex-col gap-0.5" data-report="trabajos">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold">Trabajos hechos:</span>
          <span data-report-total><span className="font-bold">{report.equipos}</span> equipos</span>
          <span className="text-emerald-700">{report.entregados} entregados</span>
          <span className="text-warning">{report.taller} en taller</span>
          {report.anulados > 0 && <span className="text-danger">{report.anulados} devueltos/cancelados</span>}
          {report.sinTrabajo > 0 && (
            <span className="text-muted-foreground">{report.sinTrabajo} sin trabajo anotado</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground" data-report-scope>{scopeLabel(alcance)}</p>
        {pagosSinCargar && (
          <p className="text-xs text-warning" data-note="pagos-no-cargados">
            Lista muy larga: el método de pago real se muestra hasta 120 equipos — acotá el rango de fechas para verlo.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={typeFilter === '' ? 'default' : 'outline'} size="sm"
          data-work-chip="todos" data-work-count={services.length}
          onClick={() => setTypeFilter('')}>
          Todos <span className="ml-1 rounded-full bg-background/60 px-1.5 text-[11px] font-bold">{services.length}</span>
        </Button>
        {report.porTrabajo.map(tc => (
          <Button key={tc.key} variant={typeFilter === tc.key ? 'default' : 'outline'} size="sm"
            data-work-chip={tc.key} data-work-count={tc.total}
            title={`${tc.total} equipos · ${tc.entregados} entregados · ${tc.taller} en taller${tc.anulados ? ` · ${tc.anulados} devueltos/cancelados` : ''}`}
            onClick={() => setTypeFilter(typeFilter === tc.key ? '' : tc.key)}>
            {tc.label} <span className="ml-1 rounded-full bg-background/60 px-1.5 text-[11px] font-bold">{tc.total}</span>
          </Button>
        ))}
        {/* F44: los equipos sin ningún trabajo anotado tienen su propio chip para que los números
            cierren (nunca «desaparece» un equipo sin explicación). */}
        {report.sinTrabajo > 0 && (
          <Button variant={typeFilter === NO_WORK_FILTER ? 'default' : 'outline'} size="sm"
            data-work-chip={NO_WORK_FILTER} data-work-count={report.sinTrabajo}
            title="Equipos sin ningún trabajo/falla anotado (órdenes viejas o recepciones sin tipo)"
            onClick={() => setTypeFilter(typeFilter === NO_WORK_FILTER ? '' : NO_WORK_FILTER)}>
            Sin trabajo anotado <span className="ml-1 rounded-full bg-background/60 px-1.5 text-[11px] font-bold">{report.sinTrabajo}</span>
          </Button>
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
                    : 'Sin equipos con estos filtros.'}
                </span>
                <span className="text-xs">{scopeLabel(alcance)}</span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {problemaAlcance === 'activos-sin-entrega' && (
                    <Button variant="outline" size="sm" onClick={() => setDateField('in')}>Cambiar a Recibidos</Button>
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
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
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
        onSaved={load}
      />

      <PaymentDialog
        service={payFor}
        open={!!payFor}
        onOpenChange={(o) => { if (!o) setPayFor(null); }}
        dayOpen={dayOpen}
        onSaved={load}
      />

      {/* F34: cambio rápido de técnico (clic en el círculo/nombre del técnico de la tarjeta). */}
      <Dialog open={!!quickTech} onOpenChange={(o) => { if (!o) setQuickTech(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              Cambiar técnico · {quickTech?.order_num}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1" data-quick-tech>
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
        onSaved={load}
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
        onSaved={load}
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

// Auto-precio al elegir un modelo del catálogo (compartido por DeviceFields y ServiceForm):
// - En efectivo (Divisas USD Cash): monto = price_usd (si existe) y descuento = price_sale - price_usd.
// - En cualquier otro método: monto = price_sale (si todos los repuestos coinciden y > 0).
// NUNCA pisa un monto/descuento que el usuario ya tocó (refs amountTouched/discountTouched).
function applyModelPrice(sugg: PhoneModelEntry, isDivisas: boolean, amountTouched: boolean, discountTouched: boolean): Partial<FormDevice> {
  const patch: Partial<FormDevice> = {};
  const prices = new Set(sugg.products.map(p => p.price_sale));
  if (!amountTouched) {
    if (isDivisas) {
      const withUsd = sugg.products.filter(p => p.price_usd > 0);
      if (withUsd.length > 0) {
        // El MISMO repuesto que da el precio de contado da el precio de lista: el descuento
        // sugerido (que se guarda en la orden) tiene que salir de esa ficha y no de la primera
        // de la lista — el backend ordena por marca y «primera» cambió con el gate de marca.
        const base0 = withUsd.reduce((a, b) => (b.price_usd < a.price_usd ? b : a));
        patch.amount = base0.price_usd;
        if (!discountTouched) {
          const base = prices.size === 1 ? [...prices][0] : base0.price_sale;
          patch.discount = Math.max(0, base - base0.price_usd);
        }
        return patch;
      }
    }
    if (prices.size === 1) {
      const only = [...prices][0];
      if (only > 0) patch.amount = only;
    }
  }
  return patch;
}
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

// Un equipo dentro de una orden multi-equipo (solo modo crear):
// modelo (con sugerencias), monto, trabajos/fallas, blindaje colapsable y finanzas propias.
function DeviceFields({ device, onChange, methods, index, onRemove, canRemove, hideChecklist = false, onScreenValid, autoFocus = false }: {
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
}) {
  const [showChecklist, setShowChecklist] = useState(false);

  const isPos = device.payment.includes('Punto');
  const isZelle = device.payment.includes('Zelle');
  const isPagoMovil = device.payment.includes('Móvil') || device.payment.includes('Movil');
  const isDivisas = device.payment === 'Divisas (USD Cash)';
  // Monto = PRECIO del servicio; Total a pagar = Monto − Descuento (lo que se guarda)
  const deviceNet = Math.max(0, device.amount - device.discount);

  // Compatibilidad resuelta por el backend para el modelo escrito
  const { candidates, loading: compatLoading } = useCompatibleProducts(device.model);
  const screenOptions = useMemo(() => onlyScreens(candidates), [candidates]);
  const isScreenJob = device.serviceTypes.includes('Cambio pantalla');

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
  const screenValid = screenOk(device.serviceTypes, device.screenProductId, screenOptions);
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

  const selectModel = (label: string) => {
    onChange({ model: label, modelPicked: true });
    const entry = asPhoneEntry(label, candidates);
    if (entry.products.length > 0) {
      onChange(applyModelPrice(entry, isDivisas, device.amountTouched, device.discountTouched));
    }
  };

  const divHints = useMemo(() => {
    if (!isDivisas || !device.model.trim() || candidates.length === 0) return null;
    const products = candidates.map(c => c.product);
    const withUsd = products.filter(p => p.price_usd > 0);
    if (withUsd.length === 0) return null;
    const usdPrice = Math.min(...withUsd.map(p => p.price_usd));
    const saleSet = [...new Set(products.map(p => p.price_sale))];
    const base = saleSet.length === 1 ? saleSet[0] : withUsd[0].price_sale;
    return { base, usdPrice, suggested: Math.max(0, base - usdPrice) };
  }, [isDivisas, device.model, candidates]);

  // Catálogo sin precios para este modelo: el descuento se escribe a mano
  const noCatalogPrice = useMemo(
    () => candidates.length > 0 && candidates.every(c => c.product.price_sale <= 0),
    [candidates],
  );

  return (
    <div className="rounded-xl border border-border/70 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Smartphone className="size-4 text-primary" /> Equipo {index + 1}
        </p>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
          onClick={onRemove} disabled={!canRemove}>
          <Trash2 className="size-3.5" /> Quitar
        </Button>
      </div>

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
          <Input type="number" step={0.01} min={0} value={device.amount}
            onChange={e => onChange({ amount: Number(e.target.value), amountTouched: true })} />
          {isDivisas && divHints && (
            <p className="text-xs text-muted-foreground">
              Precio lista ${divHints.base.toFixed(2)} · Efectivo sugerido ${divHints.usdPrice.toFixed(2)}
            </p>
          )}
          {device.discount > 0.005 && (
            <p className="text-xs font-semibold text-emerald-700">Total a pagar: ${deviceNet.toFixed(2)}</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Color del equipo <span className="text-danger">*</span></label>
          <ColorSelect value={device.color} onChange={c => onChange({ color: c })} />
          {/* F48: el color es obligatorio; se dice acá (además de la ficha y del «Falta: …» del pie). */}
          {!device.color.trim() && <p className="text-xs text-danger">Elegí el color del equipo</p>}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Descuento ($)</label>
        <Input type="number" step={0.01} min={0} value={device.discount}
          onChange={e => onChange({ discount: Math.max(0, Number(e.target.value)), discountTouched: true })} />
        <p className="text-xs text-muted-foreground">
          {device.discount > 0.005 ? (
            <>Precio ${device.amount.toFixed(2)} − Descuento ${device.discount.toFixed(2)} → <span className="font-semibold text-emerald-700">Total ${deviceNet.toFixed(2)}</span></>
          ) : noCatalogPrice ? (
            <>Sin precios en el catálogo para este modelo: escribe el precio y el descuento a mano (el total se calcula solo).</>
          ) : (
            <>Sin descuento: el cliente paga el precio completo. El descuento aplica con cualquier método de pago.</>
          )}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">
          Trabajos / Fallas * <span className="font-normal text-muted-foreground">(elige todas las que apliquen)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {SERVICE_TYPES.map(t => {
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
          <Input value={device.otherFault} onChange={e => onChange({ otherFault: e.target.value })}
            placeholder="Describe el trabajo (ej: Cambio de pin de carga, placa de carga, trampilla...)" />
        )}
      </div>

      {isScreenJob && (
        <ScreenSelect
          screenProductId={device.screenProductId}
          screenOptions={screenOptions}
          loading={compatLoading}
          confirmed={device.screenConfirm}
          onChange={id => onChange({ screenProductId: id })}
          onConfirm={v => onChange({ screenConfirm: v })}
        />
      )}

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

      <div className="grid grid-cols-2 gap-4">
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
      <p className="text-[11px] text-muted-foreground">
        Pregúntale al cliente y elegí una opción: queda visible en la orden y en la lista, así el saldo no
        aparece «de la nada» cuando venga a retirar el equipo. Con qué método paga se elige arriba.
      </p>
      {showPhotoOut && (
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
      )}
    </div>
  );
}

function ServiceForm({ service, statuses, dayOpen, onClose, onSaved }: {
  service: Service | null;
  statuses: ServiceStatus[];
  dayOpen: boolean | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [orderNum, setOrderNum] = useState('');
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
  const amountTouched = useRef(false);
  const discountTouched = useRef(false);
  const [discount, setDiscount] = useState(0);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [svc, setSvc] = useState<Service | null>(service);
  const [screenProductId, setScreenProductId] = useState<number | null>(null);
  const [screenConfirm, setScreenConfirm] = useState(true);  // F47: arranca marcada (ver emptyDevice)
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [techSel, setTechSel] = useState('');
  const [showTechDialog, setShowTechDialog] = useState(false);
  // Órdenes multi-equipo (solo modo crear): un cliente, N teléfonos en una sola orden
  const [devices, setDevices] = useState<FormDevice[]>([emptyDevice()]);
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
  const { candidates, loading: compatLoading } = useCompatibleProducts(model);
  const screenOptions = useMemo(() => onlyScreens(candidates), [candidates]);
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
    modelPicked.current = true;
    setModel(label);
    const entry = asPhoneEntry(label, candidates);
    if (entry.products.length > 0) {
      const patch = applyModelPrice(entry, payment === 'Divisas (USD Cash)', amountTouched.current, discountTouched.current);
      if ('amount' in patch) setAmount(patch.amount ?? 0);
      if ('discount' in patch) setDiscount(patch.discount ?? 0);
    }
  };

  // Normaliza una cédula para buscar: quita prefijo V-/E-, espacios y guiones
  const normCi = (s: string) => s.trim().replace(/^[VvEe]-?\s*/, '').replace(/\D/g, '');

  const needCi = !service && !clientId;

  // Catálogo sin precios para este modelo: el descuento se escribe a mano (hint honesto)
  const editNoCatalogPrice = useMemo(
    () => candidates.length > 0 && candidates.every(c => c.product.price_sale <= 0),
    [candidates],
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

  const save = async () => {
    // F31: los MISMOS gates que el botón, también por Ctrl+Enter (antes el atajo los salteaba y se
    // podía guardar un cliente nuevo sin cédula o con el día cerrado, sin ningún aviso).
    const bloqueos: string[] = [];
    if (saving) bloqueos.push('ya se está guardando');
    if (dayOpen === false) bloqueos.push('abrir el día en Libro Diario');
    if (needCi && !clientCi.trim()) bloqueos.push('cédula del cliente nuevo');
    // OJO: el MONTO **no** es un bloqueo del guardado. El paso del wizard pide un monto para
    // avanzar, pero una orden de $0 es legítima (garantía, cortesía, descuento del 100%) y hay
    // órdenes reales así en la base: bloquear acá dejaba esas órdenes sin poder guardarse.
    // La guía lo muestra como AVISO (no bloqueante), no como requisito.
    if (bloqueos.length > 0) { setAvisoGuardar(`No se guardó — falta: ${bloqueos.join(' · ')}`); return; }
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
    if (bloqueos.length > 0) { setAvisoGuardar(`No se guardó — falta: ${bloqueos.join(' · ')}`); return; }
    setAvisoGuardar(null);
    setSaving(true);
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
        if (serviceTypes.includes('Otro') && otherFault.trim()) typesArr.push(otherFault.trim());
        const serviceTypesJson = JSON.stringify(typesArr);
        await api.updateService(service.id, client, phone, model, fault, serviceType, serviceTypesJson, Math.max(0, amount - discount), payment, dateOut, status, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, checklistJson, techName, techId, color, screenProductId, discount);
        // F32: las señales de política que se marcaron en el formulario (si no cambió nada, no
        // se escribe nada) — nunca tumban el guardado.
        await anotarPoliticaSinRomper([service.id]);
      } else {
        const inputs: ServiceDeviceInput[] = devices.map(d => {
          const typesArr = [...d.serviceTypes];
          if (d.serviceTypes.includes('Otro') && d.otherFault.trim()) typesArr.push(d.otherFault.trim());
          return {
            model: d.model,
            color: d.color,
            fault: d.fault,
            service_type: d.serviceTypes[0] ?? 'Cambio pantalla',
            service_types: JSON.stringify(typesArr),
            // Monto = precio; Total a pagar (guardado) = Monto − Descuento
            amount: Math.max(0, d.amount - d.discount),
            discount_amount: d.discount,
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
        // addServiceOrder es transaccional y asigna los números: equipo 1 = base, 2+ = base-B/C...
        // (1 solo equipo → sin group_id, exactamente como antes)
        const base = await api.addServiceOrder(client, phone, clientCi, clientAddress, cid, techName, techId, inputs);
        // F32: filas creadas (una por equipo) para anotar la política y recordar lo pendiente
        const nuevas = await api.getServices(base, '', '', '', 'in').catch(() => [] as Service[]);
        const filas = nuevas.filter(r => r.order_num === base || (r.order_num ?? '').startsWith(`${base}-`));
        const ids = filas.map(r => r.id);
        await anotarPoliticaSinRomper(ids);
        // Recordatorios de política de la RECEPCIÓN: foto de ENTRADA + preguntar el pago.
        // Se muestran una sola vez y solo por lo que quedó pendiente (si el operario ya lo
        // marcó en el formulario, no aparece). Nunca bloquean.
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
          onSaved,
        );
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  // Abonado total del servicio en $ (el backend convierte pagos en Bs con la tasa del día del pago)
  const abonadoUsd = svc?.paid_amount ?? 0;
  // Saldo honesto: positivo = pendiente, negativo = excedente (se cobró de más)
  const saldoUsd = amount - abonadoUsd;
  const excedenteUsd = -Math.min(0, saldoUsd);
  const totalAbonadoBs = payments.reduce((a, p) => a + (p.currency === 'VES' ? p.amount : 0), 0);

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
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { save(); return; }
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
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={() => setShowTechDialog(true)}>
                <Users className="size-4" /> Técnicos
              </Button>
            </div>
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
              <Input type="number" step={0.01} min={0} value={amount}
                onChange={e => { amountTouched.current = true; setAmount(Number(e.target.value)); }} />
            </div>
          </div>

          <div className="space-y-2">
              <label className="text-sm font-medium">Descuento ($)</label>
              <Input type="number" step={0.01} min={0} value={discount}
                onChange={e => { discountTouched.current = true; setDiscount(Math.max(0, Number(e.target.value))); }} />
              <p className="text-xs text-muted-foreground">
                {discount > 0.005 ? (
                  <>Precio ${amount.toFixed(2)} − Descuento ${discount.toFixed(2)} → <span className="font-semibold text-emerald-700">Total ${Math.max(0, amount - discount).toFixed(2)}</span></>
                ) : editNoCatalogPrice ? (
                  <>Sin precios en el catálogo para este modelo: escribe el precio y el descuento a mano (el total se calcula solo).</>
                ) : (
                  <>Sin descuento: el cliente paga el precio completo. El descuento aplica con cualquier método de pago.</>
                )}
              </p>
            </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Color del equipo</label>
            <ColorSelect value={color} onChange={setColor} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Trabajos / Fallas * <span className="font-normal text-muted-foreground">(elige todas las que apliquen)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_TYPES.map(t => {
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
              <Input value={otherFault} onChange={e => setOtherFault(e.target.value)}
                placeholder="Describe el trabajo (ej: Cambio de pin de carga, placa de carga, trampilla...)" />
            )}
          </div>

          {isScreenJobEdit && (
            <ScreenSelect
              screenProductId={screenProductId}
              screenOptions={screenOptions}
              loading={compatLoading}
              confirmed={screenConfirm}
              onChange={setScreenProductId}
              onConfirm={setScreenConfirm}
            />
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Falla / Trabajo realizado <span className="font-normal text-muted-foreground">(opcional)</span></label>
            <Textarea value={fault} onChange={e => setFault(e.target.value)}
              placeholder="Ej: Pantalla rota, se cambió por Incell nueva. Teléfono no enciende, se reemplazó batería..." />
          </div>

          </>
          ) : (
            <>
              <SectionTitle step={2} title={`Equipos (${devices.length})`} />
              <div className="space-y-3">
                {devices.map((d, i) => (
                  <DeviceFields key={i} device={d} onChange={patch => setDevice(i, patch)}
                    methods={methods} index={i} onScreenValid={onScreenValid} autoFocus={false} /* F31: no se auto-enfoca el combobox de modelo: al enfocarse abre su lista de 60 modelos tapando los campos */
                    onRemove={() => removeDevice(i)} canRemove={devices.length > 1} hideChecklist />
                ))}
              </div>
              <Button type="button" variant="outline" onClick={addDevice} disabled={devices.length >= 10}>
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
              <div className="grid grid-cols-2 gap-4">
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
              </div>

              {isPos && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Comisión Punto (%)</label>
                    <Input type="number" step={0.1} min={0} max={100} value={bankFeePercent}
                      onChange={e => setBankFeePercent(Number(e.target.value))} />
                    <p className="text-xs text-muted-foreground">
                      Comisión: ${((amount * bankFeePercent) / 100).toFixed(2)} · Neto: ${(amount - (amount * bankFeePercent) / 100).toFixed(2)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Moneda</label>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center gap-1.5">
                      <span className="font-semibold">{currencySymbol(methodCurrency(payment))}</span>
                      <span className="text-muted-foreground text-xs">
                        {methodCurrency(payment) === 'VES' ? 'Bolívares (según método)' : 'Dólares (según método)'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {(isZelle || isPagoMovil) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Referencia</label>
                  <Input value={zelleReference} onChange={e => setZelleReference(e.target.value)}
                    placeholder="Número de referencia (últimos 4 dígitos)..." />
                </div>
              )}

              {/* F32: recordatorios del taller (acuerdo de pago + foto de salida). Si el estado
                  es de salida, la foto se puede confirmar acá mismo antes de guardar. */}
              <PolicyFields
                payIntent={payIntentSel}
                onPayIntent={setPayIntentSel}
                photoOut={photoOutDone}
                onPhotoOut={setPhotoOutDone}
                showPhotoOut={isDelivered(status) || status === 'Por entregar'}
                equipos={1}
              />
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

              <PolicyFields
                payIntent={payIntentSel}
                onPayIntent={setPayIntentSel}
                photoOut={photoOutDone}
                onPhotoOut={setPhotoOutDone}
                // Al CREAR una recepción no se ofrece la foto de SALIDA: el equipo recién entra al
                // taller y entregar es un acto aparte (botón «Entregar» / asistente «Cerrar», que sí
                // lo piden). Marcarla acá estampaba una foto de la RECEPCIÓN que después, si se
                // entregaba el mismo día, `photoOutIsCurrent` daba por válida y se callaba el aviso.
                showPhotoOut={false}
                equipos={devices.length}
              />

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
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between border-t pt-2 text-sm">
                    <span className="text-muted-foreground">Total a cobrar ({devices.length} equipo{devices.length === 1 ? '' : 's'})</span>
                    <span className="font-bold text-lg">${devices.reduce((a, d) => a + Math.max(0, d.amount - d.discount), 0).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Al guardar se crea la orden con el número siguiente. La garantía de 7 días se aplica al entregar el equipo.
                  </p>
                </div>
              </div>
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
                  <Button variant="outline" size="sm" onClick={() => setShowPayDialog(true)} disabled={dayOpen === false}>
                    <Plus className="size-3.5" /> Registrar Pago / Abono
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted/60 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
                    <p className="font-bold">${amount.toFixed(2)}</p>
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
            </>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t pt-3">
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
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
                  : (service ? 'Ctrl+Enter actualiza · Esc cierra' : 'Ctrl+Enter guarda · Esc cierra')}
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
                <Button onClick={save} title="Ctrl+Enter" disabled={saving || dayOpen === false || !client || (service ? (!model || !!screenMissing || !!colorMissing) : !devicesValid) || (needCi && !clientCi.trim())}>
                  {saving ? 'Guardando...' : (service ? 'Actualizar Servicio' : `Guardar Servicio${devices.length > 1 ? ` (${devices.length} equipos)` : ''}`)}
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
        onSaved={() => {
          if (!svc) return;
          api.getServicePayments(svc.id).then(setPayments).catch(() => setPayments([]));
          api.getService(svc.id).then(setSvc).catch(() => {});
          onSaved();
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