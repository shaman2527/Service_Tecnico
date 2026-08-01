import { BookOpen, CalendarCheck, CircleDollarSign, ClipboardList, LifeBuoy, Package, Users, Wrench, HelpCircle, Settings2, ArrowRight, Wallet } from 'lucide-react';
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
            <li>Abre el día en <Badge variant="outline">Libro Diario</Badge> (con la tasa BCV del día).</li>
            <li>Registra las ventas de pantallas en <Badge variant="outline">Ventas</Badge>.</li>
            <li>Registra los equipos que entran en <Badge variant="outline">Servicio Técnico</Badge>.</li>
            <li>Al entregar un servicio, márcalo como <Badge variant="outline">Entregado</Badge> — la pantalla se descuenta del inventario automáticamente.</li>
            <li>Al cierre del día, <Badge variant="outline">Cierra el día</Badge> en Libro Diario con el arqueo real de caja.</li>
          </ol>
        </div>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-700">
          <span className="font-semibold">Importante:</span> sin un día abierto no se pueden registrar ventas ni servicios. Abre el día primero.
        </div>
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
          <li>Selecciona la cantidad y el método de pago (Punto de Venta $/Bs, Zelle, Divisas USD, Efectivo Bs, Pago Móvil, Transferencia Bs).</li>
          <li>Pulsa <Badge variant="outline">Guardar Venta</Badge> — el stock se descuenta automáticamente.</li>
        </ol>
        <p className="text-sm">Para Punto de Venta puedes indicar el % de comisión y para Zelle el número de referencia.</p>
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
          <li><Badge variant="outline">Nuevo Servicio</Badge> → datos del cliente (nombre, teléfono, cédula, dirección).</li>
          <li>Escribe el modelo del equipo — se sugieren los modelos del catálogo con su stock y precio.</li>
          <li>Indica el tipo de trabajo (cambio de pantalla, batería, etc.) y la falla.</li>
          <li>Marca el <span className="font-medium text-foreground">checklist de blindaje</span> (Sí/No) — el estado real del equipo al recibirlo te protege de reclamos.</li>
          <li>Guarda el servicio. El estado va: Recibido → En reparación → … → Por entregar → <Badge variant="default" className="bg-success">Entregado</Badge>.</li>
        </ol>
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-700">
          <span className="font-semibold">Inventario automático:</span> al marcar <Badge variant="outline">Entregado</Badge> se descuenta 1 de la pantalla correspondiente. Si reabres el servicio, el stock se devuelve. Si el modelo no existe en el catálogo, se crea automáticamente.
        </div>
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
          <li>Al crear el servicio, el campo <Badge variant="outline">Cliente</Badge> te sugiere los ya registrados y autocompleta sus datos.</li>
          <li>Abre el servicio en edición → panel <Badge variant="outline">Pagos y Abonos</Badge>.</li>
          <li>Pulsa <Badge variant="outline">Registrar Pago / Abono</Badge> — monto, método de pago y notas. Cada abono cuenta en el Libro Diario el día que se recibe.</li>
          <li>El saldo pendiente se ve en la orden (rojo) y en el historial del cliente. Puedes entregar el equipo con saldo pendiente (queda la deuda registrada).</li>
        </ol>
        <div className="rounded-md bg-violet-500/10 border border-violet-500/30 px-3 py-2 text-sm text-violet-700">
          <span className="font-semibold">Cliente inteligente:</span> la primera vez se registra solo. La segunda vez, escribe el nombre y sus datos aparecen automáticamente — nunca se duplica.
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
        <p><Badge variant="outline">Inventario</Badge> muestra todos los productos con su stock, costo y compatibilidad. <Badge variant="outline">Pantallas</Badge> filtra solo la categoría de pantallas.</p>
        <p>Cada pantalla puede ser compatible con varios modelos — verás los modelos como chips. Al vender o entregar un servicio, el stock se actualiza solo.</p>
        <p>Los productos con stock bajo (menor al mínimo) aparecen en el <Badge variant="outline">Dashboard</Badge>.</p>
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
          <p>Pulsa <Badge variant="outline">Abrir Día</Badge>, ingresa el efectivo de apertura y la tasa BCV. El botón <Badge variant="outline">Auto BCV</Badge> obtiene la tasa oficial automáticamente (necesita internet); si falla, escríbela a mano.</p>
        </div>
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">Cerrar el día:</p>
          <p>Pulsa <Badge variant="outline">Cerrar Día</Badge>. Verás los totales esperados por método de pago (Punto, Efectivo, Zelle, Pago Móvil, Transferencia) y podrás registrar el <span className="font-medium text-foreground">arqueo real</span> (lo que realmente hay en caja). La diferencia se calcula en vivo y queda guardada. Desde la pestaña <Badge variant="outline">Cierres</Badge> puedes liquidar el Punto y reabrir un día si te equivocaste.</p>
        </div>
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
      <p>Gestiona tus clientes con su historial de compras, servicios y abonos. Al registrar una venta o servicio con un nombre, el cliente se crea o actualiza automáticamente — su historial queda guardado para la próxima visita.</p>
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
          <p>Escríbela manualmente al abrir el día. La tasa queda guardada en el cierre.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Puedo corregir una venta o servicio?</p>
          <p>Sí — edita el registro y guarda. Si era un servicio entregado y lo cambias, el stock se ajusta solo. Los abonos se pueden eliminar y el saldo se recalcula.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Cómo sé qué pantallas tengo en stock?</p>
          <p>En <Badge variant="outline">Pantallas</Badge> o en el Dashboard (Stock Bajo). Al buscar un producto en una venta también ves el stock en vivo.</p>
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
          <span className="text-sm">v0.3</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            <BookOpen className="size-4" /> Sobre los métodos de pago
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: 'Punto de Venta ($)', desc: 'USD · con comisión', color: 'text-emerald-600' },
              { name: 'Punto de Venta (Bs)', desc: 'Bolívares · con comisión', color: 'text-emerald-600' },
              { name: 'Transferencia Zelle', desc: 'USD · con referencia', color: 'text-blue-600' },
              { name: 'Divisas (USD Cash)', desc: 'Dólares en efectivo', color: 'text-blue-600' },
              { name: 'Efectivo Bs', desc: 'Bolívares en efectivo', color: 'text-amber-600' },
              { name: 'Pago Móvil', desc: 'Bolívares', color: 'text-amber-600' },
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
