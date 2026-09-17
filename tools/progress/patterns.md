# Codebase Patterns

> Auto-consolidated learnings from loop iterations.
> Last updated: 2026-09-16T23:38:23.868Z

---

### Errores Recurrentes

- `[CRITICAL]` Riesgo de COBRO DUPLICADO en el asistente de cierre: si `add_service_payment` ya guardó el cobro y luego falla `update_service` (el cierre), el error se muestra pero el botón vuelve a habilitarse; el operario reintenta y el pago se registra OTRA VEZ sobre la misma orden. El estado `busy` solo protege del doble click inmediato, no del reintento tras un fallo parcial. (1)
  - `- `src/components/CierreServiceDialog.tsx → cerrar(): await api.addServicePayment(...) seguido de await api.updateService(...) en el mismo try; el catch solo hace setError(...)``
  - `- `El patrón correcto ya está planificado: close_service_delivery transaccional (F32 del spec)``
  - `- `tools/progress/specs/F30-asistente-cierre.md §4, salvaguarda «Cierre a medias»``

---

### Conventions

- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno. (1)
  - `CierreServiceDialog.tsx cambió a las 19:15, 19:24 y 19:31 durante esta sesión; Services.tsx a las 19:16 y 19:19`
  - `tools/verify_servicio_cierre.mjs (script de la otra sesión) se editó a las 19:37 con la app Tauri viva (pid registro 11168)`
  - `AGENTS.md → sección «Asistente de Cierre de Servicio (F30)» → lección CRÍTICA de coordinación`
  - Fix: Antes de editar: Get-Item <archivo> | Select LastWriteTime + Get-Process registro. Si el archivo cambió o la app está viva, trabajar en archivos NUEVOS (lib/módulos) y coordinar con el humano antes de tocar los archivos calientes.

---

### Conventions

- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno.
### Lecciones de F30 (asistente de cierre de servicio)
- **Un asistente sirve si dice lo que FALTA, no si muestra todo.** El valor está en mirar la orden y pedir solo el dato que falta (pantalla y/o cobro), con lo demás precargado: el operario del mostrador no puede recorrer un formulario de 5 pasos por cliente.
- **Cobrar y entregar son UN gesto, no dos.** Tener «Pago / Abono» y «Entregar» como diálogos separados obliga a 3 diálogos por cliente (cobrar → entregar → imprimir) y multiplica los errores. Un solo botón que registra el cobro y entrega, con la impresión opcional, es lo que el mostrador necesita.
- **La aritmética del dinero tiene que vivir en UN módulo compartido** (`lib/payment-math.ts`, con test de paridad): dos implementaciones de «moneda del campo vs moneda del método» divergen y el error se paga en caja. Cuando hay dos pantallas que cobran, la función va afuera.
- **Una entrega con saldo sin motivo es una fuga opaca:** bloquear el cierre hasta que el operario escriba por qué se lleva el equipo debiendo deja el rastro en la propia orden (`observations`), que es donde después se puede auditar.
- **`confirm()` del navegador NO bloquea en la ventana de la app** (WebView2 lo acepta solo): cualquier confirmación que deba frenar una acción destructiva tiene que ser **dentro del asistente** (Alerta con botones). Se comprobó a la mala: un aviso con `confirm()` se aceptó solo y vació el catálogo de la copia.
- **Los `\d` dentro de un template literal pierden la barra** (`/stock \d+/` se convierte en `/stock d+/` y el selector no encuentra nada): en los scripts CDP hay que escribir `\\d`.
- **Un botón deshabilitado puede deberse a MÁS de un requisito:** el caso «con el motivo ya debería poder cerrar» falló porque la orden también tenía pendiente la pantalla. Antes de declarar un bug, leer la condición completa que arma el `disabled`.
