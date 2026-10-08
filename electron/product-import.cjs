const fs = require("node:fs");
const XLSX = require("@e965/xlsx");

function normalizeHeader(value) {
  return String(value ?? "").trim().toLocaleLowerCase("id")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseSpreadsheetInteger(value, field, allowBlank = false) {
  if ((value === null || value === undefined || value === "") && allowBlank) return 0;
  let parsed = value;
  if (typeof value !== "number") {
    const text = String(value).trim().replace(/^rp\s*/i, "").replace(/\s/g, "");
    if (/^-?\d+$/.test(text)) {
      parsed = Number(text);
    } else if (/^-?\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(text)) {
      const separator = text.match(/[.,]/)[0];
      parsed = Number(text.split(separator).join(""));
    } else {
      throw new Error(`${field} harus bilangan bulat.`);
    }
  }
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} harus bilangan bulat nol atau lebih.`);
  }
  return parsed;
}

function parseProductWorkbook(filePath) {
  if (fs.statSync(filePath).size > 20 * 1024 * 1024) {
    throw new Error("Ukuran file Excel maksimal 20 MB.");
  }
  let workbook;
  try {
    workbook = XLSX.readFile(filePath, { cellDates: false, raw: true, cellFormula: false });
  } catch (error) {
    throw new Error(`File Excel tidak dapat dibaca: ${error instanceof Error ? error.message : "format tidak valid."}`);
  }
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("File Excel tidak memiliki sheet.");
  const records = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: true });
  if (records.length < 2) throw new Error("Sheet harus berisi header dan setidaknya satu baris produk.");
  if (records.length > 10001) throw new Error("Impor dibatasi maksimal 10.000 baris produk per file.");

  const headers = records[0].map(normalizeHeader);
  const findColumn = (...aliases) => headers.findIndex((header) => aliases.includes(header));
  const columns = {
    name: findColumn("nama", "namaproduk", "name", "product", "productname"),
    barcode: findColumn("barcode", "kodebarcode", "kodeproduk", "sku"),
    category: findColumn("kategori", "category", "jeniskategori"),
    costPrice: findColumn("hargabeli", "hargapokok", "hargamodal", "costprice", "purchaseprice"),
    sellingPrice: findColumn("hargajual", "sellingprice", "saleprice", "price"),
    stock: findColumn("stok", "stock", "jumlahstok", "quantity", "qty"),
  };
  const missing = [];
  if (columns.name < 0) missing.push("Nama Produk");
  if (columns.sellingPrice < 0) missing.push("Harga Jual");
  if (columns.stock < 0) missing.push("Stok");
  if (missing.length) {
    throw new Error(`Header wajib tidak ditemukan: ${missing.join(", ")}. Lihat panduan format impor.`);
  }

  const rows = [];
  const errors = [];
  records.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const valueAt = (column) => column < 0 ? "" : cells[column];
    if (cells.every((cell) => String(cell ?? "").trim() === "")) return;
    try {
      rows.push({
        rowNumber,
        name: String(valueAt(columns.name) ?? "").trim(),
        barcode: String(valueAt(columns.barcode) ?? "").trim(),
        category: String(valueAt(columns.category) ?? "").trim(),
        costPrice: parseSpreadsheetInteger(valueAt(columns.costPrice), "Harga beli", true),
        sellingPrice: parseSpreadsheetInteger(valueAt(columns.sellingPrice), "Harga jual"),
        stock: parseSpreadsheetInteger(valueAt(columns.stock), "Stok"),
      });
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "Nilai angka tidak valid.",
      });
    }
  });
  return { rows, errors };
}

module.exports = { parseProductWorkbook };
