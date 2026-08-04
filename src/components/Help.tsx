import { BookOpen, CalendarCheck, CircleDollarSign, ClipboardList, LifeBuoy, Package, Users, Wrench, HelpCircle, Settings2, ArrowRight, Wallet, LayoutDashboard, ShoppingBag, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';

const sections = [
  {
    value: 'inicio',
    icon: HelpCircle,
    title: 'Primeros pasos',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    content: (
      <div className="space-y-3">
        <p>Registro es un sistema local para tu servicio técnico de celulares. Todo se guarda en tu computadora (SQLite), sin internet.</p>
        <div className="space-y-2">
          <p className="font-medium text-foreground">Flujo diario recomendado:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Abre el día en <Badge variant="outline">Libro Diario</Badge> (con la tasa BCV del día — botón <Badge variant="outline">Auto BCV</Badge>).</li>
            <li>Registra las ventas de pantallas en <Badge variant="outline">Ventas</Badge>.</li>
            <li>Registra los equipos que entran en <Badge variant="outline">Servicio Técnico</Badge> (con cédula y checklist del equipo).</li>
            <li>Cobra abonos cuando el cliente pague parcialmente.</li>
            <li>Al entregar un servicio, márcalo como <Badge variant="outline">Entregado</Badge> — la pantalla se descuenta del inventario automáticamente.</li>
            <li>Revisa el <Badge variant="outline">Dashboard</Badge> para ver cómo va el negocio (hoy, 7 días, modelos más vendidos).</li>
            <li>Al cierre del día, <Badge variant="outline">Cierra el día</Badge> en Libro Diario con el arqueo real de caja.</li>
          </ol>
        </div>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-700">
          <span className="font-semibold">Importante:</span> sin un día abierto no se pueden registrar ventas, servicios ni abonos. Abre el día primero.
        </div>
      </div>
    ),
  },
  {
    value: 'dashboard',
    icon: LayoutDashboard,
    title: 'Dashboard (¿cómo va el negocio?)',
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    content: (
      <div className="space-y-2">
        <p>Es el panel de control. Arriba verás un indicador <span className="font-medium text-foreground">Sincronizado · datos locales</span> (verde) con la última actividad y la hora del refresco — si se pone rojo, algo falló al leer los datos; pulsa <Badge variant="outline">Actualizar</Badge>.</p>
        <ol className="list-decimal list-inside space-y-1">
          <li><span className="font-medium text-foreground">KPI:</span> Ventas Hoy ($ y Bs.), Ventas 7 Días (unidades y $), Equipos en el Taller e Ingresos por Servicios.</li>
          <li><span className="font-medium text-foreground">Ventas por Categoría (7 días):</span> barras comparativas — cuánto vendes de pantallas, baterías, accesorios…</li>
          <li><span className="font-medium text-foreground">Top Modelos Vendidos:</span> los 6 productos que más salen.</li>
          <li><span className="font-medium text-foreground">Flujo de Servicios:</span> diagrama de las 6 etapas (Recibido → En reparación → Esperando repuesto → Reparado → Por entregar → Entregado) con cuántos equipos hay en cada una. Cancelado/Devuelto aparecen en rojo.</li>
          <li><span className="font-medium text-foreground">Tablas:</span> métodos de pago usados, estados de servicios y stock bajo (productos agotados o bajo el mínimo).</li>
        </ol>
      </div>
    ),
  },
  {
    value: 'venta',
    icon: CircleDollarSign,
    title: 'Registrar una venta',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    content: (
      <div className="space-y-2">
        <ol className="list-decimal list-inside space-y-1">
          <li>Ve a <Badge variant="outline">Ventas</Badge> y pulsa <Badge variant="outline">Nueva Venta</Badge>.</li>
          <li>Busca el producto por nombre o modelo — verás el <span className="font-medium text-foreground">precio y el stock disponible</span> (en rojo si está agotado).</li>
          <li>Indica cantidad, método de pago y cliente: escribe su nombre o <span className="font-medium text-foreground">selecciónalo de las sugerencias</span> — su cédula se rellena sola (también puedes escribirla a mano).</li>
          <li>Pulsa <Badge variant="outline">Guardar Venta</Badge> — el stock se descuenta automáticamente.</li>
        </ol>
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-700">
          <span className="font-semibold">Buscar ventas:</span> el buscador encuentra por producto, cliente o <span className="font-medium">cédula</span>. Para ver "qué vendí ese día", usa los campos <Badge variant="outline">Desde / Hasta</Badge> (fecha a fecha, p. ej. 01-08 a 01-08) — o los períodos rápidos 7 días / 30 días / Este mes.
        </div>
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-700">
          <span className="font-semibold">Moneda por método:</span> si el cliente paga en bolívares (Pago Móvil, Efectivo Bs, Transferencia Bs), el total se convierte a Bs. con la tasa BCV del día y así se registra en el Libro Diario. El botón de guardar te muestra el monto final en la moneda del método.
        </div>
        <p className="text-sm">Para Punto de Venta puedes indicar el % de comisión y para Zelle/Pago Móvil el número de referencia (últimos 4 dígitos).</p>
      </div>
    ),
  },
  {
    value: 'servicio',
    icon: Wrench,
    title: 'Servicio Técnico (reparaciones)',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    content: (
      <div className="space-y-2">
        <ol className="list-decimal list-inside space-y-1">
          <li><Badge variant="outline">Nuevo Servicio</Badge> → ¿cliente nuevo o existente? Puedes <span className="font-medium text-foreground">buscar por cédula</span> (V-12345678): si existe, se rellena todo solo y ves su historial de servicios; si no existe, se marca como cliente nuevo (la cédula es obligatoria).</li>
          <li>Escribe el modelo del equipo — se sugieren los <span className="font-medium text-foreground">modelos de teléfono</span> del catálogo (una vez cada uno, con sus repuestos y stock debajo).</li>
          <li>Marca los <span className="font-medium text-foreground">trabajos / fallas</span> que se le harán al equipo (puedes elegir varios: pantalla + conector + ...).
            La opción <Badge variant="outline">Otro</Badge> permite escribir un trabajo libre (ej: "cambio de pin de carga"). El primer trabajo elegido es el tipo principal de la orden.</li>
          <li>Marca el <span className="font-medium text-foreground">checklist de blindaje</span> (10 ítems Sí/No: chip SIM, tapa trasera, botones, cámara…) — el estado real del equipo al recibirlo te protege de reclamos. Queda visible con el escudo <span className="font-medium text-foreground">ShieldCheck</span> en la orden.</li>
          <li>En <span className="font-medium text-foreground">Técnico responsable</span> (botón <Badge variant="outline">Técnicos</Badge>) asignas quién reparará el equipo: Aldri, William, o agregas uno con su color e iniciales. La orden queda marcada con el círculo de color + iniciales para saber quién la hizo.</li>
          <li>Guarda el servicio. El estado va: Recibido → En reparación → Esperando repuesto → Reparado/Pendiente Pago → Por entregar → <Badge variant="default" className="bg-success">Entregado</Badge> (o Cancelado / Devuelto).</li>
        </ol>
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-700">
          <span className="font-semibold">Inventario automático:</span> al marcar <Badge variant="outline">Entregado</Badge> se descuenta 1 de la pantalla correspondiente. Si reabres el servicio, el stock se devuelve. Si el modelo no existe en el catálogo, se crea automáticamente.
        </div>
        <div className="rounded-md bg-blue-500/10 border border-blue-500/30 px-3 py-2 text-sm text-blue-700">
          <span className="font-semibold">Buscar servicios:</span> el buscador encuentra por cliente, cédula, modelo u orden. Los campos <Badge variant="outline">Desde / Hasta</Badge> filtran por el día en que se recibieron los equipos (útil para "¿qué entró el 01-08?"), combinable con el filtro de estado.
        </div>
        <p className="text-sm">Las órdenes se muestran como tarjetas con toda la información: cliente, equipo, falla completa, finanzas (monto, abonado, saldo), tipo de servicio y fecha de salida.</p>
      </div>
    ),
  },
  {
    value: 'abonos',
    icon: Wallet,
    title: 'Abonos y pagos parciales',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    content: (
      <div className="space-y-2">
        <p>Un cliente puede <span className="font-medium text-foreground">abonar al inicio</span> y pagar el resto al entregar. Así funciona:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Abre el servicio en edición → panel <Badge variant="outline">Pagos y Abonos</Badge>.</li>
          <li>Pulsa <Badge variant="outline">Registrar Pago / Abono</Badge> — monto, método de pago, referencia y notas.</li>
          <li>El campo de monto cambia según el método: si eliges Pago Móvil/Efectivo Bs/Transferencia Bs el monto es <span className="font-medium text-foreground">en bolívares</span> (te muestra la equivalencia en $ con la tasa del día); si eliges Divisas/Zelle/Punto ($) es en dólares.</li>
          <li>El saldo pendiente se calcula convirtiendo lo abonado en Bs. a $ con la tasa del día del pago: verás <span className="font-medium text-foreground">"Abonado $2.68 + Bs. 2010.00 · Saldo $47.32 pendiente"</span>.</li>
          <li>Cada abono cuenta en el Libro Diario el día que se recibe, en su moneda. Los abonos se pueden eliminar (el saldo se recalcula).</li>
          <li>Puedes entregar el equipo con saldo pendiente: la deuda queda visible en rojo en la orden y en el historial del cliente.</li>
        </ol>
        <div className="rounded-md bg-violet-500/10 border border-violet-500/30 px-3 py-2 text-sm text-violet-700">
          <span className="font-semibold">Cliente inteligente:</span> la primera vez se registra solo. La segunda vez, escribe el nombre o la cédula y sus datos aparecen automáticamente — nunca se duplica.
        </div>
      </div>
    ),
  },
  {
    value: 'inventario',
    icon: Package,
    title: 'Inventario y Pantallas',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    content: (
      <div className="space-y-2">
        <p><Badge variant="outline">Inventario</Badge> muestra todos los productos con su stock, costo, precio y compatibilidad. <Badge variant="outline">Pantallas</Badge> filtra solo la categoría de pantallas.</p>
        <p>Cada pantalla puede ser compatible con varios modelos — verás los modelos como chips. Al vender o entregar un servicio, el stock se actualiza solo, y cada movimiento queda registrado (entradas/salidas con motivo).</p>
        <p>Los productos con stock bajo (menor al mínimo) aparecen en el <Badge variant="outline">Dashboard</Badge> y en <Badge variant="outline">Pedidos</Badge> con sugerencia de reposición.</p>
      </div>
    ),
  },
  {
    value: 'pedidos',
    icon: ShoppingBag,
    title: 'Pedidos a proveedor',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    content: (
      <div className="space-y-2">
        <p>Para reponer stock sin esperar a quedarte sin nada:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>En <Badge variant="outline">Pedidos</Badge> verás los productos <span className="font-medium text-foreground">agotados, stock bajo y pedidos pendientes</span>.</li>
          <li>La tabla "Por reponer" sugiere cuántas unidades pedir de cada producto (el doble del mínimo menos el stock).</li>
          <li>Pulsa <Badge variant="outline">Pedir N</Badge> o crea un <Badge variant="outline">Nuevo Pedido</Badge> manual con el buscador del catálogo y carrito editable.</li>
          <li>Cuando el pedido llegue, pulsa <Badge variant="outline">Recibido</Badge>: el stock se suma automáticamente y queda el movimiento de entrada registrado.</li>
        </ol>
      </div>
    ),
  },
  {
    value: 'clientes',
    icon: Users,
    title: 'Clientes',
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    content: (
      <div className="space-y-2">
        <p>Gestiona tus clientes con su historial completo: compras, servicios y <span className="font-medium text-foreground">saldos pendientes por servicio</span> (cuánto debe cada cliente y por cuál orden).</p>
        <p>Al registrar una venta o servicio con un nombre/cédula, el cliente se crea o actualiza automáticamente — su historial queda guardado para la próxima visita.</p>
        <p>Busca por <span className="font-medium text-foreground">nombre, teléfono o cédula</span> y haz clic en el cliente para abrir su historial.</p>
        <ol className="list-decimal list-inside space-y-1">
          <li><span className="font-medium text-foreground">Compras:</span> cada venta con fecha, producto, total y método de pago.</li>
          <li><span className="font-medium text-foreground">Servicios:</span> pulsa la flecha (chevron) de cualquier orden para expandirla y ver TODO el detalle: falla completa, tipo de trabajo, observaciones, fechas de entrada/salida, garantía, teléfono, cédula y dirección del cliente, y el checklist de blindaje del equipo (10 ítems).</li>
          <li><span className="font-medium text-foreground">Cómo pagó:</span> en cada servicio expandido verás la tabla <span className="font-medium text-foreground">Pagos y abonos</span> — cada abono con su fecha, método (Pago Móvil, Zelle, Divisas…), monto en su moneda real ($ o Bs.), comisión Punto, referencia y notas. Con el badge <Badge variant="outline">Cancelado</Badge> o el saldo pendiente en rojo sabes si el equipo está pago.</li>
        </ol>
        <p>En <Badge variant="outline">Servicio Técnico</Badge> puedes buscar por cédula (V-XXXXX) y ver los últimos servicios del cliente antes de registrar uno nuevo.</p>
      </div>
    ),
  },
  {
    value: 'libro',
    icon: CalendarCheck,
    title: 'Libro Diario (Venta Diaria)',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    content: (
      <div className="space-y-2">
        <p>Es el control financiero del día. Solo puede haber <span className="font-medium text-foreground">un día abierto a la vez</span>.</p>
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">Abrir el día:</p>
          <p>Pulsa <Badge variant="outline">Abrir Día</Badge>, ingresa el efectivo de apertura y la tasa BCV. El botón <Badge variant="outline">Auto BCV</Badge> obtiene la tasa oficial automáticamente (necesita internet); si falla, escríbela a mano. La tasa queda <span className="font-medium text-foreground">congelada</span> para todo el día.</p>
          <p className="text-xs text-muted-foreground">El efectivo de apertura ($50, $20, etc.) se <span className="font-medium">guarda aparte</span> — nunca se suma a las ventas del día ni a los totales.</p>
        </div>
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">Cerrar el día:</p>
          <p>Pulsa <Badge variant="outline">Cerrar Día</Badge>. Verás <span className="font-medium text-foreground">"Cobros del día por método"</span>: Divisas $, Efectivo Bs, Punto de Venta ($ y Bs con comisión y neto), Zelle $, Pago Móvil Bs (con cada referencia), Transferencia Bs y el Total General. Solo cuentas el <span className="font-medium text-foreground">efectivo Bs. real</span> de la caja (arqueo); la diferencia se calcula en vivo y queda guardada.</p>
          <p><span className="font-medium text-foreground">Punto de Venta:</span> el sistema te muestra cuánto cobraste por Punto ("Monto impreso") y tú escribes el monto total que imprimió la máquina al cerrarla — <span className="font-medium text-foreground">tiene que dar el mismo</span>; si no, se marca la diferencia en rojo. Si luego el banco liquida distinto, corrígelo con <Badge variant="outline">Liquidar</Badge> en la pestaña Cierres.</p>
        </div>
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">Exportar Excel (día específico o mes completo):</p>
          <p><Badge variant="outline">Exportar Excel</Badge> genera un reporte (CSV compatible con Excel) en <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Documentos\Registro</code> con el rango <Badge variant="outline">Desde / Hasta</Badge> visible arriba: pon la misma fecha en ambos para un día exacto, o deja el rango del mes para el mes completo. Incluye por día: ventas, pagos de servicios, pago móvil, totales por método y, si el día está cerrado, el cierre completo (apertura, monto impreso del Punto, arqueo real, diferencia y notas) — tu respaldo del libro.</p>
        </div>
      </div>
    ),
  },
  {
    value: 'pin',
    icon: Lock,
    title: 'PIN y roles (cajera / dueño)',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    content: (
      <div className="space-y-2">
        <p>Puedes proteger lo delicado con un PIN de 4 dígitos:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li><span className="font-medium text-foreground">Sin PIN (cajera):</span> puede registrar ventas, servicios y abonos, pero NO ve el Dashboard, no exporta, no cierra el día ni ve históricos.</li>
          <li><span className="font-medium text-foreground">Con PIN (dueño):</span> acceso completo. Se configura desde <Badge variant="outline">Libro Diario → PIN</Badge> (Definir PIN). La pantalla de bloqueo aparece al iniciar la aplicación.</li>
        </ol>
        <p className="text-sm">Si olvidas el PIN, se puede quitar con el PIN actual o reiniciando el archivo <code className="rounded bg-muted px-1.5 py-0.5 text-xs">registro.db</code>.</p>
      </div>
    ),
  },
  {
    value: 'consejos',
    icon: Settings2,
    title: 'Consejos y preguntas frecuentes',
    color: 'text-slate-600',
    bg: 'bg-slate-50',
    content: (
      <div className="space-y-3">
        <div>
          <p className="font-medium text-foreground">¿Cómo respaldo mi información?</p>
          <p>Copia el archivo <code className="rounded bg-muted px-1.5 py-0.5 text-xs">registro.db</code> (junto al programa) a un USB o nube. Ese archivo es toda tu base de datos.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Qué hago si no hay internet para la tasa BCV?</p>
          <p>Escríbela manualmente al abrir el día. La tasa queda guardada en el cierre y se usa para convertir los pagos en bolívares.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Puedo corregir una venta o servicio?</p>
          <p>Sí — edita el registro y guarda. Si era un servicio entregado y lo cambias, el stock se ajusta solo. Los abonos se pueden eliminar y el saldo se recalcula.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Por qué un abono de 2000 Bs. no se refleja como $2000?</p>
          <p>Porque la moneda se deriva del método de pago: si pagó en bolívares, el abono queda en Bs. y su equivalente en $ se calcula con la tasa BCV del día (ej: 2000 Bs. @748.79 ≈ $2.67). Así el Libro Diario y los saldos nunca mezclan monedas.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Cómo sé qué pantallas tengo en stock?</p>
          <p>En <Badge variant="outline">Pantallas</Badge>, en el Dashboard (Stock Bajo) o en Pedidos. Al buscar un producto en una venta también ves el stock en vivo.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Cómo veo qué vendí o qué entró un día específico?</p>
          <p>En <Badge variant="outline">Ventas</Badge> o <Badge variant="outline">Servicio Técnico</Badge>, escribe la fecha en los campos <Badge variant="outline">Desde / Hasta</Badge> (ej: 01-08 a 01-08 para ese día) y pulsa <Badge variant="outline">Limpiar</Badge> cuando quieras volver a ver todo.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Cómo sé si un cliente pagó su servicio y con qué método?</p>
          <p>Ve a <Badge variant="outline">Clientes</Badge>, búscalo por cédula o nombre, y abre su historial. Expande el servicio con la flecha: verás el desglose de cada pago (método, fecha, monto, referencia) y el estado Cancelado o el saldo pendiente en rojo.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Puedo tener más de un día abierto?</p>
          <p>No — solo uno. Para corregir errores del día actual puedes reabrirlo desde la pestaña <Badge variant="outline">Cierres</Badge>.</p>
        </div>
      </div>
    ),
  },
];

const quickActions = [
  { icon: CircleDollarSign, label: 'Vender una pantalla', desc: 'Ventas → Nueva Venta', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { icon: Wrench, label: 'Registrar un equipo', desc: 'Servicio Técnico → Nuevo Servicio', color: 'text-orange-600', bg: 'bg-orange-50' },
  { icon: Wallet, label: 'Cobrar un abono', desc: 'Servicio → Editar → Pagos y Abonos', color: 'text-violet-600', bg: 'bg-violet-50' },
  { icon: CalendarCheck, label: 'Abrir el día', desc: 'Libro Diario → Abrir Día', color: 'text-purple-600', bg: 'bg-purple-50' },
  { icon: ShoppingBag, label: 'Reponer stock', desc: 'Pedidos → Pedir N', color: 'text-rose-600', bg: 'bg-rose-50' },
  { icon: LayoutDashboard, label: 'Ver el negocio', desc: 'Dashboard → Actualizar', color: 'text-sky-600', bg: 'bg-sky-50' },
];

export default function Help() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Ayuda</h1>
          <p className="text-sm text-muted-foreground mt-1">Todo lo que necesitas para usar la aplicación</p>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <LifeBuoy className="size-5" />
          <span className="text-sm">v0.6</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {quickActions.map(a => {
          const Icon = a.icon;
          return (
            <div key={a.label} className={`group rounded-xl border border-border/70 ${a.bg} p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-default`}>
              <div className="flex items-start justify-between">
                <Icon className={`size-5 ${a.color}`} />
                <ArrowRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{a.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
            </div>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-primary/5 via-transparent to-transparent border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" /> Guía completa
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-4">
          <Accordion type="single" collapsible defaultValue="inicio" className="w-full">
            {sections.map(s => {
              const Icon = s.icon;
              return (
                <AccordionItem key={s.value} value={s.value} className="group">
                  <AccordionTrigger className="gap-3 py-3.5">
                    <span className="flex items-center gap-3">
                      <span className={`flex items-center justify-center size-7 rounded-lg ${s.bg} ${s.color} shrink-0`}>
                        <Icon className="size-3.5" />
                      </span>
                      <span className="font-medium">{s.title}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pl-10 space-y-2">
                    {s.content}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <BookOpen className="size-4" /> Métodos de pago y su moneda
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-3">La moneda se deriva <span className="font-medium text-foreground">del método de pago</span>, nunca del producto: los métodos en bolívares se registran en Bs. (y se convierten a $ con la tasa BCV del día), los métodos en dólares se registran en $.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: 'Punto de Venta ($)', desc: 'USD · con comisión (3.5%)', color: 'text-emerald-600' },
              { name: 'Punto de Venta (Bs)', desc: 'Bolívares · con comisión', color: 'text-emerald-600' },
              { name: 'Transferencia Zelle', desc: 'USD · con referencia', color: 'text-blue-600' },
              { name: 'Divisas (USD Cash)', desc: 'Dólares en efectivo', color: 'text-blue-600' },
              { name: 'Efectivo Bs', desc: 'Bolívares en efectivo', color: 'text-amber-600' },
              { name: 'Pago Móvil', desc: 'Bolívares · con referencia', color: 'text-amber-600' },
              { name: 'Transferencia Bs', desc: 'Bolívares', color: 'text-amber-600' },
              { name: 'Abonos / Pagos parciales', desc: 'Cualquier método, cuando sea', color: 'text-violet-600' },
            ].map(m => (
              <div key={m.name} className="rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:bg-muted/40">
                <p className={`font-medium ${m.color}`}>{m.name}</p>
                <p className="text-xs mt-0.5">{m.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
