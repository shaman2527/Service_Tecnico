# Codebase Patterns

> Auto-consolidated learnings from loop iterations.
> Last updated: 2026-09-17T01:04:41.895Z

---

### Errores Recurrentes

- `[CRITICAL]` Riesgo de COBRO DUPLICADO en el asistente de cierre: si `add_service_payment` ya guardó el cobro y luego falla `update_service` (el cierre), el error se muestra pero el botón vuelve a habilitarse; el operario reintenta y el pago se registra OTRA VEZ sobre la misma orden. El estado `busy` solo protege del doble click inmediato, no del reintento tras un fallo parcial. (1)
  - `- `- `- `src/components/CierreServiceDialog.tsx → cerrar(): await api.addServicePayment(...) seguido de await api.updateService(...) en el mismo try; el catch solo hace setError(...)````
  - `- `- `- `El patrón correcto ya está planificado: close_service_delivery transaccional (F32 del spec)````
  - `- `- `- `tools/progress/specs/F30-asistente-cierre.md §4, salvaguarda «Cierre a medias»````
- `[HIGH]` Publicitar un atajo de teclado sin cerrar sus puertas: F31 mostró «Ctrl+Enter guarda» en el pie del wizard y el atajo llamaba a save() SIN los gates que sí tenía el botón (cédula obligatoria del cliente nuevo, día abierto, guardado en curso) → se podía guardar un cliente sin cédula (el dato que va impreso en el recibo) o con el día cerrado y sin mensaje. (1)
  - `src/components/Services.tsx → save() (los gates vivían SOLO en el disabled del botón)`
  - `src/components/Services.tsx → onKeyDown del DialogContent (Ctrl+Enter → save())`
  - Fix: La validación vive en la FUNCIÓN que guarda, no en el `disabled` del botón: cualquier atajo (Enter, Ctrl+Enter, F9) debe pasar por los mismos gates y, si bloquea, DECIR por qué («No se guardó — falta: …»). Al agregar un atajo, revisar qué condiciones tenía el botón al que reemplaza.

---

### Conventions

- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno. (1)
  - `- `- `CierreServiceDialog.tsx cambió a las 19:15, 19:24 y 19:31 durante esta sesión; Services.tsx a las 19:16 y 19:19```
  - `- `- `tools/verify_servicio_cierre.mjs (script de la otra sesión) se editó a las 19:37 con la app Tauri viva (pid registro 11168)```
  - `- `- `AGENTS.md → sección «Asistente de Cierre de Servicio (F30)» → lección CRÍTICA de coordinación```
- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno. (1)
- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno. (1)
- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno. (1)

---

### Anti-Patterns

- `[HIGH]` Prueba que CUENTA elementos en vez de verificar su TEXTO: la verificación en vivo de la cola/picker contaba «3 chips» con una regex laxa (/PUNTO Bs|PAGO MOVIL|EFECTIVO/) y por eso NO detectó que el chip del método más usado se pintaba «PUNTO Bs Bs.» (currencySymbol('VES') devuelve 'Bs. ' CON espacio final y el helper no lo recortaba). Lo cazó la revisión adversarial, no la prueba. (1)
  - `- `src/lib/payment-methods.ts → simboloSiAporta (antes en PaymentMethodPicker.tsx, sin test)``
  - `- `src/lib/utils.ts → currencySymbol('VES') = 'Bs. ' (espacio final)``
  - `- `tools/verify_wizard_metodos.mjs (la aserción vieja solo contaba chips)``

---

### Conventions

- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno.
- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno.
- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno.
- `[HIGH]` Trabajo concurrente en el mismo repo (dos sesiones de agente a la vez): antes de reescribir un archivo, mirar su LastWriteTime y si la app de dev está corriendo (Vite hace HMR y le reinicia el diálogo abierto a la sesión que está verificando en vivo). Lo que funcionó: (1) el guardado falla si el archivo cambió desde la última lectura — nunca pisar a ciegas; (2) cooperar por MÓDULOS COMPARTIDOS (lib/payment-math.ts) en vez de duplicar reglas; (3) dejar quietos los archivos calientes de la otra sesión y aportar piezas nuevas (cola F4) sin reescribir lo ajeno.