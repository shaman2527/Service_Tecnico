import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/db';
import type { InventoryMovement } from '@/types';

const PAGE_SIZE = 50;
const MOTIVOS = ['', 'Servicio Entregado', 'Servicio Entregado (faltante)', 'Servicio Reabierto', 'Pedido Recibido', 'Ajuste', 'Venta'];

export function MovementsTab({ refreshKey }: { refreshKey: number }) {
  const [type, setType] = useState('todos');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<InventoryMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPage(0); }, [type, reason, from, to]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.getInventoryMovementsPage(
        null,
        type === 'todos' ? null : type,
        reason || null,
        from || null,
        to || null,
        PAGE_SIZE,
        page * PAGE_SIZE,
      ).then(r => {
        if (!alive) return;
        setItems(r.items);
        setTotal(r.total);
      }).finally(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [type, reason, from, to, page, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Entradas y salidas</SelectItem>
            <SelectItem value="entrada">Solo entradas</SelectItem>
            <SelectItem value="salida">Solo salidas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reason || 'todos'} onValueChange={v => setReason(v === 'todos' ? '' : v)}>
          <SelectTrigger className="w-60"><SelectValue placeholder="Motivo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los motivos</SelectItem>
            {MOTIVOS.filter(Boolean).map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Desde</span>
          <Input type="date" className="w-40" value={from} onChange={e => setFrom(e.target.value)} />
          <span className="text-xs text-muted-foreground">Hasta</span>
          <Input type="date" className="w-40" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        {(type !== 'todos' || reason || from || to) && (
          <Button variant="ghost" size="sm" onClick={() => { setType('todos'); setReason(''); setFrom(''); setTo(''); }}>
            Limpiar filtros
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="w-28">Tipo</TableHead>
                <TableHead className="w-24 text-right">Cantidad</TableHead>
                <TableHead className="w-56">Motivo</TableHead>
                <TableHead className="w-32">Referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`sk-${i}`}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8">
                    <Empty>
                      <EmptyMedia><History className="size-5" /></EmptyMedia>
                      <EmptyTitle>Sin movimientos con esos filtros</EmptyTitle>
                      <EmptyDescription>Cada entrega de servicio, pedido recibido o ajuste manual queda registrado aquí.</EmptyDescription>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.map(m => {
                const entrada = m.type === 'entrada';
                const faltante = (m.reason ?? '').includes('faltante');
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{m.date ?? '—'}</TableCell>
                    <TableCell className="font-medium">{m.product_name ?? '(producto borrado)'}</TableCell>
                    <TableCell>
                      <Badge variant={entrada ? 'default' : 'destructive'} className={entrada ? 'bg-success hover:bg-success' : undefined}>
                        {entrada
                          ? <><ArrowDownLeft data-icon="inline-start" /> Entrada</>
                          : <><ArrowUpRight data-icon="inline-start" /> Salida</>}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.quantity}</TableCell>
                    <TableCell className="text-sm">
                      <span className={faltante ? 'text-danger font-medium' : ''}>{m.reason ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.reference ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{total === 0 ? 'Sin resultados' : `${total} movimientos`}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            <ChevronLeft data-icon="inline-start" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>
            Siguiente <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}
