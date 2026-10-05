@echo off
REM ============================================================================
REM  REGISTRO — ABRIR LA VERSION NUEVA (con F85–F92) SOBRE TU BASE DEL TALLER
REM
REM  ¿Por qué existe este archivo? El binario de DESARROLLO resuelve su carpeta de
REM  datos junto al .exe (src-tauri\target\debug\registro.db), NO la carpeta de la app
REM  instalada. Este lanzador le dice explícitamente qué base usar: la del TALLER
REM  (AppData\Local\Registro Servicio Tecnico\registro.db), que es la misma que abre
REM  tu acceso directo de siempre — así ves tus datos reales con la versión nueva.
REM
REM  OJO: cerrá antes la app instalada vieja (0.4.10): las dos pueden estar abiertas,
REM  pero es más claro trabajar con una sola.
REM ============================================================================
setlocal
set "REGISTRO_DB=%LOCALAPPDATA%\Registro Servicio Tecnico\registro.db"
REM Prefiere el binario RELEASE (más liviano) y si no está usa el de desarrollo
set "EXE=%~dp0src-tauri\target\release\registro.exe"
if not exist "%EXE%" set "EXE=%~dp0src-tauri\target\debug\registro.exe"
if not exist "%EXE%" (
  echo.
  echo   NO encuentro el binario nuevo: %EXE%
  echo   Compilalo con:  npm run build  ^&^&  cargo build --manifest-path src-tauri\Cargo.toml
  echo.
  pause
  exit /b 1
)
echo   Base de datos: %REGISTRO_DB%
echo   Binario:       %EXE%
start "" "%EXE%"
endlocal
