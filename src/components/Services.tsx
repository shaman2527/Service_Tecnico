import { useEffect, useRef, useState } from 'react';
import { Plus, Search, ShieldCheck, Trash2, Lock, CheckCircle2, Banknote, User, Smartphone, CalendarDays, Wrench } from 'lucide-react';
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
import { cn, methodCurrency, currencySymbol } from '@/lib/utils';
import type { Service, ServicePayment, ServiceStatus, Product, Client } from '../types';

const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: 'chip_sim', label: 'Chip (SIM) presente' },
  { key: 'tapa_trasera', label: 'Tapa trasera en buen estado' },
  { key: 'bandeja_sim', label: 'Bandeja SIM presente' },
  { key: 'botones', label: 'Botones (volumen/encendido) funcionan' },
  { key: 'boton_home', label: 'Botón home/navegación (si aplica)' },
  { key: 'camara', label: 'Cámara (lente) sin daños' },
  { key: 'puerto_carga', label: 'Puerto de carga funciona' },
  { key: 'parlante', label: 'Parlante/micrófono funcionan' },
  { key: 'contrasena', label: 'Contraseña/patrón entregada por el cliente' },
  { key: 'accesorios', label: 'Accesorios entregados (funda, protector)' },
];

function isMovilOrZelle(m: string | null | undefined): boolean {
  return !!m && (m.includes('Móvil') || m.includes('Movil') || m.includes('Zelle'));
}

export function parseChecklist(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function checklistSummary(json: string | null | undefined): string {
  const parsed = parseChecklist(json);
  const total = Object.keys(parsed).length;
  if (total === 0) return 'Sin revisión registrada';
  return `${total} de ${CHECKLIST_ITEMS.length} ítems revisados`;
}

function SectionTitle({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">{step}</span>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}

export default function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [dayOpen, setDayOpen] = useState<boolean | null>(null);

  const load = async () => {
    const [s, st] = await Promise.all([
      api.getServices(search, statusFilter),
      api.getServiceStatuses(),
    ]);
    setServices(s);
    setStatuses(st);
  };

  useEffect(() => { load(); }, []);
  // Debounce: la búsqueda solo consulta tras 350ms de inactividad
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [search, statusFilter]);

  useEffect(() => {
    api.getActiveDay().then(d => setDayOpen(!!d)).catch(() => setDayOpen(true));
  }, []);

  const handleDelete = async (s: Service) => {
    await api.deleteService(s.id);
    setDeleting(null);
    load();
  };

  const totalAmount = services.reduce((a, s) => a + s.amount, 0);

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

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente, modelo, orden..." className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
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

      {services.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Sin servicios registrados
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {services.map(s => {
            const balance = s.amount - s.paid_amount;
            const checklist = parseChecklist(s.device_checklist);
            const hasChecklist = Object.keys(checklist).length > 0;
            return (
              <Card key={s.id} className="overflow-hidden transition-shadow hover:shadow-md">
                <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{s.order_num}</span>
                    <span className="text-[11px] text-muted-foreground">{s.date_in?.slice(0, 16) ?? '-'}</span>
                  </div>
                  <Badge variant={statusBadgeVariant(s.status)}>{s.status}</Badge>
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
                        {s.service_type && <Badge variant="outline" className="text-xs">{s.service_type}</Badge>}
                        {s.date_out && (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="size-3" /> {s.date_out.slice(0, 10)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
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
  const [serviceType, setServiceType] = useState('Cambio pantalla');
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
  const [modelSuggestions, setModelSuggestions] = useState<{ model: string; product: Product }[]>([]);
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
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('Divisas (USD Cash)');
  const [payCurrency, setPayCurrency] = useState<'USD' | 'VES'>('USD');
  const [payFee, setPayFee] = useState(0);
  const [payZelle, setPayZelle] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [savingPay, setSavingPay] = useState(false);
  const [tasaBcv, setTasaBcv] = useState(0);
  const [svc, setSvc] = useState<Service | null>(service);

  const isPos = payment.includes('Punto');
  const isZelle = payment.includes('Zelle');
  const isPagoMovil = payment.includes('Móvil') || payment.includes('Movil');
  const payIsPagoMovil = payMethod.includes('Móvil') || payMethod.includes('Movil');
  const payIsBs = payCurrency === 'VES';

  useEffect(() => {
    api.getProducts('', null).then(setCatalog);
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
      setServiceType(service.service_type ?? 'Cambio pantalla');
      setAmount(service.amount);
      setPayment(service.payment_method ?? 'Divisas (USD Cash)');
      setDateOut(service.date_out ?? '');
      setStatus(service.status ?? 'Por entregar');
      setObservations(service.observations ?? '');
      setChecklist(parseChecklist(service.device_checklist));
      setBankFeePercent(service.bank_fee_percent ?? 0);
      setZelleReference(service.zelle_reference ?? '');
      setCurrency(service.currency ?? 'USD');
      setClientId(service.client_id ?? null);
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
      api.getClientServices(clientId).then(setClientHistory).catch(() => setClientHistory([]));
    }
  }, [clientId]);

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
    const q = model.trim().toLowerCase();
    if (q.length >= 1 && catalog.length > 0) {
      const seen = new Set<string>();
      const filtered: { model: string; product: Product }[] = [];
      for (const p of catalog) {
        const compat = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
        const models = compat.length > 0
          ? compat.map((m: string) => m.trim()).filter(Boolean)
          : [p.name.replace(/^Pantalla\s+/i, '').split('/')[0].trim()];
        for (const m of models) {
          const hay = [m, p.brand ?? '', p.model ?? '', p.name].join(' ').toLowerCase();
          if (hay.includes(q) && !seen.has(m)) {
            seen.add(m);
            filtered.push({ model: m, product: p });
          }
        }
        if (filtered.length >= 12) break;
      }
      setModelSuggestions(filtered);
      setModelOpen(filtered.length > 0 && !modelPicked.current);
    } else {
      setModelSuggestions([]);
      setModelOpen(false);
    }
  }, [model, catalog]);

  const selectModel = (sugg: { model: string; product: Product }) => {
    modelPicked.current = true;
    setModel(sugg.model);
    setAmount(sugg.product.price_sale);
    setModelOpen(false);
  };

  const lookupByCi = async () => {
    const q = ciSearch.trim();
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
    if (!client || !model || !fault) return;
    setSaving(true);
    try {
      const checklistJson = JSON.stringify(checklist);
      let cid = clientId;
      if (client && !cid) {
        cid = await api.addOrFindClient(client, phone, clientCi, clientAddress);
      }
      if (service) {
        await api.updateService(service.id, client, phone, model, fault, serviceType, amount, payment, dateOut, status, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, checklistJson);
      } else {
        await api.addService(orderNum, client, phone, model, fault, serviceType, amount, payment, observations, bankFeePercent, zelleReference, currency, clientCi, clientAddress, checklistJson, cid);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  // Abonado total del servicio en $ (el backend convierte pagos en Bs con la tasa del día del pago)
  const abonadoUsd = svc?.paid_amount ?? 0;
  const saldoUsd = Math.max(0, amount - abonadoUsd);
  const totalAbonadoBs = payments.reduce((a, p) => a + (p.currency === 'VES' ? p.amount : 0), 0);

  useEffect(() => {
    if (!svc) return;
    let alive = true;
    api.getActiveDay().then(d => {
      if (alive) setTasaBcv(d?.tasa_bcv ?? 0);
    }).catch(() => {});
    return () => { alive = false; };
  }, [svc?.id]);

  const openPayDialog = () => {
    setPayMethod(payment);
    setPayCurrency(methodCurrency(payment));
    setPayFee(payment.includes('Punto') ? 3.5 : 0);
    setPayZelle('');
    setPayNotes('');
    setPayError(null);
    setPayAmount(saldoUsd > 0 ? Math.min(saldoUsd, amount) : amount);
    setShowPayDialog(true);
  };

  const doAddPayment = async () => {
    if (!service || payAmount <= 0) return;
    setSavingPay(true);
    setPayError(null);
    try {
      await api.addServicePayment(service.id, payAmount, payMethod, payFee, payZelle, payCurrency, payNotes);
      setShowPayDialog(false);
      const p = await api.getServicePayments(service.id);
      setPayments(p);
      const s = await api.getService(service.id).catch(() => service);
      setSvc(s);
      onSaved();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPay(false);
    }
  };

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
                        {h.service_type && <Badge variant="outline" className="text-[11px] shrink-0">{h.service_type}</Badge>}
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
                <Button variant="outline" size="sm" onClick={openPayDialog} disabled={dayOpen === false}>
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
                  <p className={`font-bold ${saldoUsd <= 0.005 ? 'text-success' : 'text-danger'}`}>
                    {saldoUsd <= 0.005 ? 'Cancelado' : `$${saldoUsd.toFixed(2)} pendiente`}
                  </p>
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
                placeholder="Buscar modelo de equipo o pantalla..." />
              {modelOpen && modelSuggestions.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                  {modelSuggestions.map(sugg => {
                    const p = sugg.product;
                    const compatList = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
                    const outOfStock = p.stock <= 0;
                    return (
                      <button key={sugg.model} className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent border-b last:border-0 transition-colors"
                        onClick={() => selectModel(sugg)}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{sugg.model}</span>
                          <span className={outOfStock ? 'text-danger font-semibold text-xs shrink-0' : 'text-muted-foreground text-xs shrink-0'}>
                            ${p.price_sale.toFixed(2)} · Stock: {p.stock}
                          </span>
                        </div>
                        {p.brand && <span className="text-muted-foreground text-xs">{p.brand}</span>}
                        {compatList.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {compatList.map(m => (
                              <span key={m} className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Monto ($)</label>
              <Input type="number" step={0.01} min={0} value={amount}
                onChange={e => setAmount(Number(e.target.value))} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Tipo de Servicio</label>
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cambio pantalla">Cambio pantalla</SelectItem>
                <SelectItem value="Cambio batería">Cambio batería</SelectItem>
                <SelectItem value="Cambio flex">Cambio flex</SelectItem>
                <SelectItem value="Cambio conector / puerto">Cambio conector / puerto</SelectItem>
                <SelectItem value="Reparación (placa)">Reparación (placa)</SelectItem>
                <SelectItem value="Limpieza / Mantenimiento">Limpieza / Mantenimiento</SelectItem>
                <SelectItem value="Software / Formateo">Software / Formateo</SelectItem>
                <SelectItem value="Cambio cámara">Cambio cámara</SelectItem>
                <SelectItem value="Cambio parlante / micrófono">Cambio parlante / micrófono</SelectItem>
                <SelectItem value="Otro">Otro</SelectItem>
              </SelectContent>
            </Select>
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
                if (v.includes('Zelle')) setCurrency('USD');
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
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD $</SelectItem>
                    <SelectItem value="VES">Bs.</SelectItem>
                  </SelectContent>
                </Select>
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

      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Pago / Abono</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm space-y-1 rounded-md bg-muted/60 px-3 py-2">
              <p>Total: <strong>${amount.toFixed(2)}</strong></p>
              <p>Saldo pendiente: <strong className={saldoUsd <= 0.005 ? 'text-success' : 'text-danger'}>${saldoUsd.toFixed(2)}</strong></p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{payIsBs ? 'Monto (Bs.)' : 'Monto ($)'}</label>
              <Input type="number" step={payIsBs ? 1 : 0.01} min={0.01} value={payAmount}
                onChange={e => setPayAmount(Number(e.target.value))} />
              {payIsBs && tasaBcv > 0 && payAmount > 0 && (
                <p className="text-xs text-muted-foreground">
                  ≈ ${(payAmount / tasaBcv).toFixed(2)} (tasa BCV {tasaBcv.toFixed(2)})
                </p>
              )}
              {!payIsBs && payAmount > 0 && tasaBcv > 0 && (
                <p className="text-xs text-muted-foreground">
                  ≈ Bs. {(payAmount * tasaBcv).toFixed(2)} (tasa BCV {tasaBcv.toFixed(2)})
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Método de Pago</label>
              <Select value={payMethod} onValueChange={v => {
                setPayMethod(v);
                setPayCurrency(methodCurrency(v));
                if (v.includes('Punto')) setPayFee(3.5);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {methods.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {payIsBs && (
                <p className="text-xs text-amber-600">
                  Este método es en bolívares: el abono se registra en Bs. y se convierte a $ con la tasa BCV del día al calcular el saldo.
                </p>
              )}
            </div>
            {payMethod.includes('Punto') && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Comisión Punto (%)</label>
                <Input type="number" step={0.1} min={0} max={100} value={payFee}
                  onChange={e => setPayFee(Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">
                  Comisión: {currencySymbol(payCurrency)}{((payAmount * payFee) / 100).toFixed(2)} · Neto: {currencySymbol(payCurrency)}{(payAmount - (payAmount * payFee) / 100).toFixed(2)}
                </p>
              </div>
            )}
            {(payMethod.includes('Zelle') || payIsPagoMovil) && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Referencia</label>
                <Input value={payZelle} onChange={e => setPayZelle(e.target.value)}
                  placeholder="Número de referencia (últimos 4 dígitos)..." />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Notas (opcional)</label>
              <Input value={payNotes} onChange={e => setPayNotes(e.target.value)}
                placeholder="Ej: Abono inicial / Saldo al entregar..." />
            </div>
            {payError && <p className="text-sm text-danger">{payError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)}>Cancelar</Button>
            <Button onClick={doAddPayment} disabled={savingPay || payAmount <= 0 || dayOpen === false}>
              {savingPay ? 'Guardando...' : 'Guardar Pago'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
