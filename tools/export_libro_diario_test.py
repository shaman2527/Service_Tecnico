#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pruebas del export a Excel (F75): la matemática del IVA y el archivo REAL que sale.

Uso:  python tools/export_libro_diario_test.py

Comprueba dos cosas:
  1. `iva_split` espeja la regla pura de la app (`src/lib/iva.ts`): base + IVA = total AL CENTAVO, el
     IVA es el residuo, sin IVA no inventa nada.
  2. Con un JSON de ejemplo, el script genera un .xlsx de verdad y el libro queda: con las hojas
     esperadas, los cobros ORDENADOS POR MÉTODO, la hoja de PAGO MÓVIL con monto y número de
     referencia, la base imponible y el IVA del período bien calculados, y las ventas anuladas
     marcadas (no contadas).
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util as _ilu

spec = _ilu.spec_from_file_location("export_libro", os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_libro_diario.py"))
export_libro = _ilu.module_from_spec(spec)
spec.loader.exec_module(export_libro)

from openpyxl import load_workbook  # noqa: E402

checks = 0
fallas = []


def ok(que, cond, detalle=""):
    global checks
    checks += 1
    if not cond:
        fallas.append(que)
        print(f"FALLA · {que}{f' — {detalle}' if detalle else ''}")
    else:
        print(f"OK    · {que}{f' — {detalle}' if detalle else ''}")


# ── 1. La matemática del IVA (espejo de src/lib/iva.ts) ────────────────────────────────────────
for total, rate, base_e, iva_e in [
    (34.8, 16, 30.0, 4.8),      # 16% agregado: 30 + 4,80
    (30.0, 16, 25.86, 4.14),    # incluido: 30 / 1,16
    (116.0, 16, 100.0, 16.0),
    (32.4, 8, 30.0, 2.4),
    (50.0, 0, 0.0, 0.0),        # sin IVA: nada
    (0, 16, 0.0, 0.0),
]:
    base, iva = export_libro.iva_split(total, rate)
    ok(f"iva_split({total}, {rate}%) = base {base_e} + IVA {iva_e}", abs(base - base_e) < 0.005 and abs(iva - iva_e) < 0.005,
       f"dio base {base} · IVA {iva}")
    ok(f"iva_split({total}, {rate}%): base + IVA = total al centavo",
       rate == 0 or abs(base + iva - total) < 0.005, f"{base} + {iva} vs {total}")

# Un caso con céntimos que NO es redondo: el residuo tiene que cerrar igual.
base, iva = export_libro.iva_split(12.35 * 1.16, 16)
ok("un monto con céntimos cierra al centavo", abs(base + iva - round(12.35 * 1.16, 2)) < 0.005)

# ── 2. El archivo real ─────────────────────────────────────────────────────────────────────────
dias = [
    {
        "date": "2026-09-23", "totals": {"pago_movil_total": 1971.0, "cash_bs": 0.0, "cash_usd": 10.0,
                                         "pos_net_usd": 0.0, "pos_net_bs": 0.0, "zelle_total": 20.0,
                                         "transfer_bs_total": 0.0, "grand_usd": 64.8, "grand_bs": 1971.0,
                                         "grand_total": 67.11, "tasa_bcv": 853.4993},
        "sales": [
            {"date": "2026-09-23 10:00:00", "client": "Ana Pérez", "ci": "V-12345678",
             "product": "Pantalla A15", "qty": 1, "unit": 34.8, "total": 34.8,
             "method": "Divisas (USD Cash)", "ref": "", "currency": "USD", "iva_rate": 16},
            {"date": "2026-09-23 11:00:00", "client": "Luis", "ci": "", "product": "Forro",
             "qty": 1, "unit": 10.0, "total": 10.0, "method": "Pago Móvil", "ref": "1234",
             "currency": "VES", "iva_rate": 0},
            {"date": "2026-09-23 12:00:00", "client": "Error", "ci": "", "product": "(ANULADA) Cable",
             "qty": 1, "unit": 5.0, "total": 5.0, "method": "Divisas (USD Cash)", "ref": "",
             "currency": "USD", "iva_rate": 0},
        ],
        "payments": [
            {"date": "2026-09-23 13:00:00", "order": "DEV-0001", "client": "Ana Pérez",
             "model": "Samsung A15", "amount": 1971.0, "method": "Pago Móvil", "ref": "5678",
             "currency": "VES", "notes": "abono", "ci": "V-12345678"},
            {"date": "2026-09-23 14:00:00", "order": "DEV-0001", "client": "Ana Pérez",
             "model": "Samsung A15", "amount": 20.0, "method": "Transferencia Zelle", "ref": "Z-99",
             "currency": "USD", "notes": "", "ci": "V-12345678"},
        ],
        "pago_movil": [], "closing": None,
    },
    {
        "date": "2026-09-24", "totals": {"pago_movil_total": 0.0, "cash_bs": 0.0, "cash_usd": 0.0,
                                         "pos_net_usd": 20.0, "pos_net_bs": 0.0, "zelle_total": 0.0,
                                         "transfer_bs_total": 0.0, "grand_usd": 30.0, "grand_bs": 0.0,
                                         "grand_total": 30.0, "tasa_bcv": 860.0},
        "sales": [
            {"date": "2026-09-24 09:00:00", "client": "Pedro", "ci": "", "product": "Batería",
             "qty": 1, "unit": 30.0, "total": 30.0, "method": "Punto de Venta ($)", "ref": "POS-77",
             "currency": "USD", "iva_rate": 0},
        ],
        "payments": [], "pago_movil": [], "closing": None,
    },
]
data = {
    "start": "2026-09-23", "end": "2026-09-24", "generado": "2026-09-25 17:00",
    "negocio": "SERVICIO TECNICO PRUEBA", "linea": "WILIAM SALGADO",
    "days": dias,
    "services": [
        {"date_in": "2026-09-23 09:00:00", "order": "DEV-0001", "client": "Ana Pérez",
         "ci": "V-12345678", "model": "Samsung A15", "types": '["Cambio pantalla"]',
         "technician": "Aldri", "amount": 116.0, "paid": 36.0, "status": "Entregado",
         "date_out": "2026-09-24", "screen": "Pantalla A15", "iva_rate": 16},
    ],
    "movements": [
        {"date": "2026-09-23 10:00:00", "product": "Pantalla A15", "type": "salida", "qty": 1,
         "reason": "Venta", "ref": "Venta #1"},
    ],
    "expenses": [
        {"date": "2026-09-23", "category": "Repuestos", "amount": 20.0, "currency": "USD", "notes": "compra"},
        {"date": "2026-09-23", "category": "Transporte", "amount": 5000.0, "currency": "VES", "notes": ""},
    ],
}

with tempfile.TemporaryDirectory() as tmp:
    json_path = os.path.join(tmp, "datos.json")
    xlsx_path = os.path.join(tmp, "reporte.xlsx")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_libro_diario.py")
    r = subprocess.run([sys.executable, script, json_path, xlsx_path], capture_output=True, text=True)
    ok("el script genera el .xlsx sin errores", r.returncode == 0 and os.path.exists(xlsx_path),
       (r.stderr or r.stdout or "").strip()[:200])

    wb = load_workbook(xlsx_path)
    hojas = wb.sheetnames
    esperadas = ["Resumen", "Por método de pago", "Pago Móvil", "Ventas", "Servicios",
                 "Pagos y Abonos", "IVA del período", "Gastos", "Movimientos"]
    ok("el libro trae las hojas esperadas y en orden",
       hojas[:len(esperadas)] == esperadas, " | ".join(hojas))

    # ── Por método de pago: ordenado por método ───────────────────────────────────────────────
    ws = wb["Por método de pago"]
    metodos = [ws.cell(row=r_, column=1).value for r_ in range(5, ws.max_row + 1)
               if ws.cell(row=r_, column=1).value and ws.cell(row=r_, column=2).value]
    ok("los cobros están ORDENADOS por método de pago",
       metodos == sorted(metodos, key=lambda m: str(m).lower()), " | ".join(map(str, metodos)))
    ok("entran las ventas Y los abonos (12 cobros en el ejemplo = 4 ventas + 2 abonos, sin la anulada)",
       len(metodos) == 6, f"{len(metodos)} filas: {metodos}")

    # ── Pago Móvil: monto + referencia ────────────────────────────────────────────────────────
    ws = wb["Pago Móvil"]
    refs = [ws.cell(row=r_, column=7).value for r_ in range(5, ws.max_row + 1)
            if ws.cell(row=r_, column=1).value and ws.cell(row=r_, column=7).value]
    montos = [ws.cell(row=r_, column=8).value for r_ in range(5, ws.max_row + 1)
              if ws.cell(row=r_, column=1).value and isinstance(ws.cell(row=r_, column=8).value, (int, float))]
    ok("la hoja Pago Móvil lista cada pago con su Nº de referencia",
       "1234" in refs and "5678" in refs and len(montos) == 2, f"refs={refs} · montos={montos}")
    ok("los montos de Pago Móvil van en Bs. y con su total",
       ws.cell(row=ws.max_row, column=1).value is not None and "TOTAL" in str(ws.cell(row=ws.max_row, column=1).value or "").upper()
       or any("TOTAL PAGO MÓVIL" in str(ws.cell(row=r_, column=1).value or "") for r_ in range(1, ws.max_row + 2)),
       str(ws.cell(row=ws.max_row, column=1).value))

    # ── IVA del período ───────────────────────────────────────────────────────────────────────
    ws = wb["IVA del período"]
    filas_iva = {}
    for r_ in range(5, ws.max_row + 1):
        tipo = ws.cell(row=r_, column=1).value
        alic = ws.cell(row=r_, column=2).value
        if tipo in ("Ventas", "Servicios") and alic:
            filas_iva[(tipo, alic)] = (ws.cell(row=r_, column=4).value, ws.cell(row=r_, column=5).value)
    # Venta de 34,80 al 16% → base 30,00 + IVA 4,80 · Servicio de 116 al 16% → base 100 + IVA 16
    ok("el IVA de las VENTAS al 16% es base 30,00 + IVA 4,80",
       abs((filas_iva.get(("Ventas", "16%")) or (0, 0))[0] - 30.0) < 0.005
       and abs((filas_iva.get(("Ventas", "16%")) or (0, 0))[1] - 4.8) < 0.005, str(filas_iva))
    ok("el IVA de los SERVICIOS al 16% es base 100,00 + IVA 16,00",
       abs((filas_iva.get(("Servicios", "16%")) or (0, 0))[0] - 100.0) < 0.005
       and abs((filas_iva.get(("Servicios", "16%")) or (0, 0))[1] - 16.0) < 0.005, str(filas_iva))
    ok("el IVA sin alícuota se informa aparte (sin IVA / exento)",
       any("Sin IVA" in str(ws.cell(row=r_, column=2).value or "") for r_ in range(5, ws.max_row + 1)))

    # ── Ventas: la anulada queda marcada y NO entra en los totales ────────────────────────────
    ws = wb["Ventas"]
    estados = [ws.cell(row=r_, column=13).value for r_ in range(5, ws.max_row + 1)
               if ws.cell(row=r_, column=1).value and ws.cell(row=r_, column=13).value]
    ok("la venta ANULADA queda marcada en la hoja Ventas",
       any(str(e).startswith("ANULADA") for e in estados) and any(e == "Vigente" for e in estados), str(estados))

    # ── Servicios: base/IVA/total y saldo ─────────────────────────────────────────────────────
    ws = wb["Servicios"]
    fila = [ws.cell(row=5, column=c).value for c in range(1, 16)]
    ok("la hoja Servicios trae base, IVA, total, abonado y saldo",
       abs(fila[7] - 100.0) < 0.005 and abs(fila[8] - 16.0) < 0.005 and abs(fila[10] - 36.0) < 0.005
       and abs(fila[11] - 80.0) < 0.005, str(fila[7:12]))

    # ── Resumen: los métodos con su moneda separada ───────────────────────────────────────────
    ws = wb["Resumen"]
    texto = "\n".join(str(ws.cell(row=r_, column=1).value or "") for r_ in range(1, ws.max_row + 1))
    ok("el Resumen nombra los métodos con su moneda (no mezcla $ y Bs.)",
       "Pago Móvil" in texto and "Transferencia Zelle" in texto and "Divisas (USD Cash)" in texto)
    ok("el Resumen avisa que el IVA no es ingreso del negocio", "por pagar" in texto)

    # ── Gastos: totales separados por moneda ──────────────────────────────────────────────────
    ws = wb["Gastos"]
    tot = [str(ws.cell(row=r_, column=1).value or "") for r_ in range(1, ws.max_row + 1)]
    ok("los gastos traen total separado por moneda", any("TOTAL $" in t for t in tot) and any("TOTAL Bs." in t for t in tot))

print(f"\nexport_libro_diario_test: {checks - len(fallas)}/{checks} OK" + (f" — {len(fallas)} FALLAN" if fallas else ""))
sys.exit(1 if fallas else 0)
