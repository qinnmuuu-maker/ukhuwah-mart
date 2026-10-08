const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const Database = require("better-sqlite3");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { createDatabase } = require("./database.cjs");
const XLSX = require("@e965/xlsx");
const { parseProductWorkbook } = require("./product-import.cjs");

let directory;
let db;

function setup() {
  directory = mkdtempSync(path.join(os.tmpdir(), "ukhuwah-mart-"));
  db = createDatabase(path.join(directory, "test.db"));
  return db;
}

afterEach(() => {
  if (db) db.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  db = undefined;
  directory = undefined;
});

test("creates products and rejects duplicate barcodes", () => {
  const database = setup();
  const category = database.listCategories()[0];
  const id = database.saveProduct({
    name: "Kopi",
    barcode: "123",
    categoryId: category.id,
    costPrice: 3000,
    sellingPrice: 5000,
    stock: 8,
  });
  assert.equal(database.listProducts()[0].id, id);
  assert.throws(
    () => database.saveProduct({
      name: "Teh",
      barcode: "123",
      costPrice: 1000,
      sellingPrice: 2000,
      stock: 4,
    }),
    /UNIQUE/,
  );
});

test("records a sale and deducts stock atomically", () => {
  const database = setup();
  const id = database.saveProduct({
    name: "Kopi",
    costPrice: 3000,
    sellingPrice: 5000,
    stock: 3,
  });
  const sale = database.createSale({
    items: [{ productId: id, quantity: 2 }],
    paid: 12000,
  });
  assert.equal(sale.total, 10000);
  assert.equal(sale.change, 2000);
  assert.equal(database.listProducts()[0].stock, 1);
  assert.throws(
    () => database.createSale({ items: [{ productId: id, quantity: 2 }], paid: 20000 }),
    /tidak mencukupi/,
  );
  assert.equal(database.listProducts()[0].stock, 1);
});

test("rejects insufficient payment without changing stock", () => {
  const database = setup();
  const id = database.saveProduct({
    name: "Kopi",
    costPrice: 3000,
    sellingPrice: 5000,
    stock: 3,
  });
  assert.throws(
    () => database.createSale({ items: [{ productId: id, quantity: 1 }], paid: 4000 }),
    /kurang/,
  );
  assert.equal(database.listProducts()[0].stock, 3);
});

test("sets up local accounts and verifies password credentials", () => {
  const database = setup();
  assert.equal(database.hasUsers(), false);
  const admin = database.setupAdmin({
    username: "owner",
    displayName: "Pemilik",
    password: "password-rahasia",
  });
  assert.equal(admin.role, "admin");
  assert.equal(database.authenticate({ username: "OWNER", password: "password-rahasia" }).id, admin.id);
  assert.throws(
    () => database.authenticate({ username: "owner", password: "wrong-password" }),
    /Username atau kata sandi salah/,
  );
  assert.throws(
    () => database.setupAdmin({ username: "second", displayName: "Lain", password: "password-rahasia" }),
    /sudah selesai/,
  );
  database.saveUser({
    username: "cashier",
    displayName: "Kasir",
    role: "cashier",
    password: "kata-sandi-kasir",
  });
  assert.equal(database.listUsers().length, 2);
  const secondAdmin = database.saveUser({
    username: "admin2",
    displayName: "Admin Dua",
    role: "admin",
    password: "kata-sandi-admin",
  });
  assert.equal(database.saveUser({ ...secondAdmin, role: "cashier" }).role, "cashier");
  assert.throws(() => database.deleteUser(admin.id), /Admin terakhir/);
});

test("applies discounts, reports sales, and preserves receipt detail", () => {
  const database = setup();
  const admin = database.setupAdmin({
    username: "owner",
    displayName: "Pemilik",
    password: "password-rahasia",
  });
  const categoryId = database.saveCategory({ name: "Minuman" });
  const productId = database.saveProduct({
    name: "Kopi",
    categoryId,
    costPrice: 3000,
    sellingPrice: 10000,
    stock: 5,
  });
  const sale = database.createSale({
    items: [{ productId, quantity: 2 }],
    paid: 18000,
    discountType: "percent",
    discountValue: 10,
    cashier: admin,
  });
  assert.equal(sale.subtotal, 20000);
  assert.equal(sale.discount, 2000);
  assert.equal(sale.total, 18000);
  assert.equal(sale.cashierName, "Pemilik");
  assert.equal(database.listSales()[0].items[0].name, "Kopi");
  const report = database.getReport();
  assert.equal(report.transactionCount, 1);
  assert.equal(report.grossSales, 20000);
  assert.equal(report.discounts, 2000);
  assert.equal(report.netSales, 18000);
  assert.equal(report.itemsSold, 2);
  assert.equal(report.topProducts[0].name, "Kopi");
  assert.throws(
    () => database.createSale({
      items: [{ productId, quantity: 1 }],
      paid: 0,
      discountType: "percent",
      discountValue: 101,
      cashier: admin,
    }),
    /maksimal 100%/,
  );
});

test("updates shop profile and protects the default category", () => {
  const database = setup();
  assert.equal(database.getSettings().storeName, "Ukhuwah Mart");
  const saved = database.saveSettings({
    storeName: "Toko Baru",
    storeAddress: "Jalan Contoh",
    storePhone: "08123456789",
    receiptFooter: "Sampai jumpa",
  });
  assert.equal(saved.storeName, "Toko Baru");
  assert.throws(() => database.saveSettings({ storeName: " " }), /Nama toko wajib/);
  const defaultCategory = database.listCategories().find((category) => category.name === "Umum");
  assert.throws(() => database.deleteCategory(defaultCategory.id), /tidak dapat dihapus/);
});

test("migrates the original sales schema and preserves existing transactions", () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ukhuwah-mart-"));
  const databasePath = path.join(directory, "legacy.db");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT UNIQUE,
      category_id INTEGER, cost_price INTEGER NOT NULL DEFAULT 0, selling_price INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sales (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, paid INTEGER NOT NULL,
      change_due INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL, product_id INTEGER,
      product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL, subtotal INTEGER NOT NULL);
    INSERT INTO sales (id, total, paid, change_due) VALUES (1, 5000, 5000, 0);
    INSERT INTO sale_items (sale_id, product_name, quantity, unit_price, subtotal)
      VALUES (1, 'Kopi lama', 1, 5000, 5000);
  `);
  legacy.close();
  db = createDatabase(databasePath);
  const oldSale = db.listSales()[0];
  assert.equal(oldSale.subtotal, 5000);
  assert.equal(oldSale.discount, 0);
  assert.equal(oldSale.items[0].name, "Kopi lama");
});

test("creates a standalone SQLite backup with current data", async () => {
  const database = setup();
  database.saveProduct({
    name: "Teh",
    costPrice: 1000,
    sellingPrice: 2000,
    stock: 4,
  });
  const backupPath = path.join(directory, "backup.db");
  await database.backup(backupPath);
  const backup = createDatabase(backupPath);
  assert.equal(backup.listProducts()[0].name, "Teh");
  backup.close();
});

test("imports valid products while skipping existing and duplicate barcodes", () => {
  const database = setup();
  database.saveProduct({
    name: "Existing",
    barcode: "100",
    costPrice: 500,
    sellingPrice: 1000,
    stock: 2,
  });
  const result = database.importProducts([
    {
      rowNumber: 4,
      name: "New Tea",
      barcode: "200",
      category: "Drinks",
      costPrice: 1200,
      sellingPrice: 2500,
      stock: 8,
    },
    {
      rowNumber: 5,
      name: "Duplicate Existing",
      barcode: "100",
      costPrice: 0,
      sellingPrice: 1000,
      stock: 1,
    },
    {
      rowNumber: 6,
      name: "Duplicate in file",
      barcode: "200",
      costPrice: 0,
      sellingPrice: 1000,
      stock: 1,
    },
    {
      rowNumber: 7,
      name: "",
      barcode: "300",
      costPrice: 0,
      sellingPrice: 1000,
      stock: 1,
    },
  ]);
  assert.equal(result.imported, 1);
  assert.equal(result.duplicates, 2);
  assert.deepEqual(result.duplicateRows.map((entry) => entry.row), [5, 6]);
  assert.deepEqual(result.errors.map((entry) => entry.row), [7]);
  assert.equal(database.listProducts().length, 2);
  assert.equal(database.listProducts().find((product) => product.barcode === "200").category, "Drinks");
});

test("parses XLS and XLSX product sheets with Indonesian headers", () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ukhuwah-mart-"));
  for (const extension of ["xls", "xlsx"]) {
    const filePath = path.join(directory, `products.${extension}`);
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Nama Produk", "Barcode", "Kategori", "Harga Beli", "Harga Jual", "Stok"],
      ["Kopi", "001234", "Minuman", 10000, 15000, 8],
      ["Tidak valid", "bad", "Minuman", 1000, "bukan angka", 2],
      ["", "", "", 0, 200, 1],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Produk");
    XLSX.writeFile(workbook, filePath, { bookType: extension });
    const parsed = parseProductWorkbook(filePath);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].barcode, "001234");
    assert.equal(parsed.rows[0].sellingPrice, 15000);
    assert.equal(parsed.rows[0].rowNumber, 2);
    assert.deepEqual(parsed.errors, [{ row: 3, message: "Harga jual harus bilangan bulat." }]);
  }
});
