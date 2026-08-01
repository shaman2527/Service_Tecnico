import { useEffect, useState } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '../db';
import type { ServiceDashboard, Product } from '../types';

export default function Dashboard() {
  const [dash, setDash] = useState<ServiceDashboard | null>(null);
  const [lowStock, setLowStock] = useState<Product[]>([]);

  useEffect(() => {
    api.getServiceDashboard().then(setDash);
    api.getLowStockProducts().then(setLowStock);
  }, []);

  const weeklyStats = [
    { label: 'Total Equipos', value: dash?.total ?? 0, color: 'text-chart-1' },
    { label: 'Entregados', value: dash?.entregados ?? 0, color: 'text-success' },
    { label: 'Pendientes', value: dash?.pendientes ?? 0, color: 'text-warning' },
    { label: 'Ingresos', value: `$${(dash?.total_ingresos ?? 0).toFixed(2)}`, color: 'text-chart-2' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="mb-2">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Resumen general del servicio técnico</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {weeklyStats.map(stat => (
          <Card key={stat.label} className="shadow-sm border border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold tracking-tight ${stat.color}`}>{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="shadow-sm border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Métodos de Pago</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50">
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Método</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Cantidad</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dash?.method_stats ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                      Sin datos de pagos
                    </TableCell>
                  </TableRow>
                ) : (
                  dash?.method_stats.map((m, i) => (
                    <TableRow key={i} className="border-b border-border/30 hover:bg-muted/40">
                      <TableCell className="py-3 px-4 font-medium">{m.payment_method ?? 'N/A'}</TableCell>
                      <TableCell className="py-3 px-4 text-right">{m.count}</TableCell>
                      <TableCell className="py-3 px-4 text-right font-medium">${m.total.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Estado de Servicios</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50">
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Estado</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Cantidad</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dash?.status_stats ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                      Sin servicios registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  dash?.status_stats.map((s, i) => (
                    <TableRow key={i} className="border-b border-border/30 hover:bg-muted/40">
                      <TableCell className="py-3 px-4 font-medium">
                        <Badge variant={
                          s.status === 'Entregado' ? 'default' :
                          s.status === 'Por entregar' ? 'secondary' :
                          s.status === 'Cancelado / Devuelto' ? 'destructive' :
                          'outline'
                        }>
                          {s.status ?? 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 px-4 text-right">{s.count}</TableCell>
                      <TableCell className="py-3 px-4 text-right font-medium">${s.total.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm border border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Stock Bajo</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50">
                <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Producto</TableHead>
                <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Marca</TableHead>
                <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Modelo</TableHead>
                <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Stock</TableHead>
                <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Stock Mín</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lowStock.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    Todos los productos tienen stock suficiente
                  </TableCell>
                </TableRow>
              ) : (
                lowStock.map(p => (
                  <TableRow key={p.id} className="border-b border-border/30 hover:bg-muted/40">
                    <TableCell className="py-3 px-4 font-medium">{p.name}</TableCell>
                    <TableCell className="py-3 px-4">{p.brand ?? '-'}</TableCell>
                    <TableCell className="py-3 px-4">{p.model ?? '-'}</TableCell>
                    <TableCell className="py-3 px-4 text-right text-danger font-bold">{p.stock}</TableCell>
                    <TableCell className="py-3 px-4 text-right">{p.min_stock}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
