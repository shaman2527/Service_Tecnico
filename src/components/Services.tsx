import { useEffect, useState } from 'react';
import { Plus, Search, ShieldCheck, Trash2, Lock, CheckCircle2, Banknote } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { Service, ServicePayment, ServiceStatus, Product } from '../types';

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
  useEffect(() => { load(); }, [search, statusFilter]);

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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orden</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Cédula</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Falla</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Abono</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Salida</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                    Sin servicios registrados
                  </TableCell>
                </TableRow>
              ) : (
                services.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-bold">{s.order_num}</TableCell>
                    <TableCell>{s.date_in ?? '-'}</TableCell>
                    <TableCell className="font-medium">{s.client ?? '-'}</TableCell>
                    <TableCell>{s.phone ?? '-'}</TableCell>
                    <TableCell>{s.client_ci ?? '-'}</TableCell>
                    <TableCell className="font-medium">{s.model ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{s.service_type ?? '-'}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate" title={s.fault ?? ''}>{s.fault ?? '-'}</TableCell>
                    <TableCell className="text-right font-bold">${s.amount.toFixed(2)}</TableCell>
                    <TableCell>
                      {s.paid_amount > 0 ? (
                        <span className="text-xs">
                          <span className="text-muted-foreground">abon. </span>
                          <span className="font-medium text-emerald-600">${s.paid_amount.toFixed(2)}</span>
                          {s.amount - s.paid_amount > 0.005 && (
                            <span className="block text-danger font-medium">${(s.amount - s.paid_amount).toFixed(2)} pend.</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="outline">{s.payment_method ?? '-'}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(s.status)}>{s.status}</Badge>
                    </TableCell>
                    <TableCell>{s.date_out ?? '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 items-center">
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-muted-foreground"
                                onClick={() => { setEditing(s); setShowForm(true); }}>
                                <ShieldCheck className={parseChecklist(s.device_checklist) && Object.keys(parseChecklist(s.device_checklist)).length > 0 ? "size-4 text-emerald-600" : "size-4"} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs space-y-1">
                                <div className="font-medium">{checklistSummary(s.device_checklist)}</div>
                                {Object.entries(parseChecklist(s.device_checklist)).map(([k, v]) => {
                                  const item = CHECKLIST_ITEMS.find(i => i.key === k);
                                  if (!item || !v) return null;
                                  return (
                                    <div key={k}>{item.label}: {v === 'si' ? 'Sí' : 'No'}</div>
                                  );
                                })}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <Button variant="outline" size="sm" onClick={() => { setEditing(s); setShowForm(true); }}>
                          Editar
                        </Button>
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-danger"
                          onClick={() => setDeleting(s)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
  const [status, setStatus] = useState('Por entregar');
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
  const [clientSugs, setClientSugs] = useState<{ id: number; name: string; phone: string | null }[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('Divisas (USD Cash)');
  const [payFee, setPayFee] = useState(0);
  const [payZelle, setPayZelle] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [savingPay, setSavingPay] = useState(false);

  const isPos = payment.includes('Punto');
  const isZelle = payment.includes('Zelle');

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
        setClientOpen(true);
      });
    } else {
      setClientSugs([]);
      setClientOpen(false);
    }
  }, [client]);

  const selectClient = (c: { id: number; name: string; phone: string | null }) => {
    setClient(c.name);
    setClientId(c.id);
    if (c.phone && !phone) setPhone(c.phone);
    setClientOpen(false);
    api.suggestClients(c.name, 1).then(sugs => {
      if (sugs.length > 0) {
        const full = sugs[0];
        if (full.phone && !phone) setPhone(full.phone);
      }
    });
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
      setModelOpen(filtered.length > 0);
    } else {
      setModelSuggestions([]);
      setModelOpen(false);
    }
  }, [model, catalog]);

  const selectModel = (sugg: { model: string; product: Product }) => {
    setModel(sugg.model);
    setAmount(sugg.product.price_sale);
    setModelOpen(false);
  };

  const save = async () => {
    if (!client || !model || !fault) return;
    setSaving(true);
    try {
      const checklistJson = JSON.stringify(checklist);
      let cid = clientId;
      if (client && !cid) {
        cid = await api.addOrFindClient(client, phone);
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

  const balance = amount - (payments.reduce((a, p) => a + p.amount, 0));

  const openPayDialog = () => {
    setPayAmount(balance > 0 ? Math.min(balance, amount) : amount);
    setPayMethod(payment);
    setPayFee(payment.includes('Punto') ? 3.5 : 0);
    setPayZelle('');
    setPayNotes('');
    setPayError(null);
    setShowPayDialog(true);
  };

  const doAddPayment = async () => {
    if (!service || payAmount <= 0) return;
    setSavingPay(true);
    setPayError(null);
    try {
      await api.addServicePayment(service.id, payAmount, payMethod, payFee, payZelle, currency, payNotes);
      setShowPayDialog(false);
      const [p] = await Promise.all([api.getServicePayments(service.id)]);
      setPayments(p);
      onSaved();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPay(false);
    }
  };

  const doDeletePayment = async (pid: number) => {
    await api.deleteServicePayment(pid);
    setPayments(await api.getServicePayments(service!.id));
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente *</label>
              <Input value={client} onChange={e => { setClient(e.target.value); setClientId(null); }}
                onFocus={() => client.trim().length > 0 && setClientOpen(true)}
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
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Dirección</label>
              <Input value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

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
                  <p className="font-bold text-emerald-600">${(amount - balance).toFixed(2)}</p>
                </div>
                <div className="rounded-md px-3 py-2 border">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Saldo</p>
                  <p className={`font-bold ${balance <= 0.005 ? 'text-success' : 'text-danger'}`}>
                    {balance <= 0.005 ? 'Cancelado' : `$${balance.toFixed(2)} pendiente`}
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
                          {p.currency === 'VES' ? 'Bs.' : '$'}{p.amount.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs">{p.payment_method ?? '-'}</TableCell>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Modelo *</label>
              <Input value={model} onChange={e => setModel(e.target.value)}
                onFocus={() => catalog.length > 0 && model.length >= 1 && setModelOpen(true)}
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Estado del equipo al recibir (blindaje)</label>
            <p className="text-xs text-muted-foreground">
              Marca Sí/No el estado real al recibir el equipo. Protege al taller si el cliente reclama algo que ya estaba así.
            </p>
            <div className="flex flex-col gap-1.5">
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

          {isZelle && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Referencia Zelle</label>
              <Input value={zelleReference} onChange={e => setZelleReference(e.target.value)}
                placeholder="Número de referencia..." />
            </div>
          )}

          {service && (
            <>
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
          <Button onClick={save} disabled={saving || dayOpen === false || !client || !model || !fault}>
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
              <p>Saldo pendiente: <strong className={balance <= 0.005 ? 'text-success' : 'text-danger'}>${Math.max(balance, 0).toFixed(2)}</strong></p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Monto ($)</label>
              <Input type="number" step={0.01} min={0.01} value={payAmount}
                onChange={e => setPayAmount(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Método de Pago</label>
              <Select value={payMethod} onValueChange={v => {
                setPayMethod(v);
                if (v.includes('Punto')) setPayFee(3.5);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {methods.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {payMethod.includes('Punto') && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Comisión Punto (%)</label>
                <Input type="number" step={0.1} min={0} max={100} value={payFee}
                  onChange={e => setPayFee(Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">
                  Comisión: ${((payAmount * payFee) / 100).toFixed(2)} · Neto: ${(payAmount - (payAmount * payFee) / 100).toFixed(2)}
                </p>
              </div>
            )}
            {payMethod.includes('Zelle') && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Referencia Zelle</label>
                <Input value={payZelle} onChange={e => setPayZelle(e.target.value)}
                  placeholder="Número de referencia..." />
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
