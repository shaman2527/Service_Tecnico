import { useEffect, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api } from '../db';
import type { Service, ServiceStatus, Product } from '../types';

export default function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);

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
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="size-4" /> Nuevo Servicio
        </Button>
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
                <TableHead>Modelo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Falla</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Salida</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
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
                    <TableCell>{s.model ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{s.service_type ?? '-'}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate" title={s.fault ?? ''}>{s.fault ?? '-'}</TableCell>
                    <TableCell className="text-right font-bold">${s.amount.toFixed(2)}</TableCell>
                    <TableCell><Badge variant="outline">{s.payment_method ?? '-'}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(s.status)}>{s.status}</Badge>
                    </TableCell>
                    <TableCell>{s.date_out ?? '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
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

function ServiceForm({ service, statuses, onClose, onSaved }: {
  service: Service | null;
  statuses: ServiceStatus[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [orderNum, setOrderNum] = useState('');
  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [model, setModel] = useState('');
  const [fault, setFault] = useState('');
  const [serviceType, setServiceType] = useState('Cambio pantalla');
  const [amount, setAmount] = useState(0);
  const [payment, setPayment] = useState('Divisas (USD Cash)');
  const [dateOut, setDateOut] = useState('');
  const [status, setStatus] = useState('Por entregar');
  const [observations, setObservations] = useState('');
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [bankFeePercent, setBankFeePercent] = useState(0);
  const [zelleReference, setZelleReference] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSuggestions, setModelSuggestions] = useState<Product[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);

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
      setModel(service.model ?? '');
      setFault(service.fault ?? '');
      setServiceType(service.service_type ?? 'Cambio pantalla');
      setAmount(service.amount);
      setPayment(service.payment_method ?? 'Divisas (USD Cash)');
      setDateOut(service.date_out ?? '');
      setStatus(service.status ?? 'Por entregar');
      setObservations(service.observations ?? '');
      setBankFeePercent(service.bank_fee_percent ?? 0);
      setZelleReference(service.zelle_reference ?? '');
      setCurrency(service.currency ?? 'USD');
    } else {
      api.nextOrderNum().then(setOrderNum);
    }
  }, [service]);

  useEffect(() => {
    const q = model.trim().toLowerCase();
    if (q.length >= 1 && catalog.length > 0) {
      const filtered = catalog
        .filter(p => {
          const compat = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
          const hay = [p.name, p.brand ?? '', p.model ?? '', ...compat].join(' ').toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 12);
      setModelSuggestions(filtered);
      setModelOpen(filtered.length > 0);
    } else {
      setModelSuggestions([]);
      setModelOpen(false);
    }
  }, [model, catalog]);

  const selectModel = (p: Product) => {
    setModel(p.name.replace(/^Pantalla\s+/i, '').split('/')[0].trim());
    setAmount(p.price_sale);
    setModelOpen(false);
  };

  const save = async () => {
    if (!client || !model || !fault) return;
    setSaving(true);
    try {
      if (service) {
        await api.updateService(service.id, client, phone, model, fault, serviceType, amount, payment, dateOut, status, observations, bankFeePercent, zelleReference, currency);
      } else {
        await api.addService(orderNum, client, phone, model, fault, serviceType, amount, payment, observations, bankFeePercent, zelleReference, currency);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
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
              <Input value={client} onChange={e => setClient(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Teléfono</label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Modelo *</label>
              <Input value={model} onChange={e => setModel(e.target.value)}
                onFocus={() => catalog.length > 0 && model.length >= 1 && setModelOpen(true)}
                placeholder="Buscar modelo de equipo o pantalla..." />
              {modelOpen && modelSuggestions.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                  {modelSuggestions.map(p => {
                    const compatList = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
                    return (
                      <button key={p.id} className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent border-b last:border-0 transition-colors"
                        onClick={() => selectModel(p)}>
                        <span className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</span>
                        {p.brand && <span className="text-muted-foreground ml-1.5 text-xs">{p.brand}</span>}
                        {p.price_sale > 0 && <span className="float-right text-muted-foreground text-xs">${p.price_sale.toFixed(2)}</span>}
                        {compatList.length > 0 && (
                          <div className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                            {compatList.join(' · ')}
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
          <Button onClick={save} disabled={saving}>
            {saving ? 'Guardando...' : (service ? 'Actualizar Servicio' : 'Guardar Servicio')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
