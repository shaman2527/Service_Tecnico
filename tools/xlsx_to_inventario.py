# Convierte Inventario_Consolidado_Final.xlsx (hoja "Pantallas") a tools/inventario_real.txt
# (formato del loader: secciones por marca, "<modelo> (N)" por línea).
# Uso: python tools/xlsx_to_inventario.py [ruta.xlsx]
import sys, re
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\ROBER\Downloads\Inventario_Consolidado_Final.xlsx'
OUT = r'C:\Users\ROBER\registro\tools\inventario_real.txt'

wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb['Pantallas']

# Normaliza el modelo: espacios colapsados, sin puntos/coma finales; conserva "/" y "(...)".
def norm_model(m):
    m = re.sub(r'\s+', ' ', m).strip()
    m = re.sub(r'[.,]\s*$', '', m)
    return m

sections = {}   # marca -> [(modelo, qty)]
order = []
skipped = []
for row in ws.iter_rows(min_row=2, values_only=True):
    brand = (str(row[0]).strip() if row[0] is not None else '')
    model = (str(row[1]).strip() if row[1] is not None else '')
    qty = row[2] if row[2] is not None else 0
    if not model:
        continue
    if not brand:
        skipped.append(('sin-marca', model, qty))
        continue
    if brand not in sections:
        sections[brand] = []
        order.append(brand)
    sections[brand].append((norm_model(model), int(qty)))

lines = []
total = 0
for brand in order:
    lines.append(brand)
    lines.append('')
    for model, qty in sections[brand]:
        lines.append(f'{model} ({qty})')
        total += qty
    lines.append('')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f'Marcas: {order}')
print(f'Lineas: {sum(len(i) for i in sections.values())} | Unidades: {total}')
if skipped:
    print('OMITIDAS (sin marca):')
    for s in skipped:
        print('  ', s)