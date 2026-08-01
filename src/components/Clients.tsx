import { useEffect, useState } from 'react';
import { Search, Phone, Wrench, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '../db';
import type { ClientSummary, Service, Sale } from '../types';

export default function Clients() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ClientSummary | null>(null);
  const [clientServices, setClientServices] = useState<Service[]>([]);
  const [clientSales, setClientSales] = useState<Sale[]>([]);

  const load = async () => {
    setClients(await api.getClients(search));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [search]);

  const openHistory = async (c: ClientSummary) => {
    setSelected(c);
    const [services, sales] = await Promise.all([
      api.getClientServices(c.id),
      api.getClientSales(c.id),
    ]);
    setClientServices(services);
    setClientSales(sales);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground mt-1">Historial de clientes y seguimiento</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input placeholder="Buscar por nombre o teléfono..." className="pl-9"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Teléfono</TableHead>
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
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {search ? 'No se encontraron clientes' : 'No hay clientes registrados'}
                  </TableCell>
                </TableRow>
              ) : (
                clients.map(c => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openHistory(c)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.phone ?? '-'}</TableCell>
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
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.name}
                  {selected.phone && (
                    <span className="text-sm font-normal text-muted-foreground">
                      <Phone className="inline size-3 mr-1" />
                      {selected.phone}
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total Gastado</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-bold text-success">${selected.total_spent.toFixed(2)}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Servicios</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-bold">{selected.service_count}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Compras</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-bold">{selected.sale_count}</div></CardContent>
                </Card>
              </div>

              {clientServices.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <Wrench className="size-4" /> Servicios Técnicos
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
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
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.order_num}</TableCell>
                          <TableCell>{s.date_in ?? '-'}</TableCell>
                          <TableCell>{s.model ?? '-'}</TableCell>
                          <TableCell className="max-w-[120px] truncate">{s.fault ?? '-'}</TableCell>
                          <TableCell className="text-right">${s.amount.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {s.paid_amount > 0 && (
                              <span className="text-xs text-emerald-600">${s.paid_amount.toFixed(2)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.amount - s.paid_amount > 0.005 ? (
                              <span className="text-danger text-xs font-semibold">${(s.amount - s.paid_amount).toFixed(2)}</span>
                            ) : (
                              <Badge variant="outline" className="text-emerald-600">Cancelado</Badge>
                            )}
                          </TableCell>
                          <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {clientSales.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <ShoppingCart className="size-4" /> Compras
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cant</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Pago</TableHead>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {clientServices.length === 0 && clientSales.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Sin actividad registrada</p>
              )}

              <DialogFooter>
                <Button onClick={() => setSelected(null)}>Cerrar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
