import { useEffect, useState, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowRight, Database, DollarSign, RefreshCw,
  Smartphone, TrendingUp, Wrench, CheckCircle2, Clock,
} from 'lucide-react';
import { api } from '../db';
import type { ServiceDashboard, Product, DashboardAnalytics, StatusStat } from '../types';

const FLOW_STAGES: { status: string; short: string; dot: string; ring: string }[] = [
  { status: 'Recibido', short: 'Recibido', dot: 'bg-sky-500', ring: 'border-sky-500/40 bg-sky-500/5' },
  { status: 'En reparación', short: 'En reparación', dot: 'bg-amber-500', ring: 'border-amber-500/40 bg-amber-500/5' },
  { status: 'Esperando repuesto', short: 'Esperando repuesto', dot: 'bg-orange-500', ring: 'border-orange-500/40 bg-orange-500/5' },
  { status: 'Reparado/Pendiente Pago', short: 'Reparado', dot: 'bg-violet-500', ring: 'border-violet-500/40 bg-violet-500/5' },
  { status: 'Por entregar', short: 'Por entregar', dot: 'bg-blue-500', ring: 'border-blue-500/40 bg-blue-500/5' },
  { status: 'Entregado', short: 'Entregado', dot: 'bg-emerald-500', ring: 'border-emerald-500/40 bg-emerald-500/5' },
];

const TERMINAL_STAGES = ['Cancelado', 'Devuelto', 'Cancelado / Devuelto'];

const fmtBs = (v: number) => `Bs ${v.toFixed(2)}`;

function FlowNode({ label, count, dot, ring, muted }: { label: string; count: number; dot: string; ring: string; muted?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 min-w-[110px] transition-colors ${ring} ${muted ? 'opacity-40' : ''}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="text-xs font-medium text-foreground text-center leading-tight">{label}</span>
      <span className="text-lg font-bold leading-none">{count}</span>
    </div>
  );
}

export default function Dashboard() {
  const [dash, setDash] = useState<ServiceDashboard | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [synced, setSynced] = useState<boolean | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, a, low] = await Promise.all([
      api.getServiceDashboard(),
      api.getDashboardAnalytics(),
      api.getLowStockProducts(),
    ]);
    setDash(d);
    setAnalytics(a);
    setLowStock(low);
    setSynced(true);
    setRefreshedAt(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    load().catch(() => setSynced(false));
  }, [load]);

  const statusCount = (status: string) =>
    (dash?.status_stats ?? []).find(s => (s.status ?? '').toLowerCase() === status.toLowerCase())?.count ?? 0;

  const activeServices = (dash?.status_stats ?? []).reduce(
    (a, s) => a + (TERMINAL_STAGES.includes((s.status ?? '').trim()) ? 0 : s.count), 0);

  const maxCatUnits = Math.max(1, ...(analytics?.category_stats ?? []).map(c => c.units));
  const weeklyStats = [
    {
      label: 'Ventas Hoy',
      icon: <DollarSign className="size-4 text-success" />,
      main: `$${(analytics?.today_usd ?? 0).toFixed(2)}`,
      sub: analytics && analytics.today_bs > 0 ? `+ ${fmtBs(analytics.today_bs)}` : 'Sin ventas en Bs',
      subClass: analytics && analytics.today_bs > 0 ? 'text-warning' : 'text-muted-foreground',
    },
    {
      label: 'Ventas 7 Días',
      icon: <TrendingUp className="size-4 text-chart-1" />,
      main: `$${(analytics?.week_usd ?? 0).toFixed(2)}`,
      sub: `${analytics?.week_count ?? 0} ventas · ${analytics?.week_units ?? 0} unidades${analytics && analytics.week_bs > 0 ? ` · ${fmtBs(analytics.week_bs)}` : ''}`,
      subClass: 'text-muted-foreground',
    },
    {
      label: 'Equipos en Taller',
      icon: <Smartphone className="size-4 text-chart-4" />,
      main: `${activeServices}`,
      sub: `${dash?.entregados ?? 0} entregados · ${dash?.total ?? 0} históricos`,
      subClass: 'text-muted-foreground',
    },
    {
      label: 'Ingresos Servicios',
      icon: <Wrench className="size-4 text-chart-2" />,
      main: `$${(dash?.total_ingresos ?? 0).toFixed(2)}`,
      sub: 'Servicios entregados',
      subClass: 'text-muted-foreground',
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Resumen general del servicio técnico</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${synced === false
            ? 'border-danger/40 bg-danger/10 text-danger'
            : 'border-success/40 bg-success/10 text-success'}`}>
            <span className={`h-2 w-2 rounded-full ${synced === false ? 'bg-danger' : 'bg-success'} ${synced ? 'animate-pulse' : ''}`} />
            {synced === false
              ? 'Base de datos no disponible'
              : synced === null
                ? 'Conectando...'
                : 'Sincronizado · datos locales'}
          </div>
          <Button variant="outline" size="sm" onClick={() => { setSynced(null); load().catch(() => setSynced(false)); }}>
            <RefreshCw className="size-4" /> Actualizar
          </Button>
        </div>
      </div>

      {synced && analytics && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Database className="size-3.5" /> {analytics.product_count} productos · {analytics.sale_count} ventas · {analytics.service_count} servicios · {analytics.client_count} clientes</span>
          <span className="flex items-center gap-1.5"><Clock className="size-3.5" /> Última actividad: {analytics.last_activity?.slice(0, 16) ?? 'sin registros'}</span>
          {refreshedAt && <span>Actualizado {refreshedAt}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {weeklyStats.map(stat => (
          <Card key={stat.label} className="shadow-sm border border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                {stat.icon}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight">{stat.main}</div>
              <div className={`text-xs mt-1 ${stat.subClass}`}>{stat.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="shadow-sm border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Ventas por Categoría (7 días)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {(analytics?.category_stats ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Sin ventas en los últimos 7 días</p>
            ) : (
              analytics?.category_stats.map(c => (
                <div key={c.category_name ?? 'sin'} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.category_name}</span>
                    <span className="text-muted-foreground">
                      {c.units} uds · <span className="text-foreground font-semibold">${c.total_usd.toFixed(2)}</span>
                      {c.total_bs > 0 && <span className="text-warning"> · {fmtBs(c.total_bs)}</span>}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-1/80 transition-all"
                      style={{ width: `${Math.max(4, (c.units / maxCatUnits) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Top Modelos Vendidos (7 días)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50">
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Producto</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Uds</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(analytics?.top_models ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                      Sin ventas en los últimos 7 días
                    </TableCell>
                  </TableRow>
                ) : (
                  analytics?.top_models.map((m, i) => (
                    <TableRow key={i} className="border-b border-border/30 hover:bg-muted/40">
                      <TableCell className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                            {i + 1}
                          </span>
                          <div>
                            <div className="font-medium leading-tight">{m.product_name ?? '—'}</div>
                            {m.brand && m.model && (
                              <div className="text-xs text-muted-foreground">{m.brand} {m.model}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4 text-right"><Badge variant="secondary">{m.units}</Badge></TableCell>
                      <TableCell className="py-3 px-4 text-right font-medium">
                        ${m.total_usd.toFixed(2)}
                        {m.total_bs > 0 && <span className="block text-xs font-normal text-warning">{fmtBs(m.total_bs)}</span>}
                      </TableCell>
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
          <CardTitle className="text-base font-semibold">Flujo de Servicios</CardTitle>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-success" />
            Estados actuales del taller ({activeServices} en proceso)
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {FLOW_STAGES.map((stage, i) => (
              <div key={stage.status} className="flex items-center gap-2">
                <FlowNode
                  label={stage.short}
                  count={statusCount(stage.status)}
                  dot={stage.dot}
                  ring={stage.ring}
                  muted={statusCount(stage.status) === 0}
                />
                {i < FLOW_STAGES.length - 1 && (
                  <ArrowRight className="size-4 text-muted-foreground/50 shrink-0" />
                )}
              </div>
            ))}
            {(dash?.status_stats ?? [])
              .filter(s => TERMINAL_STAGES.includes((s.status ?? '').trim()))
              .map(s => (
                <div key={s.status} className="flex items-center gap-2">
                  <ArrowRight className="size-4 text-danger/50 shrink-0" />
                  <FlowNode
                    label={s.status ?? 'Cancelado'}
                    count={s.count}
                    dot="bg-danger"
                    ring="border-danger/40 bg-danger/5"
                    muted={s.count === 0}
                  />
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

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
                  (dash?.status_stats ?? []).map((s: StatusStat, i) => (
                    <TableRow key={i} className="border-b border-border/30 hover:bg-muted/40">
                      <TableCell className="py-3 px-4 font-medium">
                        <Badge variant={
                          s.status === 'Entregado' ? 'default' :
                          s.status === 'Por entregar' ? 'secondary' :
                          TERMINAL_STAGES.includes((s.status ?? '').trim()) ? 'destructive' :
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
