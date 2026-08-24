import { useEffect, useRef, useState } from 'react';
import { BookOpen, CalendarCheck, CalendarDays, CircleDollarSign, ClipboardList, LifeBuoy, Package, Users, Wrench, HelpCircle, Settings2, ArrowRight, Wallet, LayoutDashboard, ShoppingBag, Lock, RefreshCw, RotateCcw, Printer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { api } from '../db';
import { checkForUpdate } from '@/lib/update';
import { isTauri } from '../db';

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
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-700">
          <span className="font-semibold">Descuento por pago en efectivo:</span> al elegir el producto en <Badge variant="outline">Divisas (USD Cash)</Badge>, el sistema sugiere automáticamente el <span className="font-medium">precio contado</span> (el "Efectivo ($)" del producto) y muestra el descuento respecto al precio lista. El monto guardado es lo que el cliente paga de verdad y la venta queda registrada en el Libro Diario. Si el cliente paga por otro método, se cobra el precio completo.
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
        <p className="text-sm">El registro es un <span className="font-medium text-foreground">asistente paso a paso</span>: un paso por pantalla con botones <Badge variant="outline">Siguiente</Badge> / <Badge variant="outline">Anterior</Badge>, y la barra superior te muestra en qué paso vas (los pasos ya completados se pueden tocar para volver).</p>
        <ol className="list-decimal list-inside space-y-1">
          <li><span className="font-medium text-foreground">Paso Cliente:</span> escribe el nombre o la <span className="font-medium text-foreground">cédula</span> (V-12345678): las sugerencias muestran la cédula primero y, si la cédula existe, se <span className="font-medium text-foreground">autocompleta al salir del campo</span> — con su historial de servicios. Si no existe, se registra como cliente nuevo (la cédula es obligatoria). Aquí también asignas el <span className="font-medium text-foreground">técnico responsable</span> (botón <Badge variant="outline">Técnicos</Badge>).</li>
          <li><span className="font-medium text-foreground">Paso Equipos:</span> escribe el modelo (se sugieren los <span className="font-medium text-foreground">modelos del catálogo</span> con repuestos y stock), el monto (precio del servicio), color y marca los <span className="font-medium text-foreground">trabajos / fallas</span> (puedes elegir varios). Términos del taller ya incluidos: <Badge variant="outline">Placa de carga</Badge>, <Badge variant="outline">Pegado de pantalla</Badge>, <Badge variant="outline">Reemplazo de botones</Badge>, <Badge variant="outline">Preparación de carcasa</Badge>, <Badge variant="outline">Cambio de bandeja SIM</Badge>, <Badge variant="outline">Pin de Carga</Badge>, <Badge variant="outline">Revisión</Badge> y <Badge variant="outline">Otro</Badge> (trabajo libre). Puedes registrar hasta 10 equipos en una sola orden.</li>
          <li><span className="font-medium text-foreground">Paso Blindaje:</span> checklist Sí/No del estado del equipo al recibirlo (protege de reclamos). <span className="font-medium text-foreground">Chip (SIM)</span> y <span className="font-medium text-foreground">Forro / funda</span> vienen marcados en <Badge variant="outline" className="border-danger/40 text-danger">No</Badge> (normalmente se le entregan al cliente) — cámbialos a "Sí" solo si los deja en el equipo. Los demás ítems quedan sin marcar: los decide el operario. El recibo deja todo por escrito.</li>
          <li><span className="font-medium text-foreground">Paso Revisar y guardar:</span> resumen de la orden (cliente, equipos, trabajos, descuentos, total) antes de guardar. Al editar una orden hay 5 pasos: Cliente, Equipo, Blindaje, Finanzas (método/estado) y Cierre (fecha de salida, observaciones y pagos).</li>
        </ol>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-700">
          <span className="font-semibold">Descuento:</span> escribe el <span className="font-medium">precio del servicio</span> en "Monto ($)" y lo que le rebajas en <span className="font-medium">Descuento ($)</span> — el <span className="font-medium text-foreground">total a pagar se calcula solo</span> (Precio − Descuento) y es lo que queda guardado, en el recibo y en el saldo. El descuento aplica con <span className="font-medium text-foreground">cualquier método de pago</span> (efectivo, Pago Móvil, Punto, Zelle...) y se conserva aunque cambies el método.
        </div>
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
    value: 'dia',
    icon: CalendarDays,
    title: 'El día de trabajo (cómo funciona)',
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    content: (
      <div className="space-y-2">
        <div className="rounded-md bg-teal-500/10 border border-teal-500/30 px-3 py-2 text-sm text-teal-700">
          <span className="font-semibold">Regla de oro:</span> el día de la caja es una cosa y los servicios son otra. Cerrar el día NO borra ni archiva los servicios pendientes: solo cierra el conteo de ese día.
        </div>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Al abrir el día en <span className="font-medium text-foreground">Libro Diario</span> la caja empieza de cero. Los equipos que quedaron en taller ayer <span className="font-medium text-foreground">siguen activos</span> (se ven al entrar a Servicios: el filtro "Activos en taller").</li>
          <li>Un cliente dejó el teléfono hace 3 días y viene hoy a retirar: búscalo en <span className="font-medium text-foreground">Servicios</span> (por nombre, cédula u orden). La tarjeta muestra si tiene saldo pendiente.</li>
          <li>Si le falta pagar algo → botón <Badge variant="outline">Pago / Abono</Badge>: ese abono se registra <span className="font-medium text-foreground">con la fecha de hoy</span>, aunque el equipo haya entrado hace días. Luego botón <Badge variant="default" className="bg-success">Entregar</Badge> (o entregar con saldo pendiente, si quedó a deber).</li>
          <li>Si el cliente se arrepiente o reclama y hay que <span className="font-medium text-foreground">devolverle el dinero</span> → botón rojo <Badge variant="outline" className="border-danger/40 text-danger">Devolución</Badge> en la tarjeta (aparece cuando la orden tiene algo abonado): registras el reembolso (total o parcial), el estado pasa a <Badge variant="outline">Devuelto</Badge> y el monto se <span className="font-medium text-foreground">resta del Libro Diario</span> del día — la caja cuadra.</li>
          <li>Todo lo cobrado hoy (ventas + abonos + entregas) cuenta en <span className="font-medium text-foreground">Libro Diario</span> del día de hoy, no en el día en que entró el equipo.</li>
          <li>En <span className="font-medium text-foreground">Ventas</span> el período abre en "Hoy" por defecto: ves lo vendido hoy y nada más. Cambia a "Todo" o una fecha para ver el resto.</li>
        </ol>
        <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-sm">
          <span className="font-semibold text-foreground">Recuerda:</span> el Libro Diario muestra la tarjeta <span className="font-medium">"Resumen del día"</span> con recibidos/entregados de hoy, equipos en taller y lo cobrado hoy. El Dashboard suma todo igual que el Libro Diario.
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
          <li>Abre el servicio en edición → panel <Badge variant="outline">Pagos y Abonos</Badge>.</li>
          <li>Pulsa <Badge variant="outline">Registrar Pago / Abono</Badge> — monto, método de pago, referencia y notas.</li>
          <li>El campo de monto tiene un selector <Badge variant="outline">$ / Bs.</Badge>: escribe el monto en la moneda que dice el cliente. Si el método es en bolívares (Punto Bs, Pago Móvil...) y el cliente dice <span className="font-medium text-foreground">"7000 Bs."</span>, déjalo en Bs. y escribe 7000 (verás ≈ $); si dice <span className="font-medium text-foreground">"$20"</span>, toca $ y escribe 20. Al cambiar de método o de moneda, el valor se convierte solo con la tasa BCV del día. Botones rápidos $5/$10/$15/$20 (o Bs. 5.000/10.000/15.000/20.000) y <Badge variant="outline">Todo el saldo</Badge>.</li>
          <li>Si el día se abrió <span className="font-medium text-foreground">sin tasa BCV</span>, el dialog de abono te lo avisa y bloquea el pago en Bs (evita errores de conversión). Solución: en <Badge variant="outline">Libro Diario</Badge> el banner verde tiene el botón <Badge variant="outline">Actualizar día</Badge> — escribe la tasa y guarda, sin cerrar el día.</li>
          <li>El saldo pendiente se calcula convirtiendo lo abonado en Bs. a $ con la tasa del día del pago: verás <span className="font-medium text-foreground">"Abonado $2.68 + Bs. 2010.00 · Saldo $47.32 pendiente"</span>.</li>
          <li>Cada abono cuenta en el Libro Diario el día que se recibe, en su moneda. Los abonos se pueden eliminar (el saldo se recalcula).</li>
          <li>Puedes entregar el equipo con saldo pendiente: la deuda queda visible en rojo en la orden y en el historial del cliente.</li>
        </ol>
        <div className="rounded-md bg-violet-500/10 border border-violet-500/30 px-3 py-2 text-sm text-violet-700">
          <span className="font-semibold">Cliente inteligente:</span> la primera vez se registra solo. La segunda vez, escribe el nombre o la cédula y sus datos aparecen automáticamente — nunca se duplica.
        </div>
        <div className="rounded-md bg-danger/10 border border-danger/30 px-3 py-2 text-sm text-danger">
          <span className="font-semibold">Devolución de dinero:</span> si hay que devolver lo abonado (cliente que no quiso la reparación, garantía, reclamo), pulsa el botón rojo <Badge variant="outline" className="border-danger/40 text-danger">Devolución</Badge> de la tarjeta. El dialog sugiere devolver <span className="font-medium text-foreground">todo lo abonado</span> (puedes escribir menos), el método de devolución (mismo del cobro por defecto, en Bs. con la tasa BCV si aplica), referencia y nota. Al confirmar: el reembolso aparece en el historial de pagos como <span className="font-medium text-foreground">Devolución</span> en rojo, el estado de la orden pasa a <Badge variant="outline">Devuelto</Badge> y el monto <span className="font-medium text-foreground">se resta del Libro Diario</span> del día (método elegido) — el cierre de caja cuadra. Solo puedes devolver hasta lo abonado y requiere día abierto. Si el equipo se entregó <span className="font-medium text-foreground">sin que el cliente pagara</span>, el dialog ofrece "Devolver sin reembolso": solo marca la orden como Devuelto (sin dinero de por medio, no necesita día abierto).
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
    value: 'impresora',
    icon: Printer,
    title: 'Impresora de tickets (HPRT MPT-II)',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    content: (
      <div className="space-y-2">
        <p>Las <span className="font-medium text-foreground">órdenes de servicio</span> se imprimen en una impresora térmica. Funciona de dos formas: con el <span className="font-medium text-foreground">driver de Windows</span> (recomendado, ej. HPRT MPT-II) o por <span className="font-medium text-foreground">puerto COM directo</span> (impresoras USB/Bluetooth).</p>
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">Instalar el driver HPRT MPT-II (una vez por PC):</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Conecta la impresora por <span className="font-medium text-foreground">USB</span> y enciéndela.</li>
            <li>Instala el driver oficial de HPRT que viene con la impresora (MPT-II / "IMPRESORA USB"). Windows crea una impresora llamada <code className="rounded bg-muted px-1.5 py-0.5 text-xs">HPRT MPT-II</code>.</li>
            <li>Abre la app → botón <Badge variant="outline">Impresora</Badge> (en Servicio Técnico) → en <span className="font-medium text-foreground">"Impresora de Windows"</span> verás el nombre y puedes pulsar <Badge variant="outline">Imprimir prueba</Badge>.</li>
            <li>Si el ticket sale, listo: cada orden tendrá su botón <Badge variant="outline">Orden</Badge> (o <Badge variant="outline">Reimprimir</Badge>) para imprimir el recibo del servicio — parte superior para el cliente y talón recortable ("CORTA TIJERA") con los mismos datos para pegar detrás del teléfono.</li>
            <li><span className="font-medium text-foreground">El recibo es claro:</span> muestra el <span className="font-medium text-foreground">TOTAL</span> del trabajo, lo <span className="font-medium text-foreground">PAGADO</span> (con su moneda real, $ o Bs.), lo que <span className="font-medium text-foreground">FALTA</span> por pagar (si aplica) o <span className="font-medium text-foreground">CANCELADO</span>, y el <span className="font-medium text-foreground">método de pago real</span> usado (si pagó por Pago Móvil, el recibo dice PAGO MOVIL aunque el form diga otra cosa). Los abonos aparecen con su moneda real ($ + Bs.) y el checklist de blindaje se imprime en <span className="font-medium text-foreground">2 columnas</span> para aprovechar el papel.</li>
            <li>¿Logo arriba del ticket? En <Badge variant="outline">Impresora</Badge> → <span className="font-medium text-foreground">Logo del ticket</span>: pulsa <Badge variant="outline">Logo de prueba</Badge> (se genera uno solo para probar) o <Badge variant="outline">Subir imagen</Badge> con tu logo (ej. el diseño con la mano y el rayo). Se imprime en negro sobre blanco, sin degradados.</li>
          </ol>
        </div>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-700">
          <span className="font-semibold">Si no aparece en la lista:</span> revisa que el driver esté instalado (Configuración de Windows → Dispositivos → Impresoras y escáneres) y que la impresora esté <span className="font-medium">encendida y conectada por USB</span>. Si usas un modelo Bluetooth (ej. MP58-04BLE), páréala en Windows: Configuración → Bluetooth y dispositivos; luego pulsa <Badge variant="outline">Detectar</Badge> en la app — debe aparecer como "COMx — Bluetooth · MP58-04BLE".
        </div>
        <div className="rounded-md bg-slate-500/10 border border-slate-500/30 px-3 py-2 text-sm">
          <span className="font-semibold text-foreground">Papel:</span> elige el ancho del rollo (58 mm o 80 mm) en <span className="font-medium text-foreground">Ancho del papel</span>. Si el ticket sale con letras cortadas o demasiado estrecho, cambia ese ajuste y vuelve a imprimir la prueba.
        </div>
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
          <p className="font-medium text-foreground">Buscar y conciliar pagos:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>En la pestaña <Badge variant="outline">Pagos</Badge> puedes buscar por rango de fechas, método de pago, cliente/cédula, referencia o moneda. Se muestra una tabla con todos los pagos que coinciden, incluyendo orden, cliente, modelo, monto y referencia.</li>
            <li>En la pestaña <Badge variant="outline">Diario</Badge>, las celdas de monto de cada método son <span className="font-medium text-foreground">clickeables</span> — al hacer clic se abre un desglose con cada pago individual de ese día y método (hora, orden, cliente, equipo, monto, referencia).</li>
            <li>Para <span className="font-medium text-foreground">conciliar</span>: compara lo que imprime la máquina con lo que dice el sistema. Si hay diferencia, revisa el desglose del día/método afectado línea por línea.</li>
          </ol>
        </div>
        <div className="space-y-1.5">
          <p className="font-medium text-foreground">Exportar Excel (día específico o mes completo):</p>
          <p><Badge variant="outline">Exportar Excel</Badge> genera un Excel profesional (<code className="rounded bg-muted px-1.5 py-0.5 text-xs">.xlsx</code>) en <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Documentos\Registro</code> con el rango <Badge variant="outline">Desde / Hasta</Badge> visible arriba: pon la misma fecha en ambos para un día exacto, o deja el rango del mes para el mes completo. Contiene 6 hojas con filtros (clic en las flechas de las columnas): <span className="font-medium text-foreground">Resumen</span> (totales por día y por método), <span className="font-medium text-foreground">Cierres</span> (apertura, arqueo, diferencia), <span className="font-medium text-foreground">Ventas</span> (cliente, cédula, producto, monto, método), <span className="font-medium text-foreground">Servicios</span> (técnico, trabajos, saldo, pantalla instalada), <span className="font-medium text-foreground">Pagos y Abonos</span> y <span className="font-medium text-foreground">Movimientos</span>. Las filas <span className="font-medium text-foreground">TOTAL (filtrado)</span> se recalculan al filtrar (ej. un solo cliente).</p>
          <p><span className="font-medium text-foreground">Requisito:</span> la PC necesita Python 3 con <code className="rounded bg-muted px-1.5 py-0.5 text-xs">pip install openpyxl</code> (una sola vez). Si no está, la app genera el CSV clásico como respaldo automático.</p>
          <p className="text-xs text-muted-foreground mt-1">Si tienes otras PCs con la app, necesitan la <span className="font-medium">misma versión</span> o una reinstalación del instalador para tener esta función. La actualización automática lo hace si la versión nueva ya está publicada.</p>
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
          <p>Escríbela manualmente al abrir el día. La tasa queda guardada en el cierre y se usa para convertir los pagos en bolívares. Si el día ya está abierto con tasa en 0, no hace falta cerrarlo: pulsa <Badge variant="outline">Actualizar día</Badge> en el banner verde del Libro Diario y corrige la tasa.</p>
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
  {
    value: 'actualizaciones',
    icon: RefreshCw,
    title: 'Actualizaciones y versiones',
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    content: (
      <div className="space-y-3">
        <div>
          <p className="font-medium text-foreground">¿Cuándo se revisa si hay una versión nueva?</p>
          <p>Al <span className="font-medium text-foreground">abrir la aplicación</span> (solo una vez al arrancar, en silencio) o pulsando <Badge variant="outline">Revisar actualizaciones</Badge> aquí arriba. No hay avisos en segundo plano: si la app ya está abierta desde antes, reiníciala para revisar.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Por qué a veces no llega la actualización?</p>
          <p>Se necesitan tres cosas: (1) que exista una <span className="font-medium text-foreground">versión publicada</span> más nueva (se publica desde la PC del desarrollo, no desde la tienda); (2) <span className="font-medium text-foreground">internet que alcance GitHub</span> (si GitHub está bloqueado no llega; hay respaldo opcional por Google Drive); y (3) abrir la app. Si ya tienes la última versión publicada, el botón dirá "Ya tienes la última versión".</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Qué pasa al instalar?</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Se hace un <span className="font-medium text-foreground">respaldo automático</span> de la base de datos y de la versión actual.</li>
            <li>Se descarga e instala; la app se cierra y <span className="font-medium text-foreground">vuelve a abrir sola</span>.</li>
            <li>Al arrancar, la versión nueva <span className="font-medium text-foreground">verifica la base de datos</span>; si algo fallara, restaura la versión anterior automáticamente.</li>
          </ol>
          <p className="text-xs text-muted-foreground">Tus datos (registro.db) y el PIN nunca se tocan en una actualización.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">"Ver más tarde"</p>
          <p>Descarga la actualización en segundo plano y, la próxima vez que abras la app, te recuerda que ya está lista para instalar.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">¿Volver a una versión anterior?</p>
          <p>Usa <Badge variant="outline">Restaurar versión anterior</Badge> (disponible si existe un respaldo previo). Se restaura el programa, no tus datos.</p>
        </div>
      </div>
    ),
  },
  {
    value: 'atajos',
    icon: Settings2,
    title: 'Atajos de teclado',
    color: 'text-slate-600',
    bg: 'bg-slate-50',
    content: (
      <div className="space-y-3">
        <p>Trabaja sin el mouse en las tareas de todos los días:</p>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <Badge variant="outline">N</Badge> o <Badge variant="outline">F2</Badge>
            <span>— abrir <span className="font-medium text-foreground">Nuevo Servicio</span> (desde la pantalla de Servicios)</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge variant="outline">/</Badge>
            <span>— enfocar el buscador de <span className="font-medium text-foreground">Servicios</span></span>
          </li>
          <li className="flex items-center gap-2">
            <Badge variant="outline">Ctrl + Enter</Badge>
            <span>— guardar / registrar (Servicio, Venta, Pago/Abono, imprimir recibo)</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge variant="outline">Alt + 1..9</Badge>
            <span>— cambiar de pantalla (1 Dashboard, 2 Ventas, 3 Servicios, 4 Inventario, 5 Pantallas, 6 Pedidos, 7 Clientes, 8 Libro Diario, 9 Ayuda)</span>
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">Los atajos no interfieren mientras escribes en un campo.</p>
      </div>
    ),
  },
  {
    value: 'pendientes',
    icon: LifeBuoy,
    title: 'Pendientes y limitaciones conocidas',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    content: (
      <div className="space-y-3">
        <p className="text-sm">Esto es lo que <span className="font-medium text-foreground">aún no está resuelto</span> o funciona con limitaciones — para que no te tomen por sorpresa:</p>
        <ul className="list-disc list-inside space-y-1.5 text-sm">
          <li><span className="font-medium text-foreground">Nueva versión sin publicar:</span> el asistente paso a paso (wizard), los términos nuevos del taller y el aviso de tasa BCV ya están desarrollados y probados, pero <span className="font-medium text-foreground">aún no se han instalado en la tienda</span> — llegan con la próxima actualización (ver <Badge variant="outline">Actualizaciones y versiones</Badge>).</li>
          <li><span className="font-medium text-foreground">Tasa BCV sin internet:</span> el botón <Badge variant="outline">Auto BCV</Badge> necesita conexión. Sin internet la tasa se escribe a mano al abrir el día, y si el día ya está abierto con tasa 0 se corrige con <Badge variant="outline">Actualizar día</Badge> en el Libro Diario. Hasta corregirla, los pagos en bolívares quedan bloqueados (con aviso).</li>
          <li><span className="font-medium text-foreground">Respaldo manual:</span> la base de datos no se sincroniza sola a la nube — para respaldar, copia el archivo <code className="rounded bg-muted px-1.5 py-0.5 text-xs">registro.db</code> (junto al programa) a un USB o nube.</li>
          <li><span className="font-medium text-foreground">Exportar Excel:</span> requiere Python 3 instalado en la computadora con el paquete <code className="rounded bg-muted px-1.5 py-0.5 text-xs">openpyxl</code>. Si no está, el sistema genera el respaldo en CSV.</li>
          <li><span className="font-medium text-foreground">Impresora por Bluetooth:</span> la impresora BT debe estar <span className="font-medium">encendida y pareada</span> en Windows antes de imprimir; si se conecta por USB con el driver instalado (HPRT MPT-II), funciona directo desde <Badge variant="outline">Impresora</Badge>.</li>
          <li><span className="font-medium text-foreground">Garantía de 7 días corridos:</span> se calcula desde la fecha de entrega y no se pausa por fines de semana ni días feriados. La garantía cubre el trabajo realizado, no daños físicos nuevos.</li>
          <li><span className="font-medium text-foreground">Pantalla exacta obligatoria:</span> si un trabajo es "Cambio pantalla" y el modelo tiene pantallas en el catálogo, hay que elegir cuál se instala (Incell, Original…) antes de guardar — es a propósito, para que el inventario nunca se descuente mal.</li>
          <li><span className="font-medium text-foreground">Sin conexión a otros dispositivos:</span> la app es local a una computadora; si se usa en otra PC, los datos no se comparten (se pueden llevar con respaldo/importación manual).</li>
        </ul>
      </div>
    ),
  },
];

const quickActions = [
  {
    icon: CircleDollarSign, label: 'Vender una pantalla', desc: 'Ventas → Nueva Venta', target: 'venta',
    color: 'text-emerald-600', chip: 'bg-emerald-500/15 ring-emerald-500/25',
    bar: 'from-emerald-500/70 via-emerald-400/30 to-transparent', hover: 'hover:border-emerald-500/40 hover:shadow-emerald-500/10',
  },
  {
    icon: Wrench, label: 'Registrar un equipo', desc: 'Servicio Técnico → Nuevo Servicio', target: 'servicio',
    color: 'text-orange-600', chip: 'bg-orange-500/15 ring-orange-500/25',
    bar: 'from-orange-500/70 via-orange-400/30 to-transparent', hover: 'hover:border-orange-500/40 hover:shadow-orange-500/10',
  },
  {
    icon: Wallet, label: 'Cobrar un abono', desc: 'Tarjeta del servicio → Pago / Abono', target: 'abonos',
    color: 'text-violet-600', chip: 'bg-violet-500/15 ring-violet-500/25',
    bar: 'from-violet-500/70 via-violet-400/30 to-transparent', hover: 'hover:border-violet-500/40 hover:shadow-violet-500/10',
  },
  {
    icon: CalendarCheck, label: 'Abrir el día', desc: 'Libro Diario → Abrir Día', target: 'libro',
    color: 'text-purple-600', chip: 'bg-purple-500/15 ring-purple-500/25',
    bar: 'from-purple-500/70 via-purple-400/30 to-transparent', hover: 'hover:border-purple-500/40 hover:shadow-purple-500/10',
    gradient: 'from-purple-500/10 via-background to-background', featured: true,
  },
  {
    icon: ShoppingBag, label: 'Reponer stock', desc: 'Pedidos → Pedir N', target: 'pedidos',
    color: 'text-rose-600', chip: 'bg-rose-500/15 ring-rose-500/25',
    bar: 'from-rose-500/70 via-rose-400/30 to-transparent', hover: 'hover:border-rose-500/40 hover:shadow-rose-500/10',
  },
  {
    icon: Printer, label: 'Configurar la impresora', desc: 'Instalar driver HPRT MPT-II y probar el ticket', target: 'impresora',
    color: 'text-slate-600', chip: 'bg-slate-500/15 ring-slate-500/25',
    bar: 'from-slate-500/70 via-slate-400/30 to-transparent', hover: 'hover:border-slate-500/40 hover:shadow-slate-500/10',
  },
  {
    icon: LayoutDashboard, label: 'Ver el negocio', desc: 'Dashboard → Actualizar', target: 'dashboard',
    color: 'text-sky-600', chip: 'bg-sky-500/15 ring-sky-500/25',
    bar: 'from-sky-500/70 via-sky-400/30 to-transparent', hover: 'hover:border-sky-500/40 hover:shadow-sky-500/10',
    gradient: 'from-sky-500/10 via-background to-background', featured: true,
  },
];

export default function Help() {
  const [appVersion, setAppVersion] = useState('');
  const [hasPrev, setHasPrev] = useState(false);
  const [checking, setChecking] = useState(false);
  const [openSection, setOpenSection] = useState('inicio');
  const guideRef = useRef<HTMLDivElement>(null);

  const openGuide = (target: string) => {
    setOpenSection(target);
    requestAnimationFrame(() => {
      guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(m => m.getVersion().then(v => setAppVersion(`v${v}`)).catch(() => {}))
      .catch(() => {});
    api.hasPreviousVersion().then(setHasPrev).catch(() => {});
  }, []);

  const checkUpdates = async () => {
    if (!isTauri) {
      toast.info('Solo disponible en la app instalada');
      return;
    }
    setChecking(true);
    try {
      const update = await checkForUpdate();
      if (update) {
        window.dispatchEvent(new CustomEvent('registro:check-update'));
      } else {
        toast.success('Ya tienes la última versión');
      }
    } finally {
      setChecking(false);
    }
  };

  const doRollback = async () => {
    try {
      await api.rollbackUpdate();
      toast.info('Restaurando versión anterior… la app se reiniciará');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Ayuda</h1>
          <p className="text-sm text-muted-foreground mt-1">Elige qué quieres hacer — te mostramos el paso a paso</p>
        </div>
        <div className="flex items-center gap-3">
          {isTauri && (
            <>
              {hasPrev && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <RotateCcw className="size-4" /> Restaurar versión anterior
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Restaurar la versión anterior?</AlertDialogTitle>
                      <AlertDialogDescription>
                        La app volverá a la versión anterior instalada. Tus datos (registro.db)
                        y el PIN no se tocan. Se reiniciará automáticamente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={doRollback}>Restaurar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button variant="outline" size="sm" onClick={checkUpdates} disabled={checking}>
                <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} /> Revisar actualizaciones
              </Button>
            </>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <LifeBuoy className="size-5" />
            <span className="text-sm">{appVersion || 'v0.1.1'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickActions.map(a => {
          const Icon = a.icon;
          return (
            <div
              key={a.label}
              role="button"
              tabIndex={0}
              onClick={() => openGuide(a.target)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGuide(a.target); } }}
              className={`group relative overflow-hidden rounded-2xl border border-border/70 ${a.featured ? `md:col-span-2 lg:col-span-2 bg-gradient-to-br ${a.gradient}` : ''} bg-card ${a.featured ? 'p-6' : 'p-5'} transition-all duration-200 hover:-translate-y-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${a.hover}`}
            >
              <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${a.bar}`} />
              <div className="flex items-start justify-between">
                <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${a.chip}`}>
                  <Icon className={`size-5 ${a.color}`} />
                </span>
                <ArrowRight className="size-4 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-1 group-hover:text-primary" />
              </div>
              <p className={`mt-4 font-semibold text-foreground ${a.featured ? 'text-base' : 'text-sm'}`}>{a.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{a.desc}</p>
              <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary/70 transition-colors group-hover:text-primary">
                Ver guía paso a paso
                <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </p>
            </div>
          );
        })}
      </div>

      <Card ref={guideRef} className="overflow-hidden scroll-mt-6">
        <CardHeader className="bg-gradient-to-r from-primary/5 via-transparent to-transparent border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" /> Guía completa
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-4">
          <Accordion type="single" collapsible value={openSection} onValueChange={setOpenSection} className="w-full">
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
