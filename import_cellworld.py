"""Import CELL WORLD price list from PDF into the inventory database."""
import json
import sqlite3
import re
from pypdf import PdfReader

PDF_PATH = r"C:\Users\ROBER\Downloads\CELL WORLD PANTALLAS 09-07-2026_.pdf"
DB_PATH = r"C:\Users\ROBER\registro\registro.db"


def extract_text(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        t = page.extract_text()
        if t:
            text += t + "\n"
    return text


def clean_line(line: str) -> str:
    """Remove common noise from line endings."""
    return line.strip().rstrip("/").strip()


def parse_items(text: str) -> list[dict]:
    items = []
    lines = text.split("\n")

    # Category detection
    current_category = "Pantalla"

    for line in lines:
        line = line.strip()

        # Skip headers and noise
        if not line or "CELL WORLD" in line or "DESCRIPCION" in line or "MAYOR" in line:
            if "TACTIL TABLET" in line:
                current_category = "Táctil Tablet"
            elif "TACTIL" in line and "TABLET" not in line:
                current_category = "Táctil"
            elif "3/4" in line or "2/4" in line or "4/4" in line:
                current_category = "Pantalla"
            continue

        # Detect category markers
        if line.startswith("TACTIL TABLET"):
            current_category = "Táctil Tablet"
            line = line[len("TACTIL TABLET"):].strip()
        elif line.startswith("TACTIL") and not line.startswith("TACTIL TABLET"):
            current_category = "Táctil"
            line = line[len("TACTIL"):].strip()
        elif line.startswith(("3/4 ", "2/4 ", "4/4 ")):
            current_category = "Pantalla"
            line = line[4:].strip()  # Remove "3/4 " prefix

        if not line:
            continue

        # Skip lines that are not product entries
        if line.startswith("TACTIL") or any(x in line for x in ["FECHA", "AL COMPRAR", "AGOTADO", "CELL WORLD"]):
            continue

        # Check for AGOTADO
        agotado = "AGOTADO" in line.upper()
        if agotado:
            line = line.replace("AGOTADO", "").strip()

        # Try to parse: NAME PRICE_COST PRICE_DETAL
        # The price is at the end, numbers like "10 12,5" or "45 56,25"
        price_pattern = r"(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$"
        m = re.search(price_pattern, line)
        if not m:
            continue

        price_cost_str = m.group(1).replace(",", ".")
        price_sale_str = m.group(2).replace(",", ".")
        try:
            price_cost = float(price_cost_str)
            price_sale = float(price_sale_str)
        except ValueError:
            continue

        # Extract name (everything before the prices)
        name_part = line[:m.start()].strip().rstrip("/").strip()
        if not name_part:
            continue

        # Parse brand and model from name
        # Detect variant keywords
        variant_keywords = [
            "INCELL CON MARCO", "INCELL", "OLED CON MARCO", "OLED",
            "ORIGINAL CON MARCO", "ORIGINAL SIN MARCO", "ORIGINAL",
            "AMOLED CON MARCO", "AMOLED", "OLED/2",
        ]
        variant = ""
        for vk in variant_keywords:
            if vk in name_part.upper():
                variant = vk
                name_part = name_part.upper().replace(vk, "").strip()
                break

        # Determine brand
        known_brands = [
            "ALCATEL", "BLACKVIEW", "BLU", "GOOGLE PIXEL", "HUAWEI", "HONOR",
            "HYUNDAI", "INFINIX", "IPHONE", "ITEL", "LG", "LIFEPHONE",
            "MOTOROLA", "ONEPLUS", "OPPO", "REALME", "SAMSUNG", "TCL",
            "TECNO", "UMIDIGI", "VIVO", "XIAOMI", "YEZZ", "ZTE", "KRIP",
            "HTC", "NOKIA", "SONY",
        ]

        # For Táctil category
        brand = ""
        model = name_part
        for bk in known_brands:
            if name_part.upper().startswith(bk):
                brand = bk.title() if bk != "IPHONE" else "Apple"
                model = name_part[len(bk):].strip()
                break

        # For iPhones, the model might start with model number
        if brand == "Apple" or "IPHONE" in name_part.upper():
            brand = "Apple"
            model = name_part
            if name_part.upper().startswith("IPHONE"):
                model = name_part[len("IPHONE"):].strip()

        # Build compatibility from multi-model entries (separated by /)
        compatibility = ""
        if "/" in model:
            models = [m.strip() for m in re.split(r'\s*/\s*', model)]
            if len(models) > 1:
                # First model is the primary, rest are compatibility
                compatibility = json.dumps(models)

        # Build product name
        product_name = f"{'Pantalla' if current_category == 'Pantalla' else ('Táctil' if current_category == 'Táctil' else 'Táctil Tablet')} {brand} {model}".strip()
        if variant:
            product_name = f"{product_name} ({variant})"

        items.append({
            "name": product_name.strip(),
            "brand": brand,
            "model": model.strip(),
            "variant": variant,
            "category": current_category,
            "price_cost": price_cost,
            "price_sale": price_sale,
            "compatibility": compatibility,
            "agotado": agotado,
        })

    return items


def main():
    print("Extracting text from PDF...")
    text = extract_text(PDF_PATH)

    print("Parsing items...")
    items = parse_items(text)
    print(f"Found {len(items)} items")

    # Save as JSON for review
    with open("cellworld_items.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(items)} items to cellworld_items.json")

    # Import into database
    print("Importing into database...")
    items_json = json.dumps(items)
    
    # Import via Rust backend or directly via SQLite
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get category IDs
    cursor.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Pantalla')")
    cursor.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Táctil')")
    cursor.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Táctil Tablet')")
    conn.commit()
    
    cursor.execute("SELECT id, name FROM categories")
    cat_map = {name: id for id, name in cursor.fetchall()}
    
    imported = 0
    skipped = 0
    for item in items:
        cat_id = cat_map.get(item["category"], cat_map.get("Pantalla", 1))
        try:
            cursor.execute(
                """INSERT INTO products (name, category_id, brand, model, variant, compatibility, price_cost, price_sale, stock, min_stock)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)""",
                (item["name"], cat_id, item["brand"], item["model"],
                 item["variant"], item["compatibility"],
                 item["price_cost"], item["price_sale"])
            )
            imported += 1
        except sqlite3.IntegrityError:
            skipped += 1
    
    conn.commit()
    conn.close()
    print(f"Imported: {imported}, Skipped (duplicates): {skipped}")
    print("Done!")


if __name__ == "__main__":
    main()
