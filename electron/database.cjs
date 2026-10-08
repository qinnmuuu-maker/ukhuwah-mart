const crypto = require("node:crypto");
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
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'cashier')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO categories (name) VALUES ('Umum');
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('storeName', 'Ukhuwah Mart'),
      ('storeAddress', ''),
      ('storePhone', ''),
      ('receiptFooter', 'Terima kasih telah berbelanja');
  `);

  const columns = new Set(db.prepare("PRAGMA table_info(sales)").all().map((column) => column.name));
  const migrations = [
    ["subtotal", "INTEGER NOT NULL DEFAULT 0"],
    ["discount", "INTEGER NOT NULL DEFAULT 0"],
    ["discount_type", "TEXT NOT NULL DEFAULT 'amount'"],
    ["discount_value", "INTEGER NOT NULL DEFAULT 0"],
    ["cashier_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["cashier_name", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of migrations) {
    if (!columns.has(name)) db.exec(`ALTER TABLE sales ADD COLUMN ${name} ${definition}`);
  }
  db.exec("UPDATE sales SET subtotal = total WHERE subtotal = 0 AND total > 0");

  const listProducts = db.prepare(`
    SELECT products.id, products.name, products.barcode, products.category_id,
           categories.name AS category, products.cost_price AS costPrice,
           products.selling_price AS sellingPrice, products.stock
    FROM products LEFT JOIN categories ON categories.id = products.category_id
    ORDER BY products.name COLLATE NOCASE
  `);
  const listCategories = db.prepare("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE");

  function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    if (typeof password !== "string" || password.length < 8 || password.length > 200) {
      throw new Error("Kata sandi harus terdiri dari 8 sampai 200 karakter.");
    }
    return {
      salt,
      hash: crypto.scryptSync(password, salt, 64).toString("hex"),
    };
  }

  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };
  }

  function setupAdmin({ username, displayName, password }) {
    if (db.prepare("SELECT COUNT(*) AS count FROM users").get().count) {
      throw new Error("Pengaturan awal sudah selesai.");
    }
    username = String(username || "").trim();
    displayName = String(displayName || "").trim();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
      throw new Error("Username harus 3–40 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.");
    }
    if (!displayName) throw new Error("Nama pengguna wajib diisi.");
    const credentials = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (username, display_name, role, password_salt, password_hash)
      VALUES (?, ?, 'admin', ?, ?)
    `).run(username, displayName, credentials.salt, credentials.hash);
    return publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid));
  }

  function authenticate({ username, password }) {
    const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username || "").trim());
    if (!user || typeof password !== "string") throw new Error("Username atau kata sandi salah.");
    const actual = crypto.scryptSync(password, user.password_salt, 64);
    const expected = Buffer.from(user.password_hash, "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new Error("Username atau kata sandi salah.");
    }
    return publicUser(user);
  }

  function saveUser({ id, username, displayName, role, password }) {
    username = String(username || "").trim();
    displayName = String(displayName || "").trim();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error("Username tidak valid.");
    if (!displayName) throw new Error("Nama pengguna wajib diisi.");
    if (!["admin", "cashier"].includes(role)) throw new Error("Peran pengguna tidak valid.");
    const transaction = db.transaction(() => {
      if (id) {
        const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(id));
        if (!existing) throw new Error("Pengguna tidak ditemukan.");
        const credentials = password ? hashPassword(password) : null;
        db.prepare(`
          UPDATE users SET username = ?, display_name = ?, role = ?,
            password_salt = COALESCE(?, password_salt), password_hash = COALESCE(?, password_hash)
          WHERE id = ?
        `).run(username, displayName, role, credentials?.salt || null, credentials?.hash || null, Number(id));
        if (existing.role === "admin" && role !== "admin" &&
          db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count < 1) {
          throw new Error("Setidaknya harus ada satu akun Admin.");
        }
      } else {
        const credentials = hashPassword(password);
        db.prepare(`
          INSERT INTO users (username, display_name, role, password_salt, password_hash)
          VALUES (?, ?, ?, ?, ?)
        `).run(username, displayName, role, credentials.salt, credentials.hash);
      }
    });
    transaction();
    return publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(
      id ? Number(id) : db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username).id,
    ));
  }

  function deleteUser(id) {
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(Number(id));
    if (!user) throw new Error("Pengguna tidak ditemukan.");
    if (user.role === "admin" && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count < 2) {
      throw new Error("Akun Admin terakhir tidak dapat dihapus.");
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(Number(id));
  }

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
    if (categoryId && !db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) {
      throw new Error("Kategori tidak ditemukan.");
    }
    if (product.id) {
      const result = db.prepare(`
        UPDATE products SET name = ?, barcode = ?, category_id = ?, cost_price = ?,
          selling_price = ?, stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
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

  function importProducts(rows) {
    if (!Array.isArray(rows)) throw new Error("Data produk tidak valid.");
    const seenBarcodes = new Set();
    const outcomes = [];
    const transaction = db.transaction(() => {
      rows.forEach((row, index) => {
        const rowNumber = row.rowNumber || index + 2;
        const name = String(row.name || "").trim();
        const barcode = String(row.barcode || "").trim() || null;
        const categoryName = String(row.category || "").trim() || "Umum";
        const costPrice = Number(row.costPrice ?? 0);
        const sellingPrice = Number(row.sellingPrice);
        const stock = Number(row.stock);

        if (!name) {
          outcomes.push({ row: rowNumber, status: "error", message: "Nama produk wajib diisi." });
          return;
        }
        if (name.length > 200 || categoryName.length > 80) {
          outcomes.push({ row: rowNumber, status: "error", message: "Nama produk maksimal 200 dan kategori maksimal 80 karakter." });
          return;
        }
        if (![costPrice, sellingPrice, stock].every(Number.isSafeInteger) ||
          costPrice < 0 || sellingPrice < 0 || stock < 0) {
          outcomes.push({ row: rowNumber, status: "error", message: "Harga dan stok wajib berupa bilangan bulat nol atau lebih." });
          return;
        }
        if (barcode && (seenBarcodes.has(barcode) || db.prepare("SELECT id FROM products WHERE barcode = ?").get(barcode))) {
          outcomes.push({ row: rowNumber, status: "duplicate", message: `Barcode ${barcode} sudah terdaftar.` });
          return;
        }

        const category = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(categoryName);
        const categoryId = category?.id ?? Number(
          db.prepare("INSERT INTO categories (name) VALUES (?)").run(categoryName).lastInsertRowid,
        );
        db.prepare(`
          INSERT INTO products (name, barcode, category_id, cost_price, selling_price, stock)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, barcode, categoryId, costPrice, sellingPrice, stock);
        if (barcode) seenBarcodes.add(barcode);
        outcomes.push({ row: rowNumber, status: "imported", message: name });
      });
    });
    transaction();
    return {
      imported: outcomes.filter((outcome) => outcome.status === "imported").length,
      duplicates: outcomes.filter((outcome) => outcome.status === "duplicate").length,
      duplicateRows: outcomes
        .filter((outcome) => outcome.status === "duplicate")
        .map(({ row, message }) => ({ row, message })),
      errors: outcomes.filter((outcome) => outcome.status === "error"),
    };
  }

  function deleteProduct(id) {
    const result = db.prepare("DELETE FROM products WHERE id = ?").run(Number(id));
    if (!result.changes) throw new Error("Produk tidak ditemukan.");
  }

  function saveCategory({ id, name }) {
    name = String(name || "").trim();
    if (!name || name.length > 80) throw new Error("Nama kategori harus 1–80 karakter.");
    if (id) {
      const result = db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, Number(id));
      if (!result.changes) throw new Error("Kategori tidak ditemukan.");
      return Number(id);
    }
    return Number(db.prepare("INSERT INTO categories (name) VALUES (?)").run(name).lastInsertRowid);
  }

  function deleteCategory(id) {
    if (db.prepare("SELECT name FROM categories WHERE id = ?").get(Number(id))?.name === "Umum") {
      throw new Error("Kategori Umum tidak dapat dihapus.");
    }
    const result = db.prepare("DELETE FROM categories WHERE id = ?").run(Number(id));
    if (!result.changes) throw new Error("Kategori tidak ditemukan.");
  }

  function getSettings() {
    return Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map(({ key, value }) => [key, value]));
  }

  function saveSettings(settings) {
    const allowed = ["storeName", "storeAddress", "storePhone", "receiptFooter"];
    const update = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const transaction = db.transaction(() => {
      for (const key of allowed) {
        if (settings[key] !== undefined) {
          const value = String(settings[key]).trim();
          if (value.length > 200) throw new Error("Setiap pengaturan toko maksimal 200 karakter.");
          update.run(key, value);
        }
      }
      if (!String(settings.storeName ?? getSettings().storeName).trim()) throw new Error("Nama toko wajib diisi.");
    });
    transaction();
    return getSettings();
  }

  function createSale({ items, paid, discountType = "amount", discountValue = 0, cashier = { id: null, displayName: "" } }) {
    if (!Array.isArray(items) || items.length === 0) throw new Error("Keranjang masih kosong.");
    const received = Number(paid);
    const value = Number(discountValue);
    if (!Number.isSafeInteger(received) || received < 0) throw new Error("Nominal pembayaran tidak valid.");
    if (!Number.isSafeInteger(value) || value < 0 || !["amount", "percent"].includes(discountType)) {
      throw new Error("Diskon tidak valid.");
    }
    const findProduct = db.prepare("SELECT id, name, selling_price, stock FROM products WHERE id = ?");
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
      const subtotal = rows.reduce((sum, { product, quantity }) => {
        const lineSubtotal = product.selling_price * quantity;
        if (!Number.isSafeInteger(lineSubtotal) || !Number.isSafeInteger(sum + lineSubtotal)) {
          throw new Error("Total transaksi melebihi batas.");
        }
        return sum + lineSubtotal;
      }, 0);
      if (discountType === "percent" && value > 100) throw new Error("Diskon persentase maksimal 100%.");
      const discount = discountType === "percent"
        ? Number((BigInt(subtotal) * BigInt(value) + 50n) / 100n)
        : value;
      if (discount > subtotal) throw new Error("Diskon tidak boleh melebihi subtotal.");
      const total = subtotal - discount;
      if (received < total) throw new Error("Uang yang diterima kurang dari total belanja.");
      const saleId = Number(db.prepare(`
        INSERT INTO sales (subtotal, discount, discount_type, discount_value, total, paid, change_due, cashier_user_id, cashier_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(subtotal, discount, discountType, value, total, received, received - total, cashier.id, cashier.displayName).lastInsertRowid);
      for (const { product, quantity } of rows) {
        const lineSubtotal = product.selling_price * quantity;
        db.prepare(`
          INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(saleId, product.id, product.name, quantity, product.selling_price, lineSubtotal);
        const result = db.prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?").run(quantity, product.id, quantity);
        if (!result.changes) throw new Error(`Stok ${product.name} tidak mencukupi.`);
      }
      return {
        id: saleId, subtotal, discount, discountType, discountValue: value,
        total, paid: received, change: received - total,
        cashierName: cashier.displayName,
        items: rows.map(({ product, quantity }) => ({
          name: product.name, quantity, unitPrice: product.selling_price,
          subtotal: product.selling_price * quantity,
        })),
      };
    });
    return transaction();
  }

  function listSales({ from = "", to = "", userId } = {}) {
    const sales = db.prepare(`
      SELECT id, subtotal, discount, discount_type AS discountType,
        discount_value AS discountValue, total, paid, change_due AS change,
        cashier_name AS cashierName, created_at AS createdAt
      FROM sales
      WHERE (? = '' OR date(created_at) >= date(?))
        AND (? = '' OR date(created_at) <= date(?))
        AND (? IS NULL OR cashier_user_id = ?)
      ORDER BY id DESC
    `).all(from, from, to, to, userId ?? null, userId ?? null);
    const items = db.prepare(`
      SELECT product_name AS name, quantity, unit_price AS unitPrice, subtotal
      FROM sale_items WHERE sale_id = ? ORDER BY id
    `);
    return sales.map((sale) => ({ ...sale, items: items.all(sale.id) }));
  }

  function getReport({ from = "", to = "", userId } = {}) {
    const sales = listSales({ from, to, userId });
    const productRows = db.prepare(`
      SELECT si.product_name AS name, SUM(si.quantity) AS quantity,
        SUM(si.subtotal) AS gross
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE (? = '' OR date(s.created_at) >= date(?))
        AND (? = '' OR date(s.created_at) <= date(?))
        AND (? IS NULL OR s.cashier_user_id = ?)
      GROUP BY si.product_name ORDER BY quantity DESC, gross DESC LIMIT 10
    `).all(from, from, to, to, userId ?? null, userId ?? null);
    return {
      transactionCount: sales.length,
      grossSales: sales.reduce((sum, sale) => sum + sale.subtotal, 0),
      discounts: sales.reduce((sum, sale) => sum + sale.discount, 0),
      netSales: sales.reduce((sum, sale) => sum + sale.total, 0),
      itemsSold: sales.reduce((sum, sale) => sum + sale.items.reduce((count, item) => count + item.quantity, 0), 0),
      topProducts: productRows,
    };
  }

  return {
    hasUsers: () => db.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0,
    setupAdmin,
    authenticate,
    listUsers: () => db.prepare("SELECT * FROM users ORDER BY display_name COLLATE NOCASE").all().map(publicUser),
    saveUser,
    deleteUser,
    listProducts: () => listProducts.all(),
    listCategories: () => listCategories.all(),
    saveCategory,
    deleteCategory,
    saveProduct,
    importProducts,
    deleteProduct,
    getSettings,
    saveSettings,
    createSale,
    listSales,
    getReport,
    backup: (filePath) => db.backup(filePath),
    close: () => db.close(),
  };
}

module.exports = { createDatabase };
