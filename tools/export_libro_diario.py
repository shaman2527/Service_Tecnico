#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Exporta el Libro Diario a un Excel profesional (.xlsx) con openpyxl.

Uso: python export_libro_diario.py <data.json> <salida.xlsx>

El JSON lo genera el backend Rust (export_daily_report_xlsx) y contiene:
  days[].date/sales/payments/pago_movil/totals/closing
  services[], movements[]

El workbook tiene 5 hojas con tablas estilizadas y AUTO-FILTROS (el usuario
filtra por cliente del día, método, producto, técnico, estado, monto...):
  Resumen      -> totales por día + cierres
  Ventas       -> cada venta con cliente/cédula/producto/monto
  Servicios    -> órdenes recibidas en el rango (técnico, trabajos, saldo, pantalla)
  Pagos/Abonos -> cada pago de servicio
  Movimientos  -> inventario (entradas/salidas)
"""
import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

FMT_USD = '"$"#,##0.00'
FMT_BS = '"Bs." #,##0.00'
FMT_INT = '#,##0'
HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=14, color="1F4E79")
SUB_FILL = PatternFill("solid", fgColor="DDEBF7")
SUB_FONT = Font(bold=True, size=11)
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TAB_COLORS = {"Resumen": "1F4E79", "Ventas": "2E7D32", "Servicios": "E65100",
              "Pagos y Abonos": "6A1B9A", "Movimientos": "00695C", "Cierres": "B71C1C",
              "Gastos": "8E44AD"}


def write_table(ws, start_row, headers, rows, widths, money_cols=None, tab="", row_height=None):
    """Escribe una tabla con header estilizado, freeze y autofilter."""
    money_cols = money_cols or {}
    hcol = len(headers)
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=start_row, column=c, value=h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    r = start_row + 1
    for row in rows:
        for c, v in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.border = BORDER
            fmt = money_cols.get(c)
            if fmt == "usd":
                cell.number_format = FMT_USD
            elif fmt == "bs":
                cell.number_format = FMT_BS
            elif fmt == "int":
                cell.number_format = FMT_INT
        r += 1
    for c, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = f"A{start_row + 1}"
    if rows:
        ws.auto_filter.ref = f"A{start_row}:{get_column_letter(hcol)}{r - 1}"
    return r  # primera fila libre después de la tabla


def money(v):
    return 0.0 if v is None else float(v)


def subtotal_row(ws, row, ncols, label, formula_cells):
    """Fila de totales con SUBTOTAL(9,...) → se recalcula al filtrar en Excel."""
    cell = ws.cell(row=row, column=1, value=label)
    cell.font = SUB_FONT
    cell.fill = SUB_FILL
    for c in range(1, ncols + 1):
        ws.cell(row=row, column=c).fill = SUB_FILL
        ws.cell(row=row, column=c).border = BORDER
        if c in formula_cells:
            fcell = ws.cell(row=row, column=c)
            fcell.value = formula_cells[c]["value"]
            fcell.number_format = formula_cells[c]["fmt"]
            fcell.font = SUB_FONT


def main():
    if len(sys.argv) != 3:
        print("Uso: export_libro_diario.py <data.json> <salida.xlsx>", file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        data = json.load(f)

    wb = Workbook()
    wb.remove(wb.active)

    # ============ HOJA RESUMEN ============
    ws = wb.create_sheet("Resumen")
    ws.sheet_properties.tabColor = TAB_COLORS["Resumen"]
    ws.merge_cells("A1:N1")
    ws["A1"] = "LIBRO DIARIO — REGISTRO SERVICIO TÉCNICO"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A2:N2")
    ws["A2"] = f"Período: {data.get('start', '')} → {data.get('end', '')}   ·   Generado: {data.get('generado', '')}"
    ws["A2"].font = Font(italic=True, size=10, color="595959")

    days = data.get("days", [])
    headers = ["Fecha", "Ventas USD", "Ventas Bs", "Pago Móvil Bs", "Efectivo Bs",
               "Efectivo USD", "Punto Neto USD", "Punto Neto Bs", "Zelle USD",
               "Transf Bs", "Total USD", "Total Bs", "Total equiv USD", "Tasa BCV"]
    money_cols = {2: "usd", 3: "bs", 4: "bs", 5: "bs", 6: "usd", 7: "usd", 8: "bs",
                  9: "usd", 10: "bs", 11: "usd", 12: "bs", 13: "usd", 14: "bs"}
    rows = []
    for d in days:
        t = d.get("totals", {})
        rows.append([d.get("date", ""), money(t.get("grand_usd")), money(t.get("grand_bs")),
                     money(t.get("pago_movil_total")), money(t.get("cash_bs")),
                     money(t.get("cash_usd")), money(t.get("pos_net_usd")), money(t.get("pos_net_bs")),
                     money(t.get("zelle_total")), money(t.get("transfer_bs_total")),
                     money(t.get("grand_usd")), money(t.get("grand_bs")),
                     money(t.get("grand_total")), money(t.get("tasa_bcv"))])
    end = write_table(ws, 4, headers, rows, [12, 11, 12, 12, 11, 11, 12, 12, 11, 11, 11, 12, 12, 9], money_cols)
    if rows:
        last = end - 1
        subtotal_row(ws, end, 14, "TOTAL PERÍODO",
                     {c: {"value": f"=SUBTOTAL(9,{get_column_letter(c)}5:{get_column_letter(c)}{last})",
                          "fmt": FMT_USD if c in (2, 6, 7, 9, 11, 13) else FMT_BS} for c in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)})

    # ---- Tabla de cierres → hoja propia (openpyxl: un solo autofilter por hoja) ----
    closed = [d for d in days if d.get("closing")]
    if closed:
        wc = wb.create_sheet("Cierres")
        wc.sheet_properties.tabColor = TAB_COLORS["Cierres"]
        headers_c = ["Fecha", "Cerrado a", "Apertura USD", "Punto impr. USD", "Punto impr. Bs", "Arqueo USD",
                     "Arqueo Bs", "Arqueo Punto USD", "Arqueo Punto Bs", "Arqueo Zelle",
                     "Arqueo PM Bs", "Arqueo Transf Bs", "Diferencia", "Notas"]
        rows_c = []
        for d in closed:
            c = d["closing"]
            rows_c.append([d.get("date", ""), c.get("closed_at", "")[:16], money(c.get("initial_cash_usd")),
                           money(c.get("pos_settled")), money(c.get("pos_settled_bs")),
                           money(c.get("actual_cash_usd")), money(c.get("actual_cash_bs")),
                           money(c.get("actual_punto_usd")), money(c.get("actual_punto_bs")),
                           money(c.get("actual_zelle")), money(c.get("actual_pago_movil")),
                           money(c.get("actual_transfer_bs")), money(c.get("difference")), c.get("notes", "")])
        money_c = {3: "usd", 4: "usd", 5: "bs", 6: "usd", 7: "bs", 8: "usd", 9: "bs",
                   10: "usd", 11: "bs", 12: "bs", 13: "usd"}
        wc.merge_cells("A1:N1")
        wc["A1"] = f"CIERRES DE CAJA — {data.get('start', '')} → {data.get('end', '')}"
        wc["A1"].font = TITLE_FONT
        write_table(wc, 3, headers_c, rows_c, [12, 17, 11, 12, 12, 11, 11, 13, 13, 11, 12, 13, 11, 40], money_c)

    # ============ HOJA VENTAS ============
    ws = wb.create_sheet("Ventas")
    ws.sheet_properties.tabColor = TAB_COLORS["Ventas"]
    headers = ["Fecha", "Cliente", "Cédula", "Producto", "Cant", "Precio Unit", "Total", "Moneda", "Método", "Referencia"]
    money_cols = {5: "int", 6: "mix", 7: "mix"}
    rows = []
    for d in days:
        for s in d.get("sales", []):
            rows.append([s.get("date", ""), s.get("client", ""), s.get("ci", ""), s.get("product", ""),
                         int(s.get("qty", 0)), s.get("unit", 0), s.get("total", 0),
                         "Bs." if s.get("currency") == "VES" else "$", s.get("method", ""), s.get("ref", "")])
    first = 1
    ws.merge_cells("A1:J1")
    ws["A1"] = f"VENTAS — {data.get('start', '')} → {data.get('end', '')}"
    ws["A1"].font = TITLE_FONT
    end = write_table(ws, 3, headers, rows, [18, 22, 13, 34, 7, 12, 12, 8, 20, 16], money_cols, "Ventas")
    if rows:
        last = end - 1
        for r in range(4, end):  # formato de moneda por fila (depende de la columna Moneda)
            cur = ws.cell(row=r, column=8).value
            for c in (6, 7):
                ws.cell(row=r, column=c).number_format = FMT_USD if cur != "Bs." else FMT_BS
        subtotal_row(ws, end, 10, "TOTAL (filtrado)",
                     {5: {"value": f"=SUBTOTAL(9,E4:E{last})", "fmt": FMT_INT},
                      7: {"value": f'=SUBTOTAL(9,G4:G{last})', "fmt": FMT_USD}})

    # ============ HOJA SERVICIOS ============
    ws = wb.create_sheet("Servicios")
    ws.sheet_properties.tabColor = TAB_COLORS["Servicios"]
    headers = ["Recibido", "Orden", "Cliente", "Cédula", "Técnico", "Equipo", "Trabajos",
               "Monto $", "Abonado $", "Saldo $", "Estado", "Entregado", "Pantalla instalada"]
    money_cols = {8: "usd", 9: "usd", 10: "usd"}
    rows = []
    for s in data.get("services", []):
        types = s.get("types", "")
        try:
            import json as _j
            tj = _j.loads(types)
            types = ", ".join(tj) if isinstance(tj, list) else types
        except Exception:
            pass
        rows.append([s.get("date_in", "")[:10], s.get("order", ""), s.get("client", ""), s.get("ci", ""),
                     s.get("technician", ""), s.get("model", ""), types, money(s.get("amount")),
                     money(s.get("paid")), round(money(s.get("amount")) - money(s.get("paid")), 2),
                     s.get("status", ""), s.get("date_out", "")[:10] or "", s.get("screen", "")])
    ws.merge_cells("A1:M1")
    ws["A1"] = f"SERVICIOS RECIBIDOS — {data.get('start', '')} → {data.get('end', '')}"
    ws["A1"].font = TITLE_FONT
    end = write_table(ws, 3, headers, rows, [11, 11, 22, 13, 12, 26, 30, 10, 10, 10, 16, 11, 34], money_cols, "Servicios")
    if rows:
        last = end - 1
        subtotal_row(ws, end, 13, "TOTAL (filtrado)",
                     {8: {"value": f"=SUBTOTAL(9,H4:H{last})", "fmt": FMT_USD},
                      9: {"value": f"=SUBTOTAL(9,I4:I{last})", "fmt": FMT_USD},
                      10: {"value": f"=SUBTOTAL(9,J4:J{last})", "fmt": FMT_USD}})

    # ============ HOJA PAGOS Y ABONOS ============
    ws = wb.create_sheet("Pagos y Abonos")
    ws.sheet_properties.tabColor = TAB_COLORS["Pagos y Abonos"]
    headers = ["Fecha", "Orden", "Cliente", "Cédula", "Equipo", "Monto", "Moneda", "Método", "Referencia", "Notas"]
    money_cols = {6: "mix"}
    rows = []
    for d in days:
        for p in d.get("payments", []):
            rows.append([p.get("date", ""), p.get("order", ""), p.get("client", ""), p.get("ci", ""),
                         p.get("model", ""), p.get("amount", 0),
                         "Bs." if p.get("currency") == "VES" else "$", p.get("method", ""),
                         p.get("ref", ""), p.get("notes", "")])
    ws.merge_cells("A1:J1")
    ws["A1"] = f"PAGOS Y ABONOS — {data.get('start', '')} → {data.get('end', '')}"
    ws["A1"].font = TITLE_FONT
    end = write_table(ws, 3, headers, rows, [18, 13, 22, 13, 26, 11, 8, 20, 16, 30], money_cols, "Pagos y Abonos")
    if rows:
        last = end - 1
        for r in range(4, end):
            cur = ws.cell(row=r, column=7).value
            ws.cell(row=r, column=6).number_format = FMT_USD if cur != "Bs." else FMT_BS
        subtotal_row(ws, end, 10, "TOTAL (filtrado)",
                     {6: {"value": f"=SUBTOTAL(9,F4:F{last})", "fmt": FMT_USD}})

    # ============ HOJA GASTOS ============
    expenses = data.get("expenses", [])
    if expenses:
        ws = wb.create_sheet("Gastos")
        ws.sheet_properties.tabColor = TAB_COLORS["Gastos"]
        headers = ["Fecha", "Categoría", "Monto", "Moneda", "Notas"]
        rows = []
        for e in expenses:
            rows.append([e.get("date", ""), e.get("category", ""), money(e.get("amount")),
                         "Bs." if e.get("currency") == "VES" else "$", e.get("notes", "")])
        ws.merge_cells("A1:E1")
        ws["A1"] = f"GASTOS DEL NEGOCIO — {data.get('start', '')} → {data.get('end', '')}"
        ws["A1"].font = TITLE_FONT
        end = write_table(ws, 3, headers, rows, [12, 20, 12, 8, 44], {3: "mix"}, "Gastos")
        if rows:
            last = end - 1
            for r in range(4, end):
                cur = ws.cell(row=r, column=4).value
                ws.cell(row=r, column=3).number_format = FMT_USD if cur != "Bs." else FMT_BS
            # Dos totales separados por moneda (NUNCA sumar USD + Bs en bruto)
            for label, cur, fmt, offset in (("TOTAL USD (rango)", "$", FMT_USD, 0),
                                            ("TOTAL Bs. (rango)", "Bs.", FMT_BS, 1)):
                r = end + offset
                subtotal_row(ws, r, 5, label,
                             {3: {"value": f'=SUMIFS(C4:C{last},D4:D{last},"{cur}")', "fmt": fmt}})

    # ============ HOJA MOVIMIENTOS ============
    ws = wb.create_sheet("Movimientos")
    ws.sheet_properties.tabColor = TAB_COLORS["Movimientos"]
    headers = ["Fecha", "Producto", "Tipo", "Cantidad", "Razón", "Referencia"]
    money_cols = {4: "int"}
    rows = []
    for m in data.get("movements", []):
        rows.append([m.get("date", "")[:10], m.get("product", ""), m.get("type", ""),
                     int(m.get("qty", 0)), m.get("reason", ""), m.get("ref", "")])
    ws.merge_cells("A1:F1")
    ws["A1"] = f"MOVIMIENTOS DE INVENTARIO — {data.get('start', '')} → {data.get('end', '')}"
    ws["A1"].font = TITLE_FONT
    end = write_table(ws, 3, headers, rows, [18, 40, 12, 10, 26, 16], money_cols, "Movimientos")
    if rows:
        last = end - 1
        ws.cell(row=end, column=1, value="TOTAL (filtrado)").font = SUB_FONT
        ws.cell(row=end, column=4).value = f"=SUBTOTAL(9,D4:D{last})"
        ws.cell(row=end, column=4).number_format = FMT_INT
        for c in range(1, 7):
            ws.cell(row=end, column=c).fill = SUB_FILL
            ws.cell(row=end, column=c).border = BORDER

    wb.save(sys.argv[2])
    print("OK")


if __name__ == "__main__":
    main()
