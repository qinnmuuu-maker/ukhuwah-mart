const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { createDatabase } = require("./database.cjs");

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
