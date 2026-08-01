import { BookOpen, CalendarCheck, CircleDollarSign, ClipboardList, LifeBuoy, Package, Users, Wrench, HelpCircle, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';

const sections = [
  {
    value: 'inicio',
    icon: HelpCircle,
    title: 'Primeros pasos',
    color: 'text-primary',
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
    value: 'inventario',
    icon: Package,
    title: 'Inventario y Pantallas',
    color: 'text-blue-600',
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
    content: (
      <p>Gestiona tus clientes con su historial de compras y servicios. Al registrar una venta o servicio con un nombre, el cliente se crea o actualiza automáticamente.</p>
    ),
  },
  {
    value: 'consejos',
    icon: Settings2,
    title: 'Consejos y preguntas frecuentes',
    color: 'text-slate-600',
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
          <p>Sí — edita el registro y guarda. Si era un servicio entregado y lo cambias, el stock se ajusta solo.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Cómo sé qué pantallas tengo en stock?</p>
          <p>En <Badge variant="outline">Pantallas</Badge> o en el Dashboard (Stock Bajo). Al buscar un producto en una venta también ves el stock en vivo.</p>
        </div>
      </div>
    ),
  },
];

export default function Help() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Ayuda</h1>
          <p className="text-sm text-muted-foreground mt-1">Guía de uso de la aplicación</p>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <LifeBuoy className="size-5" />
          <span className="text-sm">v0.3</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {sections.slice(0, 4).map(s => {
          const Icon = s.icon;
          return (
            <Card key={s.value}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Icon className={`size-4 ${s.color}`} /> {s.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {s.content}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" /> Guía completa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible defaultValue="inicio" className="w-full">
            {sections.map(s => {
              const Icon = s.icon;
              return (
                <AccordionItem key={s.value} value={s.value}>
                  <AccordionTrigger className="gap-3">
                    <span className="flex items-center gap-2">
                      <Icon className={`size-4 ${s.color}`} /> {s.title}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
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
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Punto de Venta ($)</p>
              <p className="text-xs">USD · con comisión</p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Punto de Venta (Bs)</p>
              <p className="text-xs">Bolívares · con comisión</p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Transferencia Zelle</p>
              <p className="text-xs">USD · con referencia</p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Divisas (USD Cash)</p>
              <p className="text-xs">Dólares en efectivo</p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Efectivo Bs</p>
              <p className="text-xs">Bolívares en efectivo</p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Pago Móvil</p>
              <p className="text-xs">Bolívares</p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Transferencia Bs</p>
              <p className="text-xs">Bolívares</p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Smartphone</p>
              <p className="text-xs">Venta de equipos completos</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
