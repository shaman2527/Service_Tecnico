# 📦 Registro v0.1.2 — Instalación en una PC nueva

Copia esta carpeta completa a un **pendrive** y llévala a la PC del cliente.

## 1. Instalar (2 minutos)

1. Doble clic en **`Registro Servicio Tecnico_0.1.2_x64-setup.exe`**.
2. Si Windows muestra "Protegió su PC" (SmartScreen): clic en **"Más información" → "Ejecutar de todos modos"** (es nuestra app, firmada con el sistema de actualizaciones).
3. Se instala solo en `%LOCALAPPDATA%\Registro Servicio Tecnico\`. **No pide drivers ni internet**: el WebView2 (motor de la ventana) viaja embebido en el instalador — si la PC lo necesita, se instala automáticamente durante el proceso.

## 2. Primer arranque

1. Abre **Registro** → pide PIN → el inicial es **`1234`**.
2. **Cambia el PIN ahora** (Libro Diario → botón PIN) — deja uno que solo conozca el dueño.
3. **Abre el día** en Libro Diario: efectivo inicial + botón **Auto BCV** (trae la tasa oficial; si no hay internet, escríbela a mano).
4. **Impresora** (si la hay): Servicio Técnico → **Impresora** → **Detectar** puerto → Imprimir prueba (58mm por defecto).

## 3. Sus datos

- Toda la información vive en **`registro.db`** (junto al exe instalado): productos (980), clientes, ventas, servicios, cierres, PIN y configuración de impresora.
- **Respaldo:** copiar ese archivo (con la app cerrada).
- **El instalador NUNCA borra ni sobreescribe una base de datos existente** (verificado en pruebas): el catálogo inicial viaja como plantilla `registro.default.db` y solo se copia en el PRIMER arranque si `registro.db` no existe. Reinstalar o actualizar nunca toca tus datos.

## 4. Actualizaciones (automáticas)

- Al arrancar, la app revisa si hay versión nueva en GitHub (5 segundos, sin molestar si no hay internet).
- Si hay: aviso en pantalla con lo que cambió → **"Instalar ahora"**.
- Antes de instalar hace **respaldo automático** (exe anterior + copia de `registro.db` en `updates\`).
- Si la versión nueva fallara una verificación (base de datos, numeración de órdenes, libro diario, BCV), **vuelve sola a la versión anterior** — la tienda sigue trabajando sin perder nada.
- Para publicar versiones nuevas se usa `tools\release.ps1` (requiere `gh auth login` en la PC de desarrollo).

## 5. Resumen de archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Registro Servicio Tecnico_0.1.2_x64-setup.exe` | Instalador completo (con catálogo + PIN inicial + WebView2 embebido) |
| `INSTALACION.md` | Esta guía |
