#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Exporta el Libro Diario a un Excel profesional (.xlsx) para el CONTADOR (F75).

Uso: python export_libro_diario.py <data.json> <salida.xlsx>

El JSON lo genera el backend Rust (`export_daily_report_xlsx`): days[].sales/payments/pago_movil/
totals/closing, services[], movements[], expenses[] + el nombre del negocio.

Cómo está pensado (el pedido del dueño: «un excel profesional que pueda visualizar rápido, todo
ordenado por método de pago, que mi contador en Venezuela lo entienda»):
  1. Resumen               -> la foto del período: totales por día y por método, IVA, gastos.
  2. Por método de pago    -> TODOS los cobros (ventas + abonos) ORDENADOS POR MÉTODO y fecha, con
                              referencia: filtrando un método se ve su total al instante (SUBTOTAL).
  3. Pago Móvil            -> el detalle que se concilia contra el banco: monto + Nº de referencia.
  4. Ventas                -> cada venta, con base/IVA/total y si la venta está ANULADA.
  5. Servicios             -> cada orden recibida en el rango, con base/IVA/total y saldo.
  6. Pagos y Abonos        -> cada abono de una orden.
  7. IVA del período       -> el libro para declarar: base imponible e IVA por alícuota y por tipo.
  8. Cierres de caja       -> arqueo, diferencias y notas de cada turno cerrado.
  9. Gastos                -> gastos del negocio (con totales separados por moneda).
 10. Movimientos           -> inventario (entradas/salidas).

Reglas que este archivo respeta (las mismas de la app — `src/lib/iva.ts` y `src/lib/money.ts`):
  · base + IVA = total AL CENTAVO (el IVA es el RESIDUO, no un número redondeado aparte);
  · la alícuota de cada fila es la de ESA operación (cambiar la alícuota hoy no reescribe el pasado);
  · NUNCA se suman $ y Bs. en bruto: cada moneda tiene su columna y su total;
  · en Bs. los montos van CON sus céntimos, calculados con la tasa BCV del día del cobro.
"""
import json
import sys
from collections import OrderedDict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

FMT_USD = '"$" #,##0.00'
FMT_BS = '"Bs." #,##0.00'
FMT_INT = '#,##0'
FMT_PCT = '0.00"%"'
HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=14, color="1F4E79")
SUB_FILL = PatternFill("solid", fgColor="DDEBF7")
SUB_FONT = Font(bold=True, size=11)
TOT_FILL = PatternFill("solid", fgColor="1F4E79")
TOT_FONT = Font(bold=True, color="FFFFFF", size=11)
WARN_FILL = PatternFill("solid", fgColor="FCE4E4")
WARN_FONT = Font(color="9C0006")
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TAB_COLORS = {
    "Resumen": "1F4E79", "Por método de pago": "0B6E4F", "Pago Móvil": "F9A825",
    "Ventas": "2E7D32", "Servicios": "E65100", "Pagos y Abonos": "6A1B9A",
    "IVA del período": "AD1457", "Cierres de caja": "B71C1C", "Gastos": "8E44AD",
    "Movimientos": "00695C",
}
# Los métodos que se concilian contra el BANCO por número de referencia (la caja los verifica uno por
# uno): son los que el contador necesita con su referencia al lado.
REF_METHODS = ("Pago Móvil", "Transferencia Zelle", "Transferencia Bs", "Punto de Venta")


def money(v):
    return 0.0 if v is None else round(float(v), 2)


def iva_split(total, rate):
    """base + IVA de un monto YA cobrado, con la alícuota de ESA fila.

    Espeja la regla pura de la app (`src/lib/iva.ts`, `desgloseGuardado`): el total guardado es lo que
    pagó el cliente y la base sale de despejar `total = base × (1 + alícuota)`; el IVA es el RESIDUO,
    así que `base + iva == total` al centavo (nunca queda un céntimo suelto).
    """
    t = money(total)
    r = (rate or 0) / 100.0
    if r <= 0:
        return 0.0, 0.0
    base = round(t / (1 + r), 2)
    return base, round(t - base, 2)


def es_bs(currency):
    return (currency or "").upper() in ("VES", "BS", "BS.", "BSS")


def metodo_base(method):
    """Nombre corto y estable del método (para agrupar y ordenar)."""
    m = (method or "").strip()
    if not m:
        return "(sin método)"
    return m


def es_metodo_ref(method):
    return any(k.lower() in metodo_base(method).lower() for k in REF_METHODS) or "Móvil" in metodo_base(method)


def write_table(ws, start_row, headers, rows, widths, money_cols=None, row_formats=None,
                freeze=True, autofilter=True):
    """Tabla con header azul, bordes, formatos por columna, freeze y autofiltro."""
    money_cols = money_cols or {}
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=start_row, column=c, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[start_row].height = 30
    r = start_row + 1
    for i, row in enumerate(rows):
        for c, v in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.border = BORDER
            if c == 1:
                cell.alignment = Alignment(horizontal="left")
            fmt = money_cols.get(c)
            if fmt == "usd":
                cell.number_format = FMT_USD
            elif fmt == "bs":
                cell.number_format = FMT_BS
            elif fmt == "int":
                cell.number_format = FMT_INT
            elif fmt == "pct":
                cell.number_format = FMT_PCT
        if row_formats:
            row_formats(ws, r, row, i)
        r += 1
    for c, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    if freeze:
        ws.freeze_panes = f"A{start_row + 1}"
    if autofilter and rows:
        ws.auto_filter.ref = f"A{start_row}:{get_column_letter(len(headers))}{r - 1}"
    return r


def total_row(ws, row, ncols, label, cells, tone="total"):
    """Fila de totales. `cells` = {columna: (formula, formato)}. Con SUBTOTAL(9,…) Excel la
    RECALCULA al filtrar: filtrar un método da el total de ESE método (lo que pidió el dueño)."""
    fill = TOT_FILL if tone == "total" else SUB_FILL
    font = TOT_FONT if tone == "total" else SUB_FONT
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = fill
        cell.border = BORDER
        cell.font = font
    lab = ws.cell(row=row, column=1, value=label)
    lab.font = font
    for c, (formula, fmt) in cells.items():
        cell = ws.cell(row=row, column=c, value=formula)
        cell.number_format = fmt
        cell.font = font
        cell.alignment = Alignment(horizontal="right")
    return row + 1


def encabezado(ws, titulo, subtitulo, ncols):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    ws.cell(row=1, column=1, value=titulo).font = TITLE_FONT
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    ws.cell(row=2, column=1, value=subtitulo).font = Font(italic=True, size=10, color="595959")


def preparar_impresion(ws, ncols):
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "3:3"


def main():
    if len(sys.argv) != 3:
        print("Uso: export_libro_diario.py <data.json> <salida.xlsx>", file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        data = json.load(f)

    start, end, generado = data.get("start", ""), data.get("end", ""), data.get("generado", "")
    negocio = (data.get("negocio") or "").strip() or "REGISTRO SERVICIO TÉCNICO"
    linea = (data.get("linea") or "").strip()
    days = data.get("days", [])
    services = data.get("services", [])
    expenses = data.get("expenses", [])
    movements = data.get("movements", [])
    periodo = f"Período: {start} → {end}"
    pie = f"{periodo}   ·   Generado: {generado}" + (f"   ·   {linea}" if linea else "")

    # La tasa BCV de cada día (para la equivalencia en Bs. de las filas de ese día).
    tasa_dia = {d.get("date", ""): money((d.get("totals") or {}).get("tasa_bcv")) for d in days}

    def tasa_de(fecha):
        return tasa_dia.get((fecha or "")[:10], 0.0)

    # ── Todos los cobros (ventas + abonos) en una sola lista, con su método ──────────────────────
    cobros = []
    for d in days:
        for s in d.get("sales", []):
            iva = money(s.get("iva_rate"))
            base, iva_m = iva_split(s.get("total"), iva)
            cobros.append({
                "fecha": (s.get("date") or "")[:10], "metodo": metodo_base(s.get("method")),
                "moneda": "Bs." if es_bs(s.get("currency")) else "$",
                "origen": "Venta", "detalle": s.get("product", ""), "orden": "",
                "cliente": s.get("client", ""), "ci": s.get("ci", ""),
                "ref": s.get("ref", "") or "", "monto": money(s.get("total")),
                "iva_rate": iva, "base": base, "iva": iva_m,
                "anulada": str(s.get("product", "")).startswith("(ANULADA)"),
            })
        for p in d.get("payments", []):
            cobros.append({
                "fecha": (p.get("date") or "")[:10], "metodo": metodo_base(p.get("method")),
                "moneda": "Bs." if es_bs(p.get("currency")) else "$",
                "origen": "Abono", "detalle": p.get("model", ""), "orden": p.get("order", ""),
                "cliente": p.get("client", ""), "ci": p.get("ci", ""),
                "ref": p.get("ref", "") or "", "monto": money(p.get("amount")),
                "iva_rate": 0.0, "base": money(p.get("amount")), "iva": 0.0, "anulada": False,
            })
    # ORDENADOS POR MÉTODO y, dentro del método, por fecha (lo que pidió el dueño).
    cobros.sort(key=lambda c: (c["metodo"].lower(), c["fecha"], c["origen"]))

    wb = Workbook()
    wb.remove(wb.active)

    # ════════════════ 1) RESUMEN ════════════════
    ws = wb.create_sheet("Resumen")
    ws.sheet_properties.tabColor = TAB_COLORS["Resumen"]
    encabezado(ws, f"LIBRO DIARIO — {negocio}", pie, 14)

    # Totales del período por método y por moneda (lo primero que mira el contador).
    por_metodo = OrderedDict()
    for c in cobros:
        if c["anulada"]:
            continue
        k = (c["metodo"], c["moneda"])
        e = por_metodo.setdefault(k, {"n": 0, "monto": 0.0, "refs": 0, "bs_equiv": 0.0, "ventas": 0.0, "abonos": 0.0})
        e["n"] += 1
        e["monto"] = round(e["monto"] + c["monto"], 2)
        if c["ref"]:
            e["refs"] += 1
        if c["moneda"] == "$":
            e["bs_equiv"] = round(e["bs_equiv"] + c["monto"] * tasa_de(c["fecha"]), 2)
        else:
            e["bs_equiv"] = round(e["bs_equiv"] + c["monto"], 2)
        e["ventas" if c["origen"] == "Venta" else "abonos"] = round(
            e["ventas" if c["origen"] == "Venta" else "abonos"] + c["monto"], 2)

    r = 4
    ws.cell(row=r, column=1, value="COBROS DEL PERÍODO POR MÉTODO DE PAGO").font = SUB_FONT
    r += 1
    filas_res = []
    for (m, mon), e in sorted(por_metodo.items(), key=lambda kv: (-kv[1]["monto"], kv[0][0])):
        filas_res.append([m, mon, e["n"], e["monto"], e["ventas"], e["abonos"], e["refs"],
                          e["bs_equiv"] if mon == "Bs." else e["bs_equiv"]])
    end_r = write_table(
        ws, r,
        ["Método de pago", "Moneda", "Operaciones", "Monto", "De ventas", "De abonos",
         "Con Nº de referencia", "Equivalente Bs. (tasa del día)"],
        filas_res, [24, 8, 11, 14, 13, 13, 20, 24],
        {4: "mix", 5: "mix", 6: "mix", 8: "bs"}, autofilter=False)
    if filas_res:
        last = end_r - 1
        total_row(ws, end_r, 8, "TOTAL COBRADO (todas las monedas — ver columna Moneda)",
                  {3: (f"=SUM(C{r+1}:C{last})", FMT_INT),
                   7: (f"=SUM(G{r+1}:G{last})", FMT_INT)})

    # Naturaleza del período: ventas/servicios/IVA/gastos.
    ventas_usd = round(sum(money(t.get("grand_usd")) for t in
                           (d.get("totals") or {} for d in days)), 2)
    ventas_bs = round(sum(money(t.get("grand_bs")) for t in
                          (d.get("totals") or {} for d in days)), 2)
    iva_v = round(sum(iva_split(s.get("total"), s.get("iva_rate"))[1]
                      for d in days for s in d.get("sales", [])
                      if not str(s.get("product", "")).startswith("(ANULADA)")), 2)
    base_v = round(sum(iva_split(s.get("total"), s.get("iva_rate"))[0]
                       for d in days for s in d.get("sales", [])
                       if not str(s.get("product", "")).startswith("(ANULADA)")
                       and money(s.get("iva_rate")) > 0), 2)
    iva_s = round(sum(iva_split(s.get("amount"), s.get("iva_rate"))[1] for s in services), 2)
    base_s = round(sum(iva_split(s.get("amount"), s.get("iva_rate"))[0] for s in services
                       if money(s.get("iva_rate")) > 0), 2)
    gastos_usd = round(sum(money(e.get("amount")) for e in expenses if not es_bs(e.get("currency"))), 2)
    gastos_bs = round(sum(money(e.get("amount")) for e in expenses if es_bs(e.get("currency"))), 2)

    r = (end_r if filas_res else r) + 2
    ws.cell(row=r, column=1, value="RESUMEN DEL PERÍODO").font = SUB_FONT
    r += 1
    resumen = [
        ("Ventas cobradas (equiv. $)", ventas_usd, "usd"),
        ("Ventas cobradas (Bs.)", ventas_bs, "bs"),
        ("Base imponible de ventas (con IVA)", base_v, "usd"),
        ("IVA de ventas", iva_v, "usd"),
        ("Base imponible de servicios (con IVA)", base_s, "usd"),
        ("IVA de servicios", iva_s, "usd"),
        ("IVA del período (ventas + servicios)", round(iva_v + iva_s, 2), "usd"),
        ("Gastos del negocio ($)", gastos_usd, "usd"),
        ("Gastos del negocio (Bs.)", gastos_bs, "bs"),
    ]
    for label, val, fmt in resumen:
        ws.cell(row=r, column=1, value=label).border = BORDER
        c2 = ws.cell(row=r, column=2, value=val)
        c2.number_format = FMT_USD if fmt == "usd" else FMT_BS
        c2.border = BORDER
        r += 1
    ws.cell(row=r + 1, column=1,
            value="El IVA se muestra por separado porque NO es ingreso del negocio: es un monto por pagar.").font = \
        Font(italic=True, size=9, color="595959")

    # Totales por día.
    r += 3
    ws.cell(row=r, column=1, value="TOTALES POR DÍA").font = SUB_FONT
    r += 1
    headers = ["Fecha", "Pago Móvil Bs.", "Efectivo Bs.", "Efectivo $", "Punto neto $", "Punto neto Bs.",
               "Zelle $", "Transf. Bs.", "Total $", "Total Bs.", "Total equiv. $", "Tasa BCV"]
    rows = []
    for d in days:
        t = d.get("totals", {})
        rows.append([d.get("date", ""), money(t.get("pago_movil_total")), money(t.get("cash_bs")),
                     money(t.get("cash_usd")), money(t.get("pos_net_usd")), money(t.get("pos_net_bs")),
                     money(t.get("zelle_total")), money(t.get("transfer_bs_total")),
                     money(t.get("grand_usd")), money(t.get("grand_bs")),
                     money(t.get("grand_total")), money(t.get("tasa_bcv"))])
    end_d = write_table(ws, r, headers, rows,
                        [12, 15, 13, 12, 12, 13, 12, 12, 12, 13, 14, 12],
                        {2: "bs", 3: "bs", 4: "usd", 5: "usd", 6: "bs", 7: "usd", 8: "bs",
                         9: "usd", 10: "bs", 11: "usd", 12: "bs"}, autofilter=False)
    if rows:
        last = end_d - 1
        total_row(ws, end_d, 12, "TOTAL DEL PERÍODO",
                  {c: (f"=SUBTOTAL(9,{get_column_letter(c)}{r+1}:{get_column_letter(c)}{last})",
                       FMT_USD if c in (4, 5, 7, 9, 11) else FMT_BS)
                   for c in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11)})
    preparar_impresion(ws, 14)

    # ════════════════ 2) POR MÉTODO DE PAGO ════════════════
    ws = wb.create_sheet("Por método de pago")
    ws.sheet_properties.tabColor = TAB_COLORS["Por método de pago"]
    encabezado(ws, "COBROS ORDENADOS POR MÉTODO DE PAGO",
               f"{pie}   ·   Ventas y abonos juntos · filtrá un método en la flecha del encabezado y el "
               f"TOTAL de abajo se recalcula solo", 11)
    headers = ["Método de pago", "Moneda", "Fecha", "Origen", "Orden", "Producto / Equipo", "Cliente",
               "Cédula", "Nº de referencia", "Monto", "Total en Bs. (tasa del día)"]
    rows = []
    for c in cobros:
        rows.append([c["metodo"], c["moneda"], c["fecha"], c["origen"], c["orden"], c["detalle"],
                     c["cliente"], c["ci"], c["ref"], c["monto"],
                     money(c["monto"] * tasa_de(c["fecha"])) if c["moneda"] == "$" else c["monto"]])

    def pintar_metodo(wsx, rr, row, _i):
        if row[3] == "Abono":
            wsx.cell(row=rr, column=4).font = Font(color="6A1B9A")
    end = write_table(ws, 4, headers, rows, [22, 8, 11, 9, 11, 30, 22, 13, 22, 13, 20],
                      {10: "mix", 11: "bs"}, row_formats=pintar_metodo)
    if rows:
        last = end - 1
        total_row(ws, end, 11, "TOTAL (de lo que esté filtrado arriba)",
                  {10: (f"=SUBTOTAL(9,J5:J{last})", FMT_USD),
                   11: (f"=SUBTOTAL(9,K5:K{last})", FMT_BS)})
    preparar_impresion(ws, 11)

    # ════════════════ 3) PAGO MÓVIL (monto + Nº de referencia) ════════════════
    pm = [c for c in cobros if "móvil" in c["metodo"].lower() or "movil" in c["metodo"].lower()]
    pm.sort(key=lambda c: (c["fecha"], c["origen"]))
    ws = wb.create_sheet("Pago Móvil")
    ws.sheet_properties.tabColor = TAB_COLORS["Pago Móvil"]
    encabezado(ws, "PAGO MÓVIL — MONTO Y NÚMERO DE REFERENCIA",
               f"{pie}   ·   {len(pm)} operación(es) · para conciliar contra el banco una por una", 9)
    headers = ["Fecha", "Origen", "Orden", "Producto / Equipo", "Cliente", "Cédula",
               "Nº de referencia (últimos dígitos)", "Monto Bs.", "Notas"]
    rows = []
    for c in pm:
        rows.append([c["fecha"], c["origen"], c["orden"], c["detalle"], c["cliente"], c["ci"],
                     c["ref"] or "(sin referencia anotada)", c["monto"], ""])
    end = write_table(ws, 4, headers, rows, [12, 9, 12, 30, 22, 13, 26, 15, 26], {8: "bs"})
    if rows:
        last = end - 1
        total_row(ws, end, 9, "TOTAL PAGO MÓVIL EN Bs. (de lo filtrado)",
                  {8: (f"=SUBTOTAL(9,H5:H{last})", FMT_BS)})
        faltan = sum(1 for c in pm if not c["ref"])
        if faltan:
            ws.cell(row=end + 2, column=1,
                    value=f"OJO: {faltan} pago(s) móvil(es) SIN número de referencia anotado: hay que "
                          f"buscarlo en el banco o pedírselo al cliente.").font = Font(bold=True, color="9C0006")
    preparar_impresion(ws, 9)

    # ════════════════ 4) VENTAS ════════════════
    ws = wb.create_sheet("Ventas")
    ws.sheet_properties.tabColor = TAB_COLORS["Ventas"]
    encabezado(ws, "VENTAS", f"{pie}   ·   ordenadas por método de pago y fecha", 13)
    headers = ["Método", "Fecha", "Cliente", "Cédula", "Producto", "Cant.", "Precio unit.",
               "Moneda", "Nº de referencia", "Base imponible", "IVA", "Total cobrado", "Estado"]
    filas = []
    for d in days:
        for s in d.get("sales", []):
            anulada = str(s.get("product", "")).startswith("(ANULADA)")
            base, iva_m = iva_split(s.get("total"), s.get("iva_rate"))
            filas.append([metodo_base(s.get("method")), (s.get("date") or "")[:10], s.get("client", ""),
                          s.get("ci", ""), s.get("product", ""), int(s.get("qty", 0)),
                          money(s.get("unit")), "Bs." if es_bs(s.get("currency")) else "$",
                          s.get("ref", "") or "", base, iva_m, money(s.get("total")),
                          "ANULADA (no cuenta)" if anulada else "Vigente"])
    filas.sort(key=lambda x: (x[0].lower(), x[1]))

    def pintar_anulada(wsx, rr, row, _i):
        if row[12].startswith("ANULADA"):
            for c in range(1, 14):
                wsx.cell(row=rr, column=c).fill = WARN_FILL
            wsx.cell(row=rr, column=13).font = WARN_FONT
    end = write_table(ws, 4, headers, filas, [20, 11, 22, 13, 32, 7, 12, 8, 18, 13, 11, 13, 18],
                      {7: "mix", 10: "mix", 11: "mix", 12: "mix"}, row_formats=pintar_anulada)
    if filas:
        last = end - 1
        total_row(ws, end, 13, "TOTAL (de lo filtrado · filtrá Estado = Vigente para lo que vale)",
                  {6: (f"=SUBTOTAL(9,F5:F{last})", FMT_INT),
                   10: (f"=SUBTOTAL(9,J5:J{last})", FMT_USD),
                   11: (f"=SUBTOTAL(9,K5:K{last})", FMT_USD),
                   12: (f"=SUBTOTAL(9,L5:L{last})", FMT_USD)})
    preparar_impresion(ws, 13)

    # ════════════════ 5) SERVICIOS ════════════════
    ws = wb.create_sheet("Servicios")
    ws.sheet_properties.tabColor = TAB_COLORS["Servicios"]
    encabezado(ws, "ÓRDENES DE SERVICIO", f"{pie}   ·   recibidas en el rango", 15)
    headers = ["Recibido", "Orden", "Cliente", "Cédula", "Técnico", "Equipo", "Trabajos",
               "Base imponible", "IVA", "Total", "Abonado", "Saldo", "Estado", "Entregado",
               "Pantalla instalada"]
    rows = []
    for s in services:
        types = s.get("types", "")
        try:
            tj = json.loads(types)
            types = ", ".join(tj) if isinstance(tj, list) else types
        except Exception:
            pass
        base, iva_m = iva_split(s.get("amount"), s.get("iva_rate"))
        rows.append([(s.get("date_in") or "")[:10], s.get("order", ""), s.get("client", ""),
                     s.get("ci", ""), s.get("technician", ""), s.get("model", ""), types,
                     base, iva_m, money(s.get("amount")), money(s.get("paid")),
                     round(money(s.get("amount")) - money(s.get("paid")), 2),
                     s.get("status", ""), (s.get("date_out") or "")[:10] or "", s.get("screen", "")])
    end = write_table(ws, 4, headers, rows, [11, 11, 22, 13, 12, 24, 28, 13, 11, 12, 12, 12, 16, 11, 30],
                      {8: "usd", 9: "usd", 10: "usd", 11: "usd", 12: "usd"})
    if rows:
        last = end - 1
        total_row(ws, end, 15, "TOTAL (de lo filtrado)",
                  {8: (f"=SUBTOTAL(9,H5:H{last})", FMT_USD),
                   9: (f"=SUBTOTAL(9,I5:I{last})", FMT_USD),
                   10: (f"=SUBTOTAL(9,J5:J{last})", FMT_USD),
                   11: (f"=SUBTOTAL(9,K5:K{last})", FMT_USD),
                   12: (f"=SUBTOTAL(9,L5:L{last})", FMT_USD)})
    preparar_impresion(ws, 15)

    # ════════════════ 6) PAGOS Y ABONOS ════════════════
    ws = wb.create_sheet("Pagos y Abonos")
    ws.sheet_properties.tabColor = TAB_COLORS["Pagos y Abonos"]
    encabezado(ws, "PAGOS Y ABONOS DE SERVICIOS", f"{pie}   ·   ordenados por método de pago", 11)
    headers = ["Método", "Fecha", "Orden", "Cliente", "Cédula", "Equipo", "Moneda", "Monto",
               "Nº de referencia", "Notas", "Total en Bs. (tasa del día)"]
    rows = []
    for d in days:
        for p in d.get("payments", []):
            fecha = (p.get("date") or "")[:10]
            es_b = es_bs(p.get("currency"))
            rows.append([metodo_base(p.get("method")), fecha, p.get("order", ""), p.get("client", ""),
                         p.get("ci", ""), p.get("model", ""), "Bs." if es_b else "$",
                         money(p.get("amount")), p.get("ref", "") or "", p.get("notes", ""),
                         money(p.get("amount")) if es_b else money(money(p.get("amount")) * tasa_de(fecha))])
    rows.sort(key=lambda x: (x[0].lower(), x[1]))
    end = write_table(ws, 4, headers, rows, [20, 11, 12, 22, 13, 24, 8, 12, 20, 26, 20],
                      {8: "mix", 11: "bs"})
    if rows:
        last = end - 1
        total_row(ws, end, 11, "TOTAL (de lo filtrado)",
                  {8: (f"=SUBTOTAL(9,H5:H{last})", FMT_USD),
                   11: (f"=SUBTOTAL(9,K5:K{last})", FMT_BS)})
    preparar_impresion(ws, 11)

    # ════════════════ 7) IVA DEL PERÍODO ════════════════
    ws = wb.create_sheet("IVA del período")
    ws.sheet_properties.tabColor = TAB_COLORS["IVA del período"]
    encabezado(ws, "IVA DEL PERÍODO — LIBRO PARA DECLARAR",
               f"{pie}   ·   la alícuota es la de CADA operación (una operación vieja no cambia si hoy "
               f"movés la alícuota) · las ventas ANULADAS no cuentan", 6)

    # Por alícuota y por tipo (ventas / servicios).
    grupos = OrderedDict()
    for d in days:
        for s in d.get("sales", []):
            if str(s.get("product", "")).startswith("(ANULADA)"):
                continue
            r_ = money(s.get("iva_rate"))
            base, iva_m = iva_split(s.get("total"), r_)
            k = ("Ventas", r_)
            g = grupos.setdefault(k, {"ops": 0, "base": 0.0, "iva": 0.0, "total": 0.0})
            g["ops"] += 1
            g["base"] = round(g["base"] + base, 2)
            g["iva"] = round(g["iva"] + iva_m, 2)
            g["total"] = round(g["total"] + money(s.get("total")), 2)
    for s in services:
        r_ = money(s.get("iva_rate"))
        base, iva_m = iva_split(s.get("amount"), r_)
        k = ("Servicios", r_)
        g = grupos.setdefault(k, {"ops": 0, "base": 0.0, "iva": 0.0, "total": 0.0})
        g["ops"] += 1
        g["base"] = round(g["base"] + base, 2)
        g["iva"] = round(g["iva"] + iva_m, 2)
        g["total"] = round(g["total"] + money(s.get("amount")), 2)

    rows = []
    for (tipo, r_), g in sorted(grupos.items(), key=lambda kv: (kv[0][0], -kv[0][1])):
        alic = f"{r_:.2f}%".replace(".00%", "%") if r_ > 0 else "Sin IVA / exento"
        rows.append([tipo, alic, g["ops"], g["base"], g["iva"], g["total"]])
    end = write_table(ws, 4, ["Tipo", "Alícuota", "Operaciones", "Base imponible", "IVA", "Total cobrado"],
                      rows, [14, 18, 12, 15, 13, 15], {3: "int", 4: "usd", 5: "usd", 6: "usd"})
    if rows:
        last = end - 1
        total_row(ws, end, 6, "TOTALES",
                  {3: (f"=SUM(C5:C{last})", FMT_INT),
                   4: (f"=SUM(D5:D{last})", FMT_USD),
                   5: (f"=SUM(E5:E{last})", FMT_USD),
                   6: (f"=SUM(F5:F{last})", FMT_USD)})

    # Detalle de las operaciones gravadas (con su alícuota), para auditar cualquier total.
    r = end + 2
    ws.cell(row=r, column=1, value="DETALLE DE OPERACIONES CON IVA").font = SUB_FONT
    r += 1
    det = []
    for d in days:
        for s in d.get("sales", []):
            if money(s.get("iva_rate")) > 0 and not str(s.get("product", "")).startswith("(ANULADA)"):
                base, iva_m = iva_split(s.get("total"), s.get("iva_rate"))
                det.append([(s.get("date") or "")[:10], "Venta", s.get("client", ""), s.get("product", ""),
                            f"{money(s.get('iva_rate')):g}%", base, iva_m, money(s.get("total"))])
    for s in services:
        if money(s.get("iva_rate")) > 0:
            base, iva_m = iva_split(s.get("amount"), s.get("iva_rate"))
            det.append([(s.get("date_in") or "")[:10], "Servicio", s.get("client", ""),
                        s.get("model", ""), f"{money(s.get('iva_rate')):g}%", base, iva_m,
                        money(s.get("amount"))])
    det.sort(key=lambda x: x[0])
    end2 = write_table(ws, r, ["Fecha", "Tipo", "Cliente", "Detalle", "Alícuota", "Base", "IVA", "Total"],
                       det, [12, 10, 22, 30, 10, 13, 12, 13], {6: "usd", 7: "usd", 8: "usd"})
    if det:
        last = end2 - 1
        total_row(ws, end2, 8, "TOTAL GRAVADO",
                  {6: (f"=SUBTOTAL(9,F{r+1}:F{last})", FMT_USD),
                   7: (f"=SUBTOTAL(9,G{r+1}:G{last})", FMT_USD),
                   8: (f"=SUBTOTAL(9,H{r+1}:H{last})", FMT_USD)})
    ws.cell(row=end2 + 2, column=1,
            value="El IVA en bolívares se paga con la tasa BCV del día del cobro: la equivalencia de "
                  "cada día está en la hoja «Resumen» (columna Tasa BCV) y en cada cobro de la hoja "
                  "«Por método de pago».").font = Font(italic=True, size=9, color="595959")
    preparar_impresion(ws, 8)

    # ════════════════ 8) CIERRES DE CAJA ════════════════
    closed = [d for d in days if d.get("closing")]
    if closed:
        ws = wb.create_sheet("Cierres de caja")
        ws.sheet_properties.tabColor = TAB_COLORS["Cierres de caja"]
        encabezado(ws, "CIERRES DE CAJA (ARQUEO)",
                   f"{pie}   ·   la diferencia se mide POR MONEDA (el $ y el Bs. no se mezclan)", 14)
        headers = ["Fecha", "Cerrado a", "Apertura $", "Punto impr. $", "Punto impr. Bs.", "Arqueo $",
                   "Arqueo Bs.", "Arqueo Punto $", "Arqueo Punto Bs.", "Arqueo Zelle", "Arqueo PM Bs.",
                   "Arqueo Transf. Bs.", "Diferencia (mezclada, informativa)", "Notas"]
        rows = []
        for d in closed:
            c = d["closing"]
            rows.append([d.get("date", ""), (c.get("closed_at") or "")[:16], money(c.get("initial_cash_usd")),
                         money(c.get("pos_settled")), money(c.get("pos_settled_bs")),
                         money(c.get("actual_cash_usd")), money(c.get("actual_cash_bs")),
                         money(c.get("actual_punto_usd")), money(c.get("actual_punto_bs")),
                         money(c.get("actual_zelle")), money(c.get("actual_pago_movil")),
                         money(c.get("actual_transfer_bs")), money(c.get("difference")),
                         c.get("notes", "")])
        end = write_table(ws, 4, headers, rows,
                          [12, 17, 11, 13, 14, 11, 12, 14, 15, 12, 13, 15, 20, 34],
                          {3: "usd", 4: "usd", 5: "bs", 6: "usd", 7: "bs", 8: "usd", 9: "bs",
                           10: "usd", 11: "bs", 12: "bs", 13: "usd"})
        preparar_impresion(ws, 14)

    # ════════════════ 9) GASTOS ════════════════
    if expenses:
        ws = wb.create_sheet("Gastos")
        ws.sheet_properties.tabColor = TAB_COLORS["Gastos"]
        encabezado(ws, "GASTOS DEL NEGOCIO", f"{pie}   ·   totales separados por moneda (nunca se suman $ y Bs.)", 5)
        rows = [[e.get("date", ""), e.get("category", ""), money(e.get("amount")),
                 "Bs." if es_bs(e.get("currency")) else "$", e.get("notes", "")] for e in expenses]
        end = write_table(ws, 4, ["Fecha", "Categoría", "Monto", "Moneda", "Notas"], rows,
                          [12, 22, 13, 8, 44], {3: "mix"})
        if rows:
            last = end - 1
            total_row(ws, end, 5, "TOTAL $ (del rango)",
                      {3: (f'=SUMIFS(C5:C{last},D5:D{last},"$")', FMT_USD)})
            total_row(ws, end + 1, 5, "TOTAL Bs. (del rango)",
                      {3: (f'=SUMIFS(C5:C{last},D5:D{last},"Bs.")', FMT_BS)}, tone="sub")
        preparar_impresion(ws, 5)

    # ════════════════ 10) MOVIMIENTOS DE INVENTARIO ════════════════
    ws = wb.create_sheet("Movimientos")
    ws.sheet_properties.tabColor = TAB_COLORS["Movimientos"]
    encabezado(ws, "MOVIMIENTOS DE INVENTARIO", f"{pie}   ·   entradas y salidas de mercancía", 6)
    rows = [[(m.get("date") or "")[:10], m.get("product", ""), m.get("type", ""),
             int(m.get("qty", 0)), m.get("reason", ""), m.get("ref", "")] for m in movements]
    end = write_table(ws, 4, ["Fecha", "Producto", "Tipo", "Cantidad", "Razón", "Referencia"], rows,
                      [12, 40, 12, 10, 28, 16], {4: "int"})
    if rows:
        last = end - 1
        total_row(ws, end, 6, "TOTAL (de lo filtrado)",
                  {4: (f"=SUBTOTAL(9,D5:D{last})", FMT_INT)})
    preparar_impresion(ws, 6)

    wb.save(sys.argv[2])
    print("OK")


if __name__ == "__main__":
    main()
