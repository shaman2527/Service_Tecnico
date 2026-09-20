# 📦 Registro v0.4.0 — Instalación en una PC nueva

Copia esta carpeta completa a un **pendrive** y llévala a la PC del cliente.

## 1. Instalar (2 minutos)

1. Doble clic en **`Registro Servicio Tecnico_0.4.0_x64-setup.exe`**.
2. Si Windows muestra "Protegió su PC" (SmartScreen): clic en **"Más información" → "Ejecutar de todos modos"** (es nuestra app, firmada con el sistema de actualizaciones).
3. Se instala solo en `%LOCALAPPDATA%\Registro Servicio Tecnico\`. **No pide drivers ni internet**: el WebView2 (motor de la ventana) viaja embebido en el instalador — si la PC lo necesita, se instala automáticamente durante el proceso.

## 2. Primer arranque

1. Abre **Registro** → pide PIN → el inicial es **`1234`**.
2. **Cambia el PIN ahora** (Libro Diario → botón PIN) — deja uno que solo conozca el dueño.
3. **Abre el día** en Libro Diario: efectivo inicial + botón **Auto BCV** (trae la tasa oficial; si no hay internet, escríbela a mano).
4. **Impresora** (si la hay): Servicio Técnico → **Impresora** → **Detectar** puerto → Imprimir prueba (58mm por defecto).
5. **Precios que faltan:** algunos repuestos nuevos (Honor X6A/X6B/X6C/X7A/X7C/X7D/X8A, Xiaomi RMA3/RMA5/Redmi 15, Tecno Spark Go 2024/2025, Samsung A06 4G/A16 4G, Realme C51…) **no vienen con precio** porque no están en la lista del local. Se les carga en **Inventario → Precios y datos** (o buscando la ficha en Productos): mientras no tengan precio, esa ficha **no se puede cobrar** en el mostrador.

## 3. Sus datos (lo más importante)

- Toda la información vive en **`registro.db`** (junto al exe instalado): productos, clientes, ventas, servicios, abonos, cierres, PIN y configuración de impresora.
- **Respaldo:** copiar ese archivo (con la app cerrada).
- **El instalador NUNCA borra ni sobreescribe una base de datos existente:** el catálogo inicial viaja como plantilla `registro.default.db` y solo se copia en el PRIMER arranque si `registro.db` no existe. Reinstalar o actualizar nunca toca tus datos.
- **La actualización migra la base sin tocar la historia** (ventas, servicios, abonos, clientes, cierres y stock quedan idénticos). Está medido con una prueba que corre la migración real sobre una **copia** de la base del taller y compara fila por fila antes/después: `node tools/verify_migracion_datos.mjs`. Esa prueba se puede correr en la PC del local con la app cerrada.

## 4. Actualizaciones (automáticas)

- Al arrancar, la app revisa si hay versión nueva en GitHub (5 segundos, sin molestar si no hay internet).
- Si hay: aviso en pantalla con lo que cambió → **"Instalar ahora"**.
- Antes de instalar hace **respaldo automático** (exe anterior + copia de `registro.db` en `updates\`).
- Si la versión nueva fallara una verificación (base de datos, numeración de órdenes, libro diario, BCV), **vuelve sola a la versión anterior** — la tienda sigue trabajando sin perder nada.
- Para publicar versiones nuevas se usa `tools\release.ps1` (requiere `gh auth login` en la PC de desarrollo).

## 5. Qué trae la v0.4.0

| Área | Novedad |
|---|---|
| **Inventario** | Módulo único (Productos / Por modelo / Movimientos / Precios y datos) con el catálogo canónico, el padrón de modelos y las pantallas compatibles por teléfono. Cada pestaña abre al instante (memoria del catálogo) |
| **Entrega** | Asistente de cierre que cobra, entrega y descuenta stock en un paso + cola de entregas «qué le falta a cada una» |
| **Recepción** | Wizard rápido con la Ficha de Ingreso: pide un dato a la vez (cédula, blindaje, foto de entrada, acuerdo de pago) sin tapar el formulario |
| **Caja (Venezuela)** | El saldo se dice en la moneda del cobro, el arqueo cuadra **por moneda** (Diferencia $ y Diferencia Bs. por separado) y el cierre muestra las devoluciones del día |
| **Servicio** | Cambio de técnico a un toque desde la tarjeta, fecha del pago editable (para que el abono caiga en la caja del día correcto), devolución **por donde entró** la plata y panel «Teléfonos entregados hoy» |
| **Seguridad** | PIN hasheado (PBKDF2) con límite de intentos y gate de rol en el backend: los cambios de catálogo/precios/PIN exigen al dueño; la cajera cobra sin PIN |

## 6. Resumen de archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Registro Servicio Tecnico_0.4.0_x64-setup.exe` | Instalador completo (con catálogo + precios + PIN inicial + WebView2 embebido) |
| `INSTALACION.md` | Esta guía |
