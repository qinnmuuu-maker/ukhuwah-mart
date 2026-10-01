const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSaleItems, validateSaleRequest } = require("../sale-validation");

test("validates a payment and combines repeated product quantities", () => {
  const result = validateSaleRequest({
    requestId: "sale_request_1234567890",
    bayar: 500,
    items: [
      { productId: "product-a", qty: 1 },
      { productId: "product-a", qty: 2 }
    ]
  });

  assert.equal(result.quantities.get("product-a"), 3);
});

test("rejects fractional or negative payments and quantities", () => {
  for (const payload of [
    { bayar: 1.5, items: [{ productId: "product-a", qty: 1 }] },
    { bayar: -1, items: [{ productId: "product-a", qty: 1 }] },
    { bayar: 10, items: [{ productId: "product-a", qty: 0.5 }] }
  ]) {
    assert.throws(
      () => validateSaleRequest({ ...payload, requestId: "sale_request_1234567890" }),
      { code: "invalid-argument" }
    );
  }
});

test("uses the server product price to calculate the stored total", () => {
  const result = buildSaleItems([{
    productId: "product-a",
    qty: 2,
    data: { Kode: "A1", "Nama Barang": "Produk", Stok: 5, "Harga Jual": 125 }
  }]);

  assert.equal(result.total, 250);
  assert.equal(result.items[0].subtotal, 250);
  assert.equal(result.items[0].harga, 125);
});

test("rejects insufficient stock and invalid product prices", () => {
  assert.throws(
    () => buildSaleItems([{ productId: "product-a", qty: 3, data: { Stok: 2, "Harga Jual": 100 } }]),
    { code: "failed-precondition" }
  );
  assert.throws(
    () => buildSaleItems([{ productId: "product-a", qty: 1, data: { Stok: 2, "Harga Jual": -1 } }]),
    { code: "failed-precondition" }
  );
});

test("rejects totals outside JavaScript's safe integer range", () => {
  assert.throws(
    () => buildSaleItems([{
      productId: "product-a",
      qty: 2,
      data: { Stok: 2, "Harga Jual": Number.MAX_SAFE_INTEGER }
    }]),
    { code: "failed-precondition" }
  );
});