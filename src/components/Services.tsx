import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, ShieldCheck, Trash2, Lock, CheckCircle2, Banknote, User, Smartphone, CalendarDays, Wrench, Clock, Check, Users, Printer } from 'lucide-react';
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
import { api } from '../db';
import PaymentDialog from './PaymentDialog';
import PrintReceiptDialog from './PrintReceiptDialog';
import PrinterSettingsDialog from './PrinterSettingsDialog';
import { cn, methodCurrency, currencySymbol, warrantyEnd, warrantyStatus, CHECKLIST_ITEMS, parseChecklist, checklistSummary, SERVICE_TYPES, parseServiceTypes, buildPhoneModels, partLabel, normPhoneModel } from '@/lib/utils';
import type { Service, ServicePayment, ServiceStatus, Product, Client, Technician } from '../types';
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

// Iniciales de un nombre ("Luis Felipe" → "LF"); fallback cuando el técnico fue borrado
function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

function isMovilOrZelle(m: string | null | undefined): boolean {
  return !!m && (m.includes('Móvil') || m.includes('Movil') || m.includes('Zelle'));
}

// Estados "en taller": el equipo aún no se entrega
const ACTIVE_STATUSES = ['Recibido', 'En reparación', 'Esperando repuesto', 'Reparado / Pendiente Pago', 'Por entregar'];

function SectionTitle({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">{step}</span>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
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

export default function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [payFor, setPayFor] = useState<Service | null>(null);
  const [printFor, setPrintFor] = useState<Service | null>(null);
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [delivering, setDelivering] = useState<Service | null>(null);
  const [confirmDeliver, setConfirmDeliver] = useState<Service | null>(null);
  const [dayOpen, setDayOpen] = useState<boolean | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);

  const techById = (id: number | null | undefined) => technicians.find(t => t.id === id);

  const load = async () => {
    const [s, st, techs] = await Promise.all([
      api.getServices(search, statusFilter, dateStart, dateEnd),
      api.getServiceStatuses(),
      api.getTechnicians().catch(() => [] as Technician[]),
    ]);
    setServices(s);
    setStatuses(st);
    setTechnicians(techs);
  };

  useEffect(() => { load(); }, []);
  // Debounce: la búsqueda solo consulta tras 350ms de inactividad
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [search, statusFilter, dateStart, dateEnd]);

  useEffect(() => {
    api.getActiveDay().then(d => setDayOpen(!!d)).catch(() => setDayOpen(true));
  }, []);

  const handleDelete = async (s: Service) => {
    await api.deleteService(s.id);
    setDeleting(null);
    load();
  };

  // Entrega directa: status Entregado + date_out vacío (el backend pone la fecha de hoy y descuenta stock)
  const deliver = async (s: Service) => {
    setDelivering(s);
    try {
      await api.updateService(
        s.id, s.client ?? '', s.phone ?? '', s.model ?? '', s.fault ?? '',
        s.service_type ?? 'Cambio pantalla', s.service_types ?? '', s.amount, s.payment_method ?? 'Divisas (USD Cash)',
        '', 'Entregado', s.observations ?? '', s.bank_fee_percent ?? 0,
        s.zelle_reference ?? '', s.currency ?? 'USD', s.client_ci ?? '',
        s.client_address ?? '', s.device_checklist ?? '', s.technician ?? '', s.technician_id ?? null
      );
    } finally {
      setDelivering(null);
      setConfirmDeliver(null);
      load();
    }
  };

  const totalAmount = services.reduce((a, s) => a + s.amount, 0);

  // Chips: equipos en taller por tipo de trabajo (Recibido → Por entregar, sin entregados/cancelados).
  // Un servicio con varios tipos cuenta en TODOS sus chips (pertenencia, no igualdad exacta).
  const enTaller = services.filter(s => ACTIVE_STATUSES.includes(s.status ?? ''));
  const typeCounts = SERVICE_TYPES
    .map(t => ({ type: t, count: enTaller.filter(s => parseServiceTypes(s).includes(t)).length }))
    .filter(x => x.count > 0);
  // Lista visible: la cargada por backend (búsqueda + estado) filtrada por tipo client-side
  const visibleServices = typeFilter ? services.filter(s => parseServiceTypes(s).includes(typeFilter)) : services;

  const statusBadgeVariant = (status: string | null) => {
    switch (status) {
      case 'Entregado': return 'default' as const;
      case 'Por entregar': return 'secondary' as const;
      case 'Cancelado / Devuelto': return 'destructive' as const;
      default: return 'outline' as const;
    }
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
          <Button variant="outline" onClick={() => setShowPrinterSettings(true)} title="Configurar impresora de tickets">
            <Printer className="size-4" /> Impresora
          </Button>
          <Button onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="size-4" /> Nuevo Servicio
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Equipos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{services.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pendientes</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-warning">{services.filter(s => s.status === 'Por entregar').length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Monto Total</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">${totalAmount.toFixed(2)}</div></CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente, cédula, modelo, orden..." className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" className="w-36" value={dateStart}
            onChange={e => { setDateStart(e.target.value); if (!e.target.value) setDateEnd(''); }}
            title="Recibidos desde" />
          <span className="text-xs text-muted-foreground">a</span>
          <Input type="date" className="w-36" value={dateEnd}
            min={dateStart || undefined}
            onChange={e => setDateEnd(e.target.value)}
            title="Recibidos hasta" />
          {(dateStart || dateEnd) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateStart(''); setDateEnd(''); }}>
              Limpiar
            </Button>
          )}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos los estados</SelectItem>
            {statuses.map(st => (
              <SelectItem key={st.id} value={st.name}>{st.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={typeFilter === '' ? 'default' : 'outline'} size="sm"
          onClick={() => setTypeFilter('')}>
          Todos <span className="ml-1 rounded-full bg-background/60 px-1.5 text-[11px] font-bold">{enTaller.length}</span>
        </Button>
        {typeCounts.map(tc => (
          <Button key={tc.type} variant={typeFilter === tc.type ? 'default' : 'outline'} size="sm"
            onClick={() => setTypeFilter(typeFilter === tc.type ? '' : tc.type)}>
            {tc.type} <span className="ml-1 rounded-full bg-background/60 px-1.5 text-[11px] font-bold">{tc.count}</span>
          </Button>
        ))}
      </div>

      {visibleServices.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {services.length === 0 ? 'Sin servicios registrados' : 'Sin servicios de este tipo de trabajo'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {visibleServices.map(s => {
            const balance = s.amount - s.paid_amount;
            const checklist = parseChecklist(s.device_checklist);
            const hasChecklist = Object.keys(checklist).length > 0;
            const entregado = s.status === 'Entregado';
            const porEntregar = s.status === 'Por entregar';
            const warr = entregado && s.date_out ? warrantyStatus(s.date_out) : 'sin';
            return (
              <Card key={s.id} className={cn(
                'overflow-hidden transition-shadow hover:shadow-md',
                entregado && 'border-emerald-500/40 bg-emerald-500/5',
                porEntregar && 'border-amber-500/40 bg-amber-500/5'
              )}>
                <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{s.order_num}</span>
                    {entregado && <CheckCircle2 className="size-4 text-emerald-500" />}
                    {porEntregar && <Clock className="size-4 text-amber-500" />}
                    <span className="text-[11px] text-muted-foreground">{s.date_in?.slice(0, 16) ?? '-'}</span>
                    {techById(s.technician_id) ? (
                      <span title={`${techById(s.technician_id)!.name} — técnico`}
                        className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', techById(s.technician_id)!.color)}>
                        {techById(s.technician_id)!.initials}
                      </span>
                    ) : s.technician ? (
                      <span title={`${s.technician} — técnico`}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[10px] font-bold text-white">
                        {initialsOf(s.technician)}
                      </span>
                    ) : null}
                  </div>
                  <Badge variant={statusBadgeVariant(s.status)} className={entregado ? 'bg-success' : undefined}>{s.status}</Badge>
                </CardHeader>
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
                        <span className="text-sm font-bold">${s.amount.toFixed(2)}</span>
                        {balance <= 0.005 ? (
                          <Badge variant="outline" className="text-success">Cancelado</Badge>
                        ) : (
                          <Badge variant="outline" className="text-danger">${balance.toFixed(2)} pendiente</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1 text-xs text-muted-foreground">
                        <span className="truncate">
                          {s.payment_method ?? '-'}
                          {isMovilOrZelle(s.payment_method) && s.zelle_reference && (
                            <span className="text-[11px] text-muted-foreground"> · ref ····{s.zelle_reference.slice(-4)}</span>
                          )}
                        </span>
                        {s.paid_amount > 0 && <span className="text-emerald-600 font-medium shrink-0">abonado ${s.paid_amount.toFixed(2)}</span>}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {parseServiceTypes(s).map(t => (
                          <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                        ))}
                        {warr === 'activa' && (
                          <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500/40 bg-emerald-500/10">
                            Garantía hasta {warrantyEnd(s.date_out)}
                          </Badge>
                        )}
                        {warr === 'vencida' && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Garantía vencida
                          </Badge>
                        )}
                        {s.date_out && (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="size-3" /> {s.date_out.slice(0, 10)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {ACTIVE_STATUSES.includes(s.status ?? '') && (
                          <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-500/50 hover:bg-emerald-500/10"
                            disabled={delivering?.id === s.id}
                            onClick={() => {
                              // Confirmar solo si el cliente no pagó la totalidad
                              if (s.amount - s.paid_amount > 0.005) setConfirmDeliver(s);
                              else deliver(s);
                            }}>
                            <CheckCircle2 className="size-3.5" /> {delivering?.id === s.id ? 'Entregando...' : 'Entregar'}
                          </Button>
                        )}
                        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={() => setPayFor(s)}>
                          <Banknote className="size-3.5" /> Pago / Abono
                        </Button>
                        {hasChecklist && (
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-emerald-600"
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
                        <Button variant="outline" size="sm" title="Imprimir factura"
                          onClick={() => setPrintFor(s)}>
                          <Printer className="size-3.5" /> Factura
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => { setEditing(s); setShowForm(true); }}>
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

      <PaymentDialog
        service={payFor}
        open={!!payFor}
        onOpenChange={(o) => { if (!o) setPayFor(null); }}
        dayOpen={dayOpen}
        onSaved={load}
      />

      <PrintReceiptDialog
        serviceId={printFor?.id ?? null}
        open={!!printFor}
        onOpenChange={(o) => { if (!o) setPrintFor(null); }}
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
  const [serviceTypes, setServiceTypes] = useState<string[]>(['Cambio pantalla']);
  const [otherFault, setOtherFault] = useState('');
  const [amount, setAmount] = useState(0);
  const [payment, setPayment] = useState('Divisas (USD Cash)');
  const [dateOut, setDateOut] = useState('');
  const [status, setStatus] = useState('Recibido');
  const [observations, setObservations] = useState('');
  const [checklist, setChecklist] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [bankFeePercent, setBankFeePercent] = useState(0);
  const [zelleReference, setZelleReference] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSuggestions, setModelSuggestions] = useState<PhoneModelEntry[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [clientOpen, setClientOpen] = useState(false);
  const [clientSugs, setClientSugs] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [ciSearch, setCiSearch] = useState('');
  const [ciLookup, setCiLookup] = useState<Client | null>(null);
  const [ciSearched, setCiSearched] = useState(false);
  const [clientHistory, setClientHistory] = useState<Service[]>([]);
  const [ciError, setCiError] = useState<string | null>(null);
  const modelPicked = useRef(false);
  const clientPicked = useRef(false);
  const amountTouched = useRef(false);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [svc, setSvc] = useState<Service | null>(service);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [techSel, setTechSel] = useState('');
  const [showTechDialog, setShowTechDialog] = useState(false);

  // Tipo PRIMARIO = el primero elegido (compatibilidad con service_type y auto-inventario)
  const serviceType = serviceTypes[0] ?? 'Cambio pantalla';
  // Lista maestra de modelos de teléfono: una fila por teléfono, deduplicada del catálogo
  const phoneModels = useMemo(() => buildPhoneModels(catalog), [catalog]);

  const isPos = payment.includes('Punto');
  const isZelle = payment.includes('Zelle');
  const isPagoMovil = payment.includes('Móvil') || payment.includes('Movil');

  const currentTech = technicians.find(t => t.id === Number(techSel));

  const loadTechnicians = async (revalidate = false) => {
    const list = await api.getTechnicians().catch(() => [] as Technician[]);
    setTechnicians(list);
    if (revalidate && techSel && !list.some(t => t.id === Number(techSel))) setTechSel('');
    // Al crear: prefill con el último técnico usado (queda la marca lista en segundos)
    if (!service) {
      const last = localStorage.getItem('last_technician');
      if (last && list.some(t => t.id === Number(last))) setTechSel(last);
    }
  };

  useEffect(() => {
    api.getProducts('', null).then(setCatalog);
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
      const parsedTypes = parseServiceTypes(service);
      const knownTypes = parsedTypes.filter(t => SERVICE_TYPES.includes(t));
      const customTypes = parsedTypes.filter(t => !SERVICE_TYPES.includes(t));
      setServiceTypes(knownTypes.length > 0 ? knownTypes : ['Cambio pantalla']);
      setOtherFault(customTypes.join(', '));
      setAmount(service.amount);
      amountTouched.current = true;
      setPayment(service.payment_method ?? 'Divisas (USD Cash)');
      setDateOut(service.date_out ?? '');
      setStatus(service.status ?? 'Por entregar');
      setObservations(service.observations ?? '');
      setChecklist(parseChecklist(service.device_checklist));
      setBankFeePercent(service.bank_fee_percent ?? 0);
      setZelleReference(service.zelle_reference ?? '');
      setCurrency(service.currency ?? 'USD');
      setClientId(service.client_id ?? null);
      setTechSel(service.technician_id ? String(service.technician_id) : '');
      api.getServicePayments(service.id).then(setPayments).catch(() => setPayments([]));
    } else {
      api.nextOrderNum().then(setOrderNum);
      setPayments([]);
      setClientId(null);
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

  useEffect(() => {
    const q = normPhoneModel(model);
    if (q.length >= 1 && phoneModels.length > 0) {
      // El teléfono se sugiere como MODELO INDIVIDUAL (una vez), no por pantalla/repuesto
      const filtered = phoneModels
        .filter(e => e.norm.includes(q) || e.products.some(p =>
          normPhoneModel([p.brand ?? '', p.model ?? '', p.name].join(' ')).includes(q)))
        .slice(0, 10);
      setModelSuggestions(filtered);
      setModelOpen(filtered.length > 0 && !modelPicked.current);
    } else {
      setModelSuggestions([]);
      setModelOpen(false);
    }
  }, [model, phoneModels]);

  const selectModel = (sugg: PhoneModelEntry) => {
    modelPicked.current = true;
    setModel(sugg.label);
    // Auto-precio SOLO si el teléfono matchea UN ÚNICO repuesto (o todos al mismo precio);
    // con varios repuestos de precios distintos NO se inventa el monto.
    const prices = new Set(sugg.products.map(p => p.price_sale));
    if (!amountTouched.current && prices.size === 1) setAmount([...prices][0]);
    setModelOpen(false);
  };

  // Normaliza una cédula para buscar: quita prefijo V-/E-, espacios y guiones
  const normCi = (s: string) => s.trim().replace(/^[VvEe]-?\s*/, '').replace(/\D/g, '');

  const lookupByCi = async () => {
    const q = normCi(ciSearch);
    if (!q) return;
    setCiError(null);
    try {
      const result = await api.findClientByCi(q);
      setCiLookup(result);
      setCiSearched(true);
    } catch (e) {
      setCiError(e instanceof Error ? e.message : String(e));
      setCiSearched(false);
      setCiLookup(null);
    }
  };

  const useCiClient = () => {
    if (!ciLookup) return;
    const c = ciLookup;
    setClient(c.name);
    setPhone(c.phone ?? '');
    setClientCi(c.ci ?? '');
    setClientAddress(c.address ?? '');
    if (clientId !== c.id) {
      setClientHistory([]);
      setClientId(c.id);
    }
    setCiSearched(false);
    setCiLookup(null);
  };

  const needCi = !service && !clientId;

  const save = async () => {
    if (!client || !model || !fault || serviceTypes.length === 0) return;
    setSaving(true);
    try {
      const checklistJson = JSON.stringify(checklist);
      // El texto de "Otro" se guarda como trabajo propio (badge propio en la orden)
      const typesArr = [...serviceTypes];
      if (serviceTypes.includes('Otro') && otherFault.trim()) typesArr.push(otherFault.trim());
      const serviceTypesJson = JSON.stringify(typesArr);
      let cid = clientId;
      if (client && !cid) {
        cid = await api.addOrFindClient(client, phone, clientCi, clientAddress);
      }
      const techName = currentTech?.name ?? '';
      const techId = currentTech?.id ?? null;
      if (techId) localStorage.setItem('last_technician', String(techId));
      if (service) {
        await api.updateService(service.id, client, phone, model, fault, serviceType, serviceTypesJson, amount, payment, dateOut, status, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, checklistJson, techName, techId);
      } else {
        await api.addService(orderNum, client, phone, model, fault, serviceType, serviceTypesJson, amount, payment, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, checklistJson, cid, techName, techId);
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

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? `Editar ${service.order_num}` : 'Nuevo Servicio Técnico'}</DialogTitle>
        </DialogHeader>
        {service?.status === 'Entregado' && service.date_out && warrantyStatus(service.date_out) === 'activa' && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            <ShieldCheck className="size-4 shrink-0" />
            <span>
              <strong>En garantía</strong> — vence el {warrantyEnd(service.date_out)}. Si es un reclamo, reábrelo (cambia el estado) y al entregarlo la garantía reinicia sus 7 días.
            </span>
          </div>
        )}
        {service?.status === 'Entregado' && service.date_out && warrantyStatus(service.date_out) === 'vencida' && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" />
            <span>Garantía vencida el {warrantyEnd(service.date_out)}</span>
          </div>
        )}
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Orden: <strong>{orderNum}</strong>
          </div>

          <SectionTitle step={1} title="Cliente" />
          {!service && (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-semibold">¿Cliente nuevo o existente?</p>
              <div className="flex gap-2">
                <Input value={ciSearch}
                  onChange={e => { setCiSearch(e.target.value); setCiSearched(false); setCiLookup(null); setCiError(null); }}
                  onKeyDown={e => e.key === 'Enter' && lookupByCi()}
                  placeholder="V-12345678" />
                <Button variant="outline" onClick={lookupByCi}>
                  <Search className="size-4" /> Buscar
                </Button>
              </div>
              {ciError && <p className="text-sm text-danger">{ciError}</p>}
              {ciSearched && ciLookup && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
                  <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> Cliente existente
                  </p>
                  <div className="text-sm">
                    <p className="font-medium">{ciLookup.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[ciLookup.phone, ciLookup.ci].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={useCiClient}>
                    Usar este cliente
                  </Button>
                </div>
              )}
              {ciSearched && !ciLookup && (
                <p className="text-sm bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-md px-3 py-2">
                  Cliente nuevo — completa sus datos abajo (la cédula es obligatoria)
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente *</label>
              <Input value={client} onChange={e => { clientPicked.current = false; setClient(e.target.value); setClientId(null); }}
                placeholder="Buscar o escribir nombre..." />
              {clientOpen && clientSugs.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {clientSugs.map(c => (
                    <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0 transition-colors"
                      onClick={() => selectClient(c)}>
                      <span className="font-medium">{c.name}</span>
                      {c.phone && <span className="text-muted-foreground text-xs ml-2">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Teléfono</label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0412-1234567" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cédula</label>
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

          {service && (
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
                  {saldoUsd > 0.005 ? (
                    <p className="font-bold text-danger">${saldoUsd.toFixed(2)} pendiente</p>
                  ) : saldoUsd < -0.005 ? (
                    <p className="font-bold text-warning">Excedente ${excedenteUsd.toFixed(2)}</p>
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
                          {currencySymbol(p.currency)}{p.amount.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.payment_method ?? '-'}
                          {isMovilOrZelle(p.payment_method) && p.zelle_reference && (
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
          )}

          <SectionTitle step={2} title="Equipo y diagnóstico" />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Modelo *</label>
              <Input value={model} onChange={e => { modelPicked.current = false; setModel(e.target.value); }}
                placeholder="Buscar el modelo del teléfono (ej: Spark 10 Pro)..." />
              {modelOpen && modelSuggestions.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                  {modelSuggestions.map(sugg => (
                    <button key={sugg.norm} className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent border-b last:border-0 transition-colors"
                      onClick={() => selectModel(sugg)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{sugg.label}</span>
                        <span className="text-muted-foreground text-xs shrink-0">
                          {sugg.products.length} repuesto{sugg.products.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      {sugg.products.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {sugg.products.slice(0, 8).map(p => (
                            <span key={p.id} className={cn(
                              'text-[11px] px-1.5 py-0.5 rounded-md',
                              p.stock <= 0 ? 'bg-danger/10 text-danger' : 'bg-muted text-muted-foreground'
                            )}>
                              {partLabel(p)} · {p.stock <= 0 ? 'agotado' : `stock ${p.stock}`}
                            </span>
                          ))}
                          {sugg.products.length > 8 && (
                            <span className="text-[11px] text-muted-foreground">+{sugg.products.length - 8}</span>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Monto ($)</label>
              <Input type="number" step={0.01} min={0} value={amount}
                onChange={e => { amountTouched.current = true; setAmount(Number(e.target.value)); }} />
            </div>
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
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Falla / Trabajo realizado *</label>
            <Textarea value={fault} onChange={e => setFault(e.target.value)}
              placeholder="Ej: Pantalla rota, se cambió por Incell nueva. Teléfono no enciende, se reemplazó batería..." />
          </div>

          <SectionTitle step={3} title="Blindaje del equipo" />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Marca Sí/No el estado real al recibir el equipo. Protege al taller si el cliente reclama algo que ya estaba así.
              </p>
              <Button type="button" size="sm" variant="outline" className="shrink-0"
                onClick={() => setChecklist(Object.fromEntries(CHECKLIST_ITEMS.map(i => [i.key, 'si'])))}
                disabled={CHECKLIST_ITEMS.every(i => checklist[i.key] === 'si')}>
                Marcar todo Sí
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {CHECKLIST_ITEMS.map(item => {
                const val = checklist[item.key] ?? '';
                return (
                  <div key={item.key} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-1.5">
                    <span className="text-sm">{item.label}</span>
                    <ToggleGroup type="single" size="sm" value={val}
                      onValueChange={v => setChecklist(prev => ({ ...prev, [item.key]: v }))}
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
          </div>

          <SectionTitle step={4} title="Finanzas y estado" />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Método de Pago</label>
              <Select value={payment} onValueChange={v => {
                setPayment(v);
                if (v.includes('Punto')) setBankFeePercent(3.5);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {methods.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {service && (
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
            )}
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

          {service && (
            <>
              <SectionTitle step={5} title="Cierre de la orden" />
              <div className="space-y-2">
                <label className="text-sm font-medium">Fecha Salida</label>
                <Input type="date" value={dateOut} onChange={e => setDateOut(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Observaciones</label>
                <Textarea value={observations} onChange={e => setObservations(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || dayOpen === false || !client || !model || !fault || (needCi && !clientCi.trim())}>
            {saving ? 'Guardando...' : (service ? 'Actualizar Servicio' : 'Guardar Servicio')}
          </Button>
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
