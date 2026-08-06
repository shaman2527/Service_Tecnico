import { useEffect, useState } from 'react';
import { Search, Phone, Wrench, ShoppingCart, ChevronDown, ChevronRight, Smartphone, ShieldCheck, CalendarDays, FileText, User, Wallet, CircleDollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import { currencySymbol, warrantyEnd, warrantyStatus, parseChecklist, checklistSummary, CHECKLIST_ITEMS, parseServiceTypes, initialsOf } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { ClientSummary, Service, Sale, ServicePayment, Technician } from '../types';

export default function Clients() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ClientSummary | null>(null);
  const [clientServices, setClientServices] = useState<Service[]>([]);
  const [clientSales, setClientSales] = useState<Sale[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [servicePayments, setServicePayments] = useState<Record<number, ServicePayment[]>>({});
  const [technicians, setTechnicians] = useState<Technician[]>([]);

  const load = async () => {
    setClients(await api.getClients(search));
    api.getTechnicians().then(setTechnicians).catch(() => {});
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [search]);

  const openHistory = async (c: ClientSummary) => {
    setSelected(c);
    setExpandedId(null);
    setServicePayments({});
    const [services, sales] = await Promise.all([
      api.getClientServices(c.id),
      api.getClientSales(c.id),
    ]);
    setClientServices(services);
    setClientSales(sales);
  };

  const toggleExpand = async (s: Service) => {
    if (expandedId === s.id) { setExpandedId(null); return; }
    setExpandedId(s.id);
    if (!servicePayments[s.id]) {
      const pays = await api.getServicePayments(s.id).catch(() => [] as ServicePayment[]);
      setServicePayments(prev => ({ ...prev, [s.id]: pays }));
    }
  };

  const pendienteTotal = clientServices.reduce((a, s) => a + Math.max(0, (s.amount ?? 0) - (s.paid_amount ?? 0)), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground mt-1">Historial de clientes y seguimiento</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input placeholder="Buscar por nombre, teléfono o cédula..." className="pl-9"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Cédula</TableHead>
                <TableHead className="text-right">Servicios</TableHead>
                <TableHead className="text-right">Compras</TableHead>
                <TableHead className="text-right">Total Gastado</TableHead>
                <TableHead>Última Actividad</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    {search ? 'No se encontraron clientes' : 'No hay clientes registrados'}
                  </TableCell>
                </TableRow>
              ) : (
                clients.map(c => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openHistory(c)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.phone ?? '-'}</TableCell>
                    <TableCell>{c.ci ?? '-'}</TableCell>
                    <TableCell className="text-right">{c.service_count}</TableCell>
                    <TableCell className="text-right">{c.sale_count}</TableCell>
                    <TableCell className="text-right font-bold">${c.total_spent.toFixed(2)}</TableCell>
                    <TableCell>{c.last_date ?? '-'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openHistory(c); }}>
                        Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          {selected && (
            <>
              <DialogHeader className="shrink-0">
                <DialogTitle className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <User className="size-5" />
                  </span>
                  <span className="flex flex-col gap-1.5 text-left">
                    <span className="text-lg font-semibold leading-tight">{selected.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {selected.ci && (
                        <Badge variant="outline" className="text-[11px] font-normal gap-1">
                          <FileText className="size-3" /> {selected.ci}
                        </Badge>
                      )}
                      {selected.phone && (
                        <Badge variant="outline" className="text-[11px] font-normal gap-1">
                          <Phone className="size-3" /> {selected.phone}
                        </Badge>
                      )}
                      {selected.last_date && (
                        <Badge variant="secondary" className="text-[11px] font-normal gap-1">
                          <CalendarDays className="size-3" /> Última actividad {selected.last_date}
                        </Badge>
                      )}
                    </span>
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col gap-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border bg-background px-3 py-2.5 flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                      <Wallet className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Gastado</p>
                      <p className="text-lg font-bold tabular-nums leading-tight">${selected.total_spent.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2.5 flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Wrench className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Servicios</p>
                      <p className="text-lg font-bold tabular-nums leading-tight">{selected.service_count}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2.5 flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                      <ShoppingCart className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Compras</p>
                      <p className="text-lg font-bold tabular-nums leading-tight">{selected.sale_count}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2.5 flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                      <CircleDollarSign className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Por cobrar</p>
                      <p className="text-lg font-bold tabular-nums leading-tight">
                        {pendienteTotal > 0.005 ? `$${pendienteTotal.toFixed(2)}` : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {clientServices.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Wrench className="size-3.5" />
                        </span>
                        Servicios Técnicos
                        <Badge variant="secondary" className="text-[11px] tabular-nums">{clientServices.length}</Badge>
                      </h3>
                      {pendienteTotal > 0.005 && (
                        <Badge className="bg-danger/10 text-danger border-danger/30 gap-1">
                          <CircleDollarSign className="size-3" /> ${pendienteTotal.toFixed(2)} por cobrar
                        </Badge>
                      )}
                    </div>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>Orden</TableHead>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Modelo</TableHead>
                          <TableHead>Falla</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead className="text-right">Abonado</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clientServices.map(s => (
                          <ServiceRow key={s.id} s={s}
                            expanded={expandedId === s.id}
                            payments={servicePayments[s.id] ?? null}
                            techs={technicians}
                            onToggle={() => toggleExpand(s)} />
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                  </div>
                )}

                {clientSales.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
                        <ShoppingCart className="size-3.5" />
                      </span>
                      Compras
                      <Badge variant="secondary" className="text-[11px] tabular-nums">{clientSales.length}</Badge>
                    </h3>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Producto</TableHead>
                          <TableHead className="text-right">Cant</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Pago</TableHead>
                          <TableHead>Cliente</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clientSales.map(s => (
                          <TableRow key={s.id}>
                            <TableCell>{s.date ?? '-'}</TableCell>
                            <TableCell className="font-medium">{s.product_name ?? '-'}</TableCell>
                            <TableCell className="text-right">{s.quantity}</TableCell>
                            <TableCell className="text-right">${s.total.toFixed(2)}</TableCell>
                            <TableCell><Badge variant="outline">{s.payment_method ?? '-'}</Badge></TableCell>
                            <TableCell>
                              {s.client_name ?? '-'}
                              {s.client_ci && <div className="text-[11px] text-muted-foreground">{s.client_ci}</div>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                  </div>
                )}

                {clientServices.length === 0 && clientSales.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground">
                    <Search className="size-6" />
                    <p className="text-sm">Sin actividad registrada para este cliente</p>
                  </div>
                )}
              </div>

              <DialogFooter className="shrink-0 border-t pt-3">
                <Button onClick={() => setSelected(null)}>Cerrar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServiceRow({ s, expanded, payments, techs, onToggle }: {
  s: Service;
  expanded: boolean;
  payments: ServicePayment[] | null;
  techs: Technician[];
  onToggle: () => void;
}) {
  const wStatus = warrantyStatus(s.date_out);
  const wEnd = warrantyEnd(s.date_out);
  const tech = techs.find(t => t.id === s.technician_id);
  const statusCls = s.status === 'Entregado'
    ? 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10'
    : s.status === 'Cancelado' || s.status === 'Devuelto'
      ? 'text-destructive border-destructive/40 bg-destructive/10'
      : s.status === 'Por entregar'
        ? 'text-amber-600 border-amber-500/40 bg-amber-500/10'
        : undefined;

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onToggle}>
        <TableCell className="w-8">
          {expanded ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-medium">{s.order_num}</TableCell>
        <TableCell>{s.date_in ?? '-'}</TableCell>
        <TableCell>
          <span className="flex items-center gap-1.5">
            {tech ? (
              <span title={`${tech.name} — técnico`}
                className={cn('flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white', tech.color)}>
                {tech.initials}
              </span>
            ) : s.technician ? (
              <span title={`${s.technician} — técnico`}
                className="flex size-4 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[9px] font-bold text-white">
                {initialsOf(s.technician)}
              </span>
            ) : null}
            <span>{s.model ?? '-'}</span>
          </span>
        </TableCell>
        <TableCell className="max-w-[220px]">{s.fault ?? '-'}</TableCell>
        <TableCell className="text-right">${s.amount.toFixed(2)}</TableCell>
        <TableCell className="text-right">
          {s.paid_amount > 0 && (
            <span className="text-xs text-emerald-600">${s.paid_amount.toFixed(2)}</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {s.amount - s.paid_amount > 0.005 ? (
            <span className="text-danger text-xs font-semibold">${(s.amount - s.paid_amount).toFixed(2)}</span>
          ) : s.paid_amount - s.amount > 0.005 ? (
            <span className="text-warning text-xs font-semibold">Excedente ${(s.paid_amount - s.amount).toFixed(2)}</span>
          ) : (
            <Badge variant="outline" className="text-emerald-600 border-emerald-500/40 bg-emerald-500/10">Cancelado</Badge>
          )}
        </TableCell>
        <TableCell><Badge variant="outline" className={statusCls}>{s.status}</Badge></TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={9} className="p-4">
            <ServiceDetail s={s} payments={payments} techs={techs} warranty={{ status: wStatus, end: wEnd }} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ServiceDetail({ s, payments, techs, warranty }: {
  s: Service;
  payments: ServicePayment[] | null;
  techs: Technician[];
  warranty: { status: 'sin' | 'activa' | 'vencida'; end: string | null };
}) {
  const checklist = parseChecklist(s.device_checklist);
  const items = Object.entries(checklist);
  const totalBs = (payments ?? []).reduce((a, p) => a + (p.currency === 'VES' ? p.amount : 0), 0);
  const tech = techs.find(t => t.id === s.technician_id);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Smartphone className="size-3.5" /> Equipo y diagnóstico
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {tech && (
                <span title={`${tech.name} — técnico`}
                  className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', tech.color)}>
                  {tech.initials}
                </span>
              )}
              <span className="font-semibold">{s.model ?? 'Sin modelo'}</span>
              {parseServiceTypes(s).map(t => <Badge key={t} variant="outline" className="whitespace-nowrap">{t}</Badge>)}
            </div>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Falla:</strong> {s.fault ?? '—'}
            </p>
            {s.observations && (
              <p className="text-muted-foreground flex items-start gap-1.5">
                <FileText className="size-3.5 mt-0.5 shrink-0" />
                {s.observations}
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CalendarDays className="size-3" /> Entrada: {s.date_in ?? '—'}</span>
              <span className="flex items-center gap-1"><CalendarDays className="size-3" /> Salida: {s.date_out ?? '—'}</span>
              {s.date_out && (
                warranty.status === 'activa' ? (
                  <span className="text-emerald-600 font-medium">Garantía hasta {warranty.end}</span>
                ) : (
                  <span className="text-muted-foreground">Garantía vencida</span>
                )
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Phone className="size-3" /> {s.phone ?? 'Sin teléfono'}</span>
              {s.client_ci && <span>Cédula: {s.client_ci}</span>}
              {s.client_address && <span>Dirección: {s.client_address}</span>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" /> Blindaje del equipo
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{checklistSummary(s.device_checklist)}</p>
            {items.length > 0 ? (
              <div className="grid grid-cols-1 gap-1">
                {items.map(([k, v]) => {
                  const label = CHECKLIST_ITEMS.find(i => i.key === k)?.label ?? k.replace(/_/g, ' ');
                  return (
                    <div key={k} className="flex items-center gap-2 text-xs">
                      <span className={`inline-block size-2 rounded-full shrink-0 ${v === 'si' ? 'bg-emerald-500' : 'bg-destructive'}`} />
                      <span className="text-muted-foreground">{label}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sin revisión registrada</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pagos y abonos
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {payments === null ? (
            <p className="text-xs text-muted-foreground">Cargando pagos...</p>
          ) : payments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin pagos registrados</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Notas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs whitespace-nowrap">{p.payment_date ? p.payment_date.slice(0, 16) : '-'}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline">{p.payment_method ?? '-'}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {currencySymbol(p.currency)}{p.amount.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                      {p.bank_fee_percent > 0 ? (
                        <>
                          {currencySymbol(p.currency)}{p.net_amount.toFixed(2)}
                          <div className="text-[11px]">comisión {p.bank_fee_percent}%</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{p.zelle_reference ?? '—'}</TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate">{p.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          )}
          {(payments ?? []).length > 0 && (
            <p className="text-xs text-muted-foreground">
              Abonado en Bs.: <strong>Bs. {totalBs.toFixed(2)}</strong> · Abonado en $: <strong>${s.paid_amount.toFixed(2)}</strong> (equivalente)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
