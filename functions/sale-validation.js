const MAX_ITEMS = 100;

function validationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateSaleRequest(payload = {}) {
  const requestId = payload.requestId;
  const payment = payload.bayar;

  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{20,40}$/.test(requestId)) {
    throw validationError("invalid-argument", "ID transaksi tidak valid.");
  }
  if (!Number.isSafeInteger(payment) || payment < 0) {
    throw validationError("invalid-argument", "Pembayaran harus berupa angka bulat nonnegatif.");
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > MAX_ITEMS) {
    throw validationError("invalid-argument", `Transaksi harus berisi 1-${MAX_ITEMS} barang.`);
  }

  const quantities = new Map();
  for (const item of payload.items) {
    const productId = item?.productId;
    const quantity = item?.qty;
    if (typeof productId !== "string" || productId.length === 0 || productId.includes("/")) {
      throw validationError("invalid-argument", "ID barang tidak valid.");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw validationError("invalid-argument", "Jumlah barang harus berupa angka bulat positif.");
    }

    const combinedQuantity = (quantities.get(productId) || 0) + quantity;
    if (!Number.isSafeInteger(combinedQuantity)) {
      throw validationError("invalid-argument", "Jumlah barang terlalu besar.");
    }
    quantities.set(productId, combinedQuantity);
  }
  if (quantities.size > MAX_ITEMS) {
    throw validationError("invalid-argument", `Transaksi maksimal ${MAX_ITEMS} jenis barang.`);
  }

  return { requestId, payment, quantities };
}

function buildSaleItems(products) {
  const items = [];
  let total = 0;

  for (const product of products) {
    const data = product.data;
    if (!data) {
      throw validationError("not-found", "Salah satu barang tidak ditemukan.");
    }

    const stock = data.Stok;
    const price = data["Harga Jual"];
    if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(price) || price < 0) {
      throw validationError("failed-precondition", `Data stok atau harga barang ${data["Nama Barang"] || ""} tidak valid.`);
    }
    if (stock < product.qty) {
      throw validationError("failed-precondition", `Stok ${data["Nama Barang"] || "barang"} tidak mencukupi.`);
    }

    const subtotal = price * product.qty;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total + subtotal)) {
      throw validationError("failed-precondition", "Total transaksi terlalu besar.");
    }
    total += subtotal;
    items.push({
      id: product.productId,
      kode: data.Kode || "",
      nama: data["Nama Barang"] || "-",
      harga: price,
      qty: product.qty,
      subtotal
    });
  }

  return { items, total };
}

module.exports = { buildSaleItems, validateSaleRequest };