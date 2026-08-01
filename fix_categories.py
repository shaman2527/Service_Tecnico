import sqlite3, shutil, os, datetime

src = r'C:\Users\ROBER\registro\registro.db'
# 1. Backup
bak = r'C:\Users\ROBER\registro\backup\registro_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '.db'
os.makedirs(os.path.dirname(bak), exist_ok=True)
shutil.copy2(src, bak)
print(f'BACKUP: {bak}')

c = sqlite3.connect(src)
cur = c.cursor()

# 2. Clean duplicate categories (Telefono without accent -> merge into Teléfono)
cur.execute("SELECT id, name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as cnt FROM categories c ORDER BY id")
cats = cur.fetchall()
print('\nCATEGORIES BEFORE:')
for r in cats:
    print(f'  {r[0]}: {r[1]} ({r[2]} products)')

# Merge products from 'Telefono' (14) into 'Teléfono' (2)
cur.execute("UPDATE products SET category_id=2 WHERE category_id=14")
cur.execute("DELETE FROM categories WHERE id=14")

c.commit()

print('\nCATEGORIES AFTER:')
for r in c.execute('SELECT id, name FROM categories ORDER BY id').fetchall():
    print(f'  {r[0]}: {r[1]}')
c.close()
print('\nDONE')
