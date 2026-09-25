import { useEffect, useRef, useState } from 'react';
import { Plus, Search, TrendingUp, Lock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

import { api } from '../db';
// F31: selector de método de pago compartido (3 favoritos a un toque + el resto en un desplegable)
import { PaymentMethodPicker } from './PaymentMethodPicker';
import { methodCurrency, currencySymbol, titleCase, localDate, monthStart, cn } from '@/lib/utils';
import type { Sale, Product, PaymentMethod, SaleStat } from '../types';
// F70: anular una venta (reglas de la pantalla en la regla pura, probada en `tools/void_sale_test.ts`)
import { impactoAnulacion, motivoOk, estadoFila, totalesVigentes } from '@/lib/void-sale';
// F74 — el IVA: la configuración vigente y la línea de desglose (una sola cuenta, la regla pura).
import { parseIvaConfig, ivaActivo, desgloseIva, IVA_DEFAULT, type IvaConfig } from '@/lib/iva';
import IvaDesglose from './IvaDesglose';
// F70: qué puede tocar cada sesión (anular es del dueño; el backend lo exige igual)
import { abilities } from '@/lib/session';

export default function Sales({ role = 'owner' }: { role?: 'owner' | 'cashier' }) {
  const ab = abilities(role === 'owner' ? 'master' : 'caja');
  const [sales, setSales] = useState<Sale[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('hoy');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<SaleStat[]>([]);
  const [statsDays, setStatsDays] = useState(7);
  const [dayOpen, setDayOpen] = useState<boolean | null>(null);
  // F70 — anulación: la venta que se está anulando, el motivo y el error del intento
  const [aAnular, setAAnular] = useState<Sale | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);

  const load = async () => {
    let days: number | null = null;
    let start = '', end = '';
    if (dateStart || dateEnd) {
      start = dateStart;
      end = dateEnd;
    } else if (period === 'hoy') {
      const d = localDate();
      start = d;
      end = d;
    } else if (period === '7d') days = 7;
    else if (period === '30d') days = 30;
    else if (period === 'mes') {
      const hoy = localDate();
      start = monthStart(hoy);
      end = hoy;
    }
    const [s, m] = await Promise.all([
      api.getSales(search, days, start, end),
      api.getPaymentMethods(),
    ]);
    setSales(s);
    setMethods(m);
  };

  useEffect(() => { load(); }, []);
  // Debounce: la búsqueda solo consulta tras 350ms de inactividad
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [period, search, dateStart, dateEnd]);

  useEffect(() => {
    api.getActiveDay().then(d => setDayOpen(!!d)).catch(() => setDayOpen(true));
  }, []);

  const openStats = async (days: number) => {
    setStatsDays(days);
    setStats(await api.getSalesStats(days));
    setShowStats(true);
  };

  // F70 — los KPIs de la pantalla NO cuentan las ventas anuladas (si no, el número mentiría) y se dice
  // cuántas se anularon. La lista SÍ las muestra, tachadas.
  const vigentes = totalesVigentes(sales);
  const totalUsd = vigentes.usd;
  const totalBs = vigentes.bs;

  /** F70 — anular la venta del diálogo abierto (el backend hace el reverso de stock y el asiento). */
  const confirmarAnulacion = async () => {
    if (!aAnular) return;
    const motivo = motivoOk(motivoAnular);
    if (!motivo.ok) { setErrorAnular(motivo.error ?? null); return; }
    setAnulando(true);
    setErrorAnular(null);
    try {
      await api.voidSale(aAnular.id, motivoAnular.trim());
      setAAnular(null);
      setMotivoAnular('');
      await load();
    } catch (e) {
      setErrorAnular(e instanceof Error ? e.message : String(e));
    } finally {
      setAnulando(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground mt-1">Registro de ventas y estadísticas</p>
        </div>
        <div className="flex items-center gap-3">
          {dayOpen === false && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
              <Lock className="size-4" /> Día cerrado — abre el día en Libro Diario para registrar ventas
            </div>
          )}
          {dayOpen === true && (
            <span className="text-sm text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="size-4" /> Día abierto
            </span>
          )}
          <Button onClick={() => setShowForm(true)}>
            <Plus className="size-4" /> Nueva Venta
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Ventas</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vigentes.count}</div>
            {/* F70: las anuladas no se esconden — se informan aparte, sin sumar */}
            {vigentes.anuladas > 0 && (
              <div className="text-[11px] text-muted-foreground" data-field="ventas-anuladas">
                {vigentes.anuladas} anulada{vigentes.anuladas === 1 ? '' : 's'} (no cuentan)
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Unidades</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{vigentes.unidades}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">${totalUsd.toFixed(2)}</div>
            {totalBs > 0 && <div className="text-sm text-muted-foreground">+ Bs. {totalBs.toFixed(2)}</div>}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar producto, cliente o cédula..." className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" className="w-36" value={dateStart}
            onChange={e => { setDateStart(e.target.value); if (!e.target.value) setDateEnd(''); }}
            title="Desde" />
          <span className="text-xs text-muted-foreground">a</span>
          <Input type="date" className="w-36" value={dateEnd}
            min={dateStart || undefined}
            onChange={e => setDateEnd(e.target.value)}
            title="Hasta" />
          {(dateStart || dateEnd) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateStart(''); setDateEnd(''); }}>
              Limpiar
            </Button>
          )}
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hoy">Hoy</SelectItem>
            <SelectItem value="todo">Todo</SelectItem>
            <SelectItem value="7d">7 días</SelectItem>
            <SelectItem value="30d">30 días</SelectItem>
            <SelectItem value="mes">Este mes</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => openStats(7)}>
          <TrendingUp className="size-4" /> Stats
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cant</TableHead>
                <TableHead className="text-right">P/U</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Cliente</TableHead>
                {ab.voidSale && <TableHead className="w-24"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={ab.voidSale ? 9 : 8} className="text-center text-muted-foreground py-8">
                    Sin ventas registradas
                  </TableCell>
                </TableRow>
              ) : (
                sales.map(s => {
                  const estado = estadoFila(s);
                  return (
                  <TableRow key={s.id} data-sale-row={s.id} data-sale-voided={estado.anulada ? '1' : null}
                    className={cn(estado.anulada && 'opacity-60')}>
                    <TableCell className="text-muted-foreground text-xs">{s.id}</TableCell>
                    <TableCell className={cn(estado.anulada && 'line-through')}>{s.date ?? '-'}</TableCell>
                    <TableCell className={cn('font-medium', estado.anulada && 'line-through')}>
                      {s.product_name ?? '-'}
                      {estado.anulada && (
                        <Badge variant="destructive" className="ml-2 text-[10px] align-middle" data-sale-void-badge>
                          {estado.etiqueta}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn('text-right', estado.anulada && 'line-through')}>{s.quantity}</TableCell>
                    <TableCell className={cn('text-right', estado.anulada && 'line-through')}>${s.unit_price.toFixed(2)}</TableCell>
                    <TableCell className={cn('text-right font-bold', estado.anulada && 'line-through')}>
                      {currencySymbol(s.currency)}{s.total.toFixed(2)}
                      {s.discount_amount > 0.005 && (
                        <div className="text-[11px] font-normal text-amber-600">desc. ${(s.discount_amount * s.quantity).toFixed(2)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.payment_method ?? '-'}</Badge>
                      {((s.payment_method ?? '').includes('Móvil') || (s.payment_method ?? '').includes('Movil') || (s.payment_method ?? '').includes('Zelle')) && s.zelle_reference && (
                        <div className="text-[11px] text-muted-foreground">ref ····{s.zelle_reference.slice(-4)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.client_name ?? '-'}
                      {s.client_ci && (
                        <div className="text-[11px] text-muted-foreground">{s.client_ci}</div>
                      )}
                      {/* F70: la venta anulada dice POR QUÉ — la historia no se esconde */}
                      {estado.anulada && (
                        <div className="text-[11px] text-danger" data-sale-void-reason={s.void_reason ?? ''}>
                          {estado.detalle}
                        </div>
                      )}
                    </TableCell>
                    {ab.voidSale && (
                      <TableCell>
                        {!estado.anulada && (
                          <Button variant="ghost" size="sm" className="text-danger"
                            data-action="anular-venta" data-sale-id={s.id}
                            onClick={() => { setAAnular(s); setMotivoAnular(''); setErrorAnular(null); }}>
                            Anular
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showForm && (
        <SaleForm
          methods={methods}
          dayOpen={dayOpen}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}

      {showStats && (
        <StatsModal
          title={statsDays === 7 ? 'Stats semanales' : 'Stats mensuales'}
          stats={stats}
          onClose={() => setShowStats(false)}
        />
      )}

      {/* F70 — ANULAR UNA VENTA: el diálogo dice el IMPACTO con números (de qué caja sale la plata,
          cuántas unidades vuelven al stock) y pide el motivo (queda en el libro y en la auditoría).
          Es del dueño: el backend lo exige igual (`void_sale` → `require_owner`). */}
      {aAnular && (() => {
        const impacto = impactoAnulacion(aAnular);
        return (
          <Dialog open onOpenChange={() => { setAAnular(null); setErrorAnular(null); }}>
            <DialogContent className="sm:max-w-md" data-dialog="anular-venta">
              <DialogHeader>
                <DialogTitle>Anular la venta #{aAnular.id}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm" data-field="impacto-anulacion">
                  {impacto.texto}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">¿Por qué se anula?</label>
                  <Input value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)}
                    data-field="motivo-anulacion" placeholder="Ej: precio mal tecleado, el cliente se arrepintió…" />
                  <p className="text-[11px] text-muted-foreground">
                    Queda guardado en el libro de plata con tu nombre y la fecha.
                  </p>
                </div>
                {errorAnular && <p className="text-sm text-danger" data-field="error-anulacion">{errorAnular}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setAAnular(null); setErrorAnular(null); }}>Cancelar</Button>
                <Button variant="destructive" onClick={confirmarAnulacion} disabled={anulando}
                  data-action="confirmar-anulacion">
                  {anulando ? 'Anulando…' : 'Anular la venta'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}

function SaleForm({ methods, dayOpen, onClose, onSaved }: {
  methods: PaymentMethod[];
  dayOpen: boolean | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [productOpen, setProductOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState(methods[0]?.name ?? '');
  const [clientName, setClientName] = useState('');
  const [clientCi, setClientCi] = useState('');
  const [clientId, setClientId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [clientSugs, setClientSugs] = useState<{ id: number; name: string; phone: string | null; ci?: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [reference, setReference] = useState('');
  const [tasaBcv, setTasaBcv] = useState(0);
  // F74 — la configuración del IVA (la lee cualquiera; la escribe el dueño desde el Libro Diario).
  const [iva, setIva] = useState<IvaConfig>(IVA_DEFAULT);
  const [saveError, setSaveError] = useState<string | null>(null);
  const productPicked = useRef(false);
  const clientPicked = useRef(false);
  const discountTouched = useRef(false);

  useEffect(() => {
    api.getProducts('', null).then(setCatalog);
    api.getActiveDay().then(d => setTasaBcv(d?.tasa_bcv ?? 0)).catch(() => {});
    api.getTaxConfig().then(g => setIva(parseIvaConfig(g))).catch(() => {});
  }, []);

  useEffect(() => {
    const q = productQuery.trim().toLowerCase();
    if (q.length >= 1 && catalog.length > 0) {
      const filtered = catalog
        .filter(p => {
          const compat = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
          const hay = [p.name, p.brand ?? '', p.model ?? '', ...compat].join(' ').toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 12);
      setSuggestions(filtered);
      setProductOpen(filtered.length > 0 && !productPicked.current);
    } else {
      setSuggestions([]);
    }
  }, [productQuery, catalog]);

  useEffect(() => {
    if (clientQuery.length > 0 && !clientPicked.current) {
      api.suggestClients(clientQuery, 8).then(setClientSugs);
    } else {
      setClientSugs([]);
    }
  }, [clientQuery]);

  const selectProduct = (p: Product) => {
    productPicked.current = true;
    setProductId(p.id);
    setProductName(p.name);
    if (method === 'Divisas (USD Cash)' && p.price_usd > 0) {
      // En efectivo se cobra el precio contado (price_usd) y se muestra el descuento vs precio lista
      setPrice(p.price_usd);
      if (!discountTouched.current && p.price_sale > p.price_usd) {
        setDiscount(p.price_sale - p.price_usd);
      }
    } else {
      setPrice(p.price_sale);
    }
    setProductQuery(p.name);
    setProductOpen(false);
  };

  const selectClient = (c: { id: number; name: string; ci?: string | null }) => {
    clientPicked.current = true;
    setClientId(c.id);
    setClientName(c.name);
    setClientCi(c.ci ?? '');
    setClientQuery(c.name);
    setClientOpen(false);
  };

  const isRef = method.includes('Móvil') || method.includes('Movil') || method.includes('Zelle');
  const saleCurrency = methodCurrency(method);
  const isBs = saleCurrency === 'VES';
  const isDivisas = method === 'Divisas (USD Cash)';
  const totalUsdTmp = quantity * price;
  // F39: una venta en bolívares se cobra AL BOLÍVAR ENTERO (no existen centavos de bolívar en la
  // calle). Antes se guardaba `total × tasa` con centavos, así que el arqueo arrastraba descuadres
  // de céntimos contra los 0,5 Bs. de tolerancia. Se redondea UNA vez y ese mismo número se muestra
  // y se guarda (lo que dice la pantalla es lo que entra a la caja).
  // F74 — EL IVA DE LA VENTA. `totalUsdTmp` es lo que se cobraría sin IVA; con el IVA «agregado» el
  // total a cobrar es la base MÁS el IVA (y en Bs. se convierte ese total, no la base), con el IVA
  // «incluido» el total no cambia y sólo se desglosa. La cuenta sale de la regla pura `src/lib/iva.ts`.
  const dIva = desgloseIva(totalUsdTmp, iva, { tasa: tasaBcv });
  const totalCobrar = dIva.total;
  // F39: una venta en bolívares se cobra AL BOLÍVAR ENTERO (no existen centavos de bolívar en la
  // calle). Antes se guardaba `total × tasa` con centavos, así que el arqueo arrastraba descuadres
  // de céntimos contra los 0,5 Bs. de tolerancia. Se redondea UNA vez y ese mismo número se muestra
  // y se guarda (lo que dice la pantalla es lo que entra a la caja).
  const totalFinal = isBs ? Math.round(totalCobrar * tasaBcv) : totalCobrar;

  const save = async () => {
    // F70 — NINGÚN CAMINO MUDO: antes `if (!productName) return;` y `if (price <= 0) return;` dejaban
    // al operario apretando «Guardar Venta» sin que pasara nada (y sin saber por qué).
    if (!productName) {
      setSaveError('Elegí el producto de la lista de sugerencias (es el que descuenta el stock).');
      return;
    }
    if (price <= 0) {
      // La ficha no tiene precio de venta (en la base real hay fichas con stock sin precio): se dice qué
      // pasa y dónde se arregla.
      setSaveError('Esta ficha no tiene precio de venta: no se puede cobrar. Se carga en Inventario → Productos (botón «Editar» o el filtro «Sin precio»); si no podés editarlo, pedíselo al dueño.');
      return;
    }
    if (isBs && tasaBcv <= 0) {
      setSaveError('Para vender en bolívares se necesita la tasa BCV del día. Ábrela en Libro Diario (el día debe estar abierto con tasa).');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Si el usuario escribió el nombre sin elegir sugerencia, se usa el texto (ya en formato Título)
      const finalName = clientName || titleCase(clientQuery.trim());
      let cid = clientId;
      if (finalName && !cid) {
        cid = await api.addOrFindClient(finalName, '', clientCi);
      }
      // Se guarda EXACTAMENTE el número que la pantalla mostró como total (totalFinal): si la UI
      // redondeara y el guardado no, la caja contaría un monto distinto al que se cobró. F74: con el
      // IVA «agregado» el total guardado YA lo incluye, y la alícuota viaja con la venta para que un
      // reporte de un período cerrado no cambie después.
      await api.addSale(productId, productName, quantity, price, isBs ? totalFinal : totalCobrar, method, finalName, cid, notes, 0, reference, saleCurrency, discount,
                        ivaActivo(iva) ? iva.alicuota : 0, ivaActivo(iva) ? iva.modo : '');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg" onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
      }}>
        <DialogHeader>
          <DialogTitle>Nueva Venta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Producto</label>
            <Input placeholder="Buscar producto..." value={productQuery}
              onChange={e => { productPicked.current = false; setProductQuery(e.target.value); setProductOpen(true); }} />
            {productOpen && suggestions.length > 0 && (
              <div className="rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto">
                {suggestions.map(p => {
                  const compatList = (() => { try { const l = JSON.parse(p.compatibility || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
                  const outOfStock = p.stock <= 0;
                  return (
                    <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0"
                      onClick={() => selectProduct(p)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{p.name.replace(/^Pantalla\s+/i, '')}</span>
                        <span className={outOfStock ? 'text-danger font-semibold text-xs shrink-0' : 'text-muted-foreground text-xs shrink-0'}>
                          ${p.price_sale.toFixed(2)} · Stock: {p.stock}
                        </span>
                      </div>
                      {p.brand && <span className="text-muted-foreground text-xs">{p.brand} {p.model}</span>}
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cantidad</label>
              <Input type="number" min={1} value={quantity}
                onChange={e => setQuantity(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Precio Unitario ($)</label>
              <Input type="number" step={0.01} min={0} value={price}
                onChange={e => setPrice(Number(e.target.value))} />
            </div>
          </div>

          {isDivisas && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Descuento ($)</label>
              <Input type="number" step={0.01} min={0} value={discount}
                onChange={e => { discountTouched.current = true; setDiscount(Math.max(0, Number(e.target.value))); }} />
              <p className="text-xs text-muted-foreground">
                {discount > 0.005 ? (
                  <>Precio lista ${((price + discount) * quantity).toFixed(2)} → el cliente paga ${(price * quantity).toFixed(2)} en efectivo</>
                ) : (
                  <>Se sugiere automáticamente al elegir el producto: precio lista − precio contado (efectivo).</>
                )}
              </p>
            </div>
          )}

          {/* F74 — EL IVA DE LA VENTA: con el IVA activo se ve la cuenta completa (base + IVA = total
              a cobrar) ANTES de guardar; con el IVA apagado esta línea no se dibuja. */}
          <IvaDesglose importe={totalUsdTmp} cfg={iva} tasa={tasaBcv} campo="iva-desglose-venta" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Método de Pago</label>
              {/* F31: los 3 métodos que más se usan a un toque; el resto en «Otros métodos…» */}
              <PaymentMethodPicker
                methods={methods}
                value={method}
                onChange={m => { setMethod(m); setSaveError(null); if (!m.includes('Móvil') && !m.includes('Movil') && !m.includes('Zelle')) setReference(''); if (m !== 'Divisas (USD Cash)') setDiscount(0); }}
              />
              {methodCurrency(method) === 'VES' && (
                <p className="text-xs text-amber-600">
                  {tasaBcv > 0
                    ? `Se cobra en bolívares: total Bs. ${totalFinal.toLocaleString('es-VE')} (tasa BCV ${tasaBcv.toFixed(2)})`
                    : 'Sin tasa BCV en el día abierto — abre/actualiza el día en Libro Diario para cobrar en Bs.'}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente</label>
              <Input placeholder="Buscar o escribir nombre..." value={clientQuery}
                onChange={e => { clientPicked.current = false; setClientQuery(e.target.value); setClientOpen(true); }}
                onBlur={() => { if (clientQuery.trim()) setClientQuery(titleCase(clientQuery)); }} />
              {clientOpen && clientSugs.length > 0 && (
                <div className="rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {clientSugs.map(c => (
                    <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-0"
                      onClick={() => selectClient(c)}>
                      <span className="font-medium">{c.name}</span>
                      {c.ci && <span className="text-muted-foreground ml-2 text-xs">{c.ci}</span>}
                      {c.phone && <span className="text-muted-foreground ml-2">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              <Input placeholder="Cédula (opcional)" value={clientCi}
                onChange={e => setClientCi(e.target.value)} />
            </div>
          </div>

          {isRef && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Referencia</label>
              <Input placeholder="Número de referencia (últimos 4 dígitos)..." value={reference}
                onChange={e => setReference(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Notas</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          {saveError && <p className="text-sm text-danger" data-field="error-venta">{saveError}</p>}
        </div>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col">
          {/* F70 — EL BOTÓN YA NO ESTÁ APAGADO EN SILENCIO: antes `disabled={… || !productName || price <= 0}`
              dejaba «Guardar Venta» gris sin decir por qué (el operario apretaba y no pasaba nada). Ahora se
              puede apretar y, si falta algo, se dice exactamente qué y dónde se arregla. */}
          {!productName && (
            <p className="text-xs text-warning text-left" data-field="aviso-venta">
              Elegí el producto de la lista de sugerencias (es el que descuenta el stock).
            </p>
          )}
          {productName && price <= 0 && (
            <p className="text-xs text-warning text-left" data-field="aviso-venta">
              Esta ficha no tiene precio de venta, así que no se puede cobrar. Cargalo en Inventario → Productos
              (botón «Editar», o el filtro «Sin precio» del KPI).
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={save} title="Ctrl+Enter" disabled={saving || dayOpen === false}>
              {saving ? 'Guardando...' : `Guardar Venta (${isBs ? `Bs. ${totalFinal.toFixed(2)}` : `$${totalUsdTmp.toFixed(2)}`})`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatsModal({ title, stats, onClose }: { title: string; stats: SaleStat[]; onClose: () => void }) {
  const totalQty = stats.reduce((a, s) => a + s.qty, 0);
  const totalAmount = stats.reduce((a, s) => a + s.total, 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-4">
          Total: <strong>{totalQty}</strong> unidades · <strong>${totalAmount.toFixed(2)}</strong>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Ventas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{s.product_name ?? 'N/A'}</TableCell>
                <TableCell className="text-right">{s.qty}</TableCell>
                <TableCell className="text-right">${s.total.toFixed(2)}</TableCell>
                <TableCell className="text-right">{s.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DialogFooter>
          <Button onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
