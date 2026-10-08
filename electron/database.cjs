const Database = require("better-sqlite3");

function createDatabase(databasePath) {
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barcode TEXT UNIQUE,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      cost_price INTEGER NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
      selling_price INTEGER NOT NULL CHECK(selling_price >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total INTEGER NOT NULL,
      paid INTEGER NOT NULL,
      change_due INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO categories (name) VALUES ('Umum');
  `);

  const listProducts = db.prepare(`
    SELECT products.id, products.name, products.barcode, products.category_id,
           categories.name AS category, products.cost_price AS costPrice,
           products.selling_price AS sellingPrice, products.stock
    FROM products
    LEFT JOIN categories ON categories.id = products.category_id
    ORDER BY products.name COLLATE NOCASE
  `);

  const listCategories = db.prepare("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE");

  function saveProduct(product) {
    const name = String(product.name || "").trim();
    if (!name) throw new Error("Nama produk wajib diisi.");
    const barcode = String(product.barcode || "").trim() || null;
    const categoryId = product.categoryId ? Number(product.categoryId) : null;
    const costPrice = Number(product.costPrice);
    const sellingPrice = Number(product.sellingPrice);
    const stock = Number(product.stock);
    if (![costPrice, sellingPrice, stock].every(Number.isSafeInteger) ||
        costPrice < 0 || sellingPrice < 0 || stock < 0) {
      throw new Error("Harga dan stok harus berupa bilangan bulat yang tidak negatif.");
    }

    if (product.id) {
      const result = db.prepare(`
        UPDATE products
        SET name = ?, barcode = ?, category_id = ?, cost_price = ?,
            selling_price = ?, stock = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, barcode, categoryId, costPrice, sellingPrice, stock, Number(product.id));
      if (!result.changes) throw new Error("Produk tidak ditemukan.");
      return Number(product.id);
    }

    const result = db.prepare(`
      INSERT INTO products (name, barcode, category_id, cost_price, selling_price, stock)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, barcode, categoryId, costPrice, sellingPrice, stock);
    return Number(result.lastInsertRowid);
  }

  function deleteProduct(id) {
    const result = db.prepare("DELETE FROM products WHERE id = ?").run(Number(id));
    if (!result.changes) throw new Error("Produk tidak ditemukan.");
  }

  function createSale({ items, paid }) {
    if (!Array.isArray(items) || items.length === 0) throw new Error("Keranjang masih kosong.");
    const received = Number(paid);
    if (!Number.isSafeInteger(received) || received < 0) {
      throw new Error("Nominal pembayaran tidak valid.");
    }

    const findProduct = db.prepare("SELECT id, name, selling_price, stock FROM products WHERE id = ?");
    const insertSale = db.prepare(
      "INSERT INTO sales (total, paid, change_due) VALUES (?, ?, ?)",
    );
    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare(`
      UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND stock >= ?
    `);
    const transaction = db.transaction(() => {
      const aggregated = new Map();
      for (const item of items) {
        const id = Number(item.productId);
        const quantity = Number(item.quantity);
        if (!Number.isSafeInteger(id) || !Number.isSafeInteger(quantity) || quantity < 1) {
          throw new Error("Produk atau jumlah barang tidak valid.");
        }
        aggregated.set(id, (aggregated.get(id) || 0) + quantity);
      }

      const rows = [...aggregated].map(([id, quantity]) => {
        const product = findProduct.get(id);
        if (!product) throw new Error("Produk tidak ditemukan.");
        if (product.stock < quantity) throw new Error(`Stok ${product.name} tidak mencukupi.`);
        return { product, quantity };
      });
      const total = rows.reduce(
        (sum, { product, quantity }) => sum + product.selling_price * quantity,
        0,
      );
      if (!Number.isSafeInteger(total)) throw new Error("Total transaksi melebihi batas.");
      if (received < total) throw new Error("Uang yang diterima kurang dari total belanja.");

      const saleId = Number(insertSale.run(total, received, received - total).lastInsertRowid);
      for (const { product, quantity } of rows) {
        const subtotal = product.selling_price * quantity;
        insertItem.run(saleId, product.id, product.name, quantity, product.selling_price, subtotal);
        const result = updateStock.run(quantity, product.id, quantity);
        if (!result.changes) throw new Error(`Stok ${product.name} tidak mencukupi.`);
      }
      return {
        id: saleId,
        total,
        paid: received,
        change: received - total,
        items: rows.map(({ product, quantity }) => ({
          name: product.name,
          quantity,
          unitPrice: product.selling_price,
          subtotal: product.selling_price * quantity,
        })),
      };
    });
    return transaction();
  }

  return {
    listProducts: () => listProducts.all(),
    listCategories: () => listCategories.all(),
    saveProduct,
    deleteProduct,
    createSale,
    close: () => db.close(),
  };
}

module.exports = { createDatabase };
