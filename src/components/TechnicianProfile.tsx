import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, Award, Clock, Loader2, TrendingUp, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/db';
import type { TechnicianProfile as Profile } from '@/types';
import { cn, initialsOf, localDate } from '@/lib/utils';

type SortKey = 'fecha' | 'orden' | 'cliente' | 'modelo' | 'trabajos' | 'estado' | 'monto';
type Dir = 'asc' | 'desc' | null;

const PERIODS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: '7 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'anterior', label: 'Mes pasado' },
  { key: 'rango', label: 'Rango' },
];

// Fecha LOCAL (no UTC): ver `localDate` en lib/utils.ts — con toISOString() «hoy» pasaba al
// día siguiente después de las 20:00 en Venezuela.
const iso = (d: Date) => localDate(d);

function rangeFor(key: string, from: string, to: string): { start: string; end: string } {
  const now = new Date();
  const today = iso(now);
  if (key === 'hoy') return { start: today, end: today };
  if (key === 'semana') return { start: iso(new Date(now.getTime() - 6 * 864e5)), end: today };
  if (key === 'mes') return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
  if (key === 'anterior') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: iso(first), end: iso(last) };
  }
  return { start: from || today, end: to || today };
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'warn' }) {
  const c = tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-foreground';
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', c)}>{value}</span>
    </div>
  );
}

/** Barra simple en CSS puro (sin librerías de gráficas: la app es offline). */
function Bar({ label, value, max, extra, color = 'bg-primary' }: {
  label: string; value: number; max: number; extra?: string; color?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="h-3 flex-1 rounded-sm bg-muted">
        <div className={cn('h-3 rounded-sm transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums">
        {value}{extra ? <span className="text-muted-foreground"> · {extra}</span> : null}
      </span>
    </div>
  );
}

function SortHead({ label, k, sort, dir, onSort, className }: {
  label: string; k: SortKey; sort: SortKey; dir: Dir; className?: string;
  onSort: (k: SortKey) => void;
}) {
  const active = sort === k && dir !== null;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(k)}
        className={cn('flex items-center gap-1 text-left hover:text-foreground', active ? 'text-foreground font-semibold' : 'text-muted-foreground')}>
        {label} <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

export function TechnicianProfileDialog({ open, onClose, technicianId }: {
  open: boolean;
  onClose: () => void;
  technicianId: number | null;
}) {
  const [period, setPeriod] = useState('semana');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('fecha');
  const [dir, setDir] = useState<Dir>('desc');

  const { start, end } = useMemo(() => rangeFor(period, from, to), [period, from, to]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    api.getTechnicianProfile(technicianId, start, end)
      .then(p => { if (alive) setData(p); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, technicianId, start, end]);

  const onSort = (k: SortKey) => {
    if (sort !== k) { setSort(k); setDir('asc'); return; }
    setDir(dir === 'asc' ? 'desc' : dir === 'desc' ? null : 'asc');
  };

  const items = useMemo(() => {
    if (!data) return [];
    const list = [...data.items];
    if (dir === null) return list;
    const val = (r: Profile['items'][number]) => {
      switch (sort) {
        case 'orden': return r.order_num;
        case 'cliente': return r.client;
        case 'modelo': return r.model;
        case 'trabajos': return r.types;
        case 'estado': return r.status;
        case 'monto': return r.amount;
        default: return r.date_out || r.date_in;
      }
    };
    list.sort((a, b) => {
      const x = val(a); const y = val(b);
      const cmp = typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'es');
      return dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [data, sort, dir]);

  const maxDay = Math.max(1, ...(data?.days ?? []).map(d => Math.max(d.received, d.delivered)));
  const maxType = Math.max(1, ...(data?.types ?? []).map(t => t.count));

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] flex flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <span className={cn('flex size-7 items-center justify-center rounded-full text-[11px] font-bold text-white', data?.color || 'bg-slate-500')}>
              {data?.initials || initialsOf(data?.name ?? '')}
            </span>
            {data?.name ?? 'Perfil del técnico'}
          </DialogTitle>
          <DialogDescription>
            Qué hizo, cuándo y de qué tipo — entregados y facturado del período ({start} a {end}).
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 flex flex-wrap items-center gap-2">
          {PERIODS.map(p => (
            <Button key={p.key} size="sm" variant={period === p.key ? 'default' : 'outline'} onClick={() => setPeriod(p.key)}>
              {p.label}
            </Button>
          ))}
          {period === 'rango' && (
            <span className="flex items-center gap-2">
              <Input type="date" className="w-36" value={from} onChange={e => setFrom(e.target.value)} />
              <Input type="date" className="w-36" value={to} onChange={e => setTo(e.target.value)} />
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4">
          {loading && <Skeleton className="h-40 w-full" />}

          {!loading && data && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <Kpi label="Equipos" value={data.services} />
                <Kpi label="Entregados" value={data.delivered} tone="ok" />
                <Kpi label="En taller" value={data.active} tone={data.active > 0 ? 'warn' : undefined} />
                <Kpi label="Facturado" value={`$${data.income_usd.toFixed(2)}`} tone="ok" />
                {data.pending_usd > 0.005 && <Kpi label="Por cobrar" value={`$${data.pending_usd.toFixed(2)}`} tone="warn" />}
                <Kpi label="Prom./día" value={data.avg_per_day.toFixed(1)} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="size-4 text-primary" /> Trabajo por día
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1.5">
                    {data.days.map(d => (
                      <div key={d.date} className="flex flex-col gap-0.5">
                        <Bar label={d.date.slice(5)} value={d.received} max={maxDay} extra={`${d.delivered} entr. · $${d.usd.toFixed(0)}`} />
                      </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Barra = equipos recibidos ese día · “entr.” = entregados · monto facturado.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Award className="size-4 text-primary" /> Qué trabajos hizo
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1.5">
                    {data.types.length === 0 && <span className="text-xs text-muted-foreground">Sin trabajos en el período.</span>}
                    {data.types.map(t => (
                      <Bar key={t.label} label={t.label} value={t.count} max={maxType}
                        extra={t.usd > 0 ? `$${t.usd.toFixed(0)}` : undefined} color="bg-success" />
                    ))}
                  </CardContent>
                </Card>
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" /> Servicios del período
                  <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
                </span>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Wallet className="size-3.5" /> clic en una columna para ordenar (↓ ↑ ↕)
                </span>
              </div>

              {items.length === 0 ? (
                <Empty>
                  <EmptyMedia><Clock className="size-5" /></EmptyMedia>
                  <EmptyTitle>Sin servicios en el período</EmptyTitle>
                  <EmptyDescription>Prueba otro rango o revisa que las órdenes tengan el técnico asignado.</EmptyDescription>
                </Empty>
              ) : (
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortHead label="Fecha" k="fecha" sort={sort} dir={dir} onSort={onSort} className="w-28" />
                        <SortHead label="Orden" k="orden" sort={sort} dir={dir} onSort={onSort} className="w-28" />
                        <SortHead label="Cliente" k="cliente" sort={sort} dir={dir} onSort={onSort} />
                        <SortHead label="Equipo" k="modelo" sort={sort} dir={dir} onSort={onSort} />
                        <SortHead label="Trabajos" k="trabajos" sort={sort} dir={dir} onSort={onSort} />
                        <SortHead label="Estado" k="estado" sort={sort} dir={dir} onSort={onSort} className="w-32" />
                        <SortHead label="Monto" k="monto" sort={sort} dir={dir} onSort={onSort} className="w-24 text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{(r.date_out || r.date_in).slice(0, 10)}</TableCell>
                          <TableCell className="text-xs font-medium">{r.order_num}</TableCell>
                          <TableCell className="text-sm">{r.client}</TableCell>
                          <TableCell className="text-sm">{r.model}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.types || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={r.status === 'Entregado' ? 'default' : 'outline'}
                              className={cn('text-[10px]', r.status === 'Entregado' && 'bg-success hover:bg-success')}>
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${r.amount.toFixed(2)}
                            {r.saldo > 0.005 && <span className="block text-[10px] text-warning">falta ${r.saldo.toFixed(2)}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}

          {!loading && !data && (
            <Empty>
              <EmptyMedia><Loader2 className="size-5" /></EmptyMedia>
              <EmptyTitle>No se pudo cargar el perfil</EmptyTitle>
              <EmptyDescription>Revisa que la app tenga la base de datos accesible.</EmptyDescription>
            </Empty>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
