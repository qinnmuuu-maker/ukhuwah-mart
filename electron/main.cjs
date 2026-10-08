const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createDatabase } = require("./database.cjs");
const { parseProductWorkbook } = require("./product-import.cjs");

let db;
let mainWindow;
let dbPath;
let currentUser = null;

function requireLogin() {
  if (!currentUser) throw new Error("Silakan login terlebih dahulu.");
  return currentUser;
}

function requireAdmin() {
  if (requireLogin().role !== "admin") throw new Error("Fitur ini hanya tersedia untuk Admin.");
  return currentUser;
}

function registerHandlers() {
  ipcMain.handle("auth:setup-status", () => !db.hasUsers());
  ipcMain.handle("auth:setup-admin", (_event, details) => {
    if (db.hasUsers()) throw new Error("Pengaturan awal sudah selesai.");
    currentUser = db.setupAdmin(details);
    return currentUser;
  });
  ipcMain.handle("auth:login", (_event, credentials) => {
    currentUser = db.authenticate(credentials);
    return currentUser;
  });
  ipcMain.handle("auth:logout", () => { currentUser = null; });
  ipcMain.handle("auth:current-user", () => currentUser);
  ipcMain.handle("products:list", () => {
    const user = requireLogin();
    return db.listProducts().map((product) => user.role === "admin" ? product : { ...product, costPrice: 0 });
  });
  ipcMain.handle("categories:list", () => { requireLogin(); return db.listCategories(); });
  ipcMain.handle("products:save", (_event, product) => { requireAdmin(); return db.saveProduct(product); });
  ipcMain.handle("products:delete", (_event, id) => { requireAdmin(); return db.deleteProduct(id); });
  ipcMain.handle("products:import-excel", async () => {
    requireAdmin();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Pilih file Excel produk",
      properties: ["openFile"],
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, imported: 0, duplicates: 0, errors: [] };
    }

    const parsed = parseProductWorkbook(result.filePaths[0]);
    const resultSummary = db.importProducts(parsed.rows);
    resultSummary.errors.push(...parsed.errors);
    return { canceled: false, ...resultSummary };
  });
  ipcMain.handle("categories:save", (_event, category) => { requireAdmin(); return db.saveCategory(category); });
  ipcMain.handle("categories:delete", (_event, id) => { requireAdmin(); return db.deleteCategory(id); });
  ipcMain.handle("users:list", () => { requireAdmin(); return db.listUsers(); });
  ipcMain.handle("users:save", (_event, user) => {
    const admin = requireAdmin();
    if (admin.id === Number(user.id) && user.role !== "admin") {
      throw new Error("Peran akun Admin yang sedang digunakan tidak dapat diturunkan.");
    }
    const saved = db.saveUser(user);
    if (admin.id === saved.id) currentUser = saved;
    return saved;
  });
  ipcMain.handle("users:delete", (_event, id) => {
    const admin = requireAdmin();
    if (admin.id === Number(id)) throw new Error("Akun yang sedang digunakan tidak dapat dihapus.");
    return db.deleteUser(id);
  });
  ipcMain.handle("sales:create", (_event, sale) => {
    const cashier = requireLogin();
    return db.createSale({ ...sale, cashier });
  });
  ipcMain.handle("sales:list", (_event, filters = {}) => {
    const user = requireLogin();
    return db.listSales({ ...(filters || {}), userId: user.role === "admin" ? undefined : user.id });
  });
  ipcMain.handle("reports:get", (_event, filters = {}) => { requireAdmin(); return db.getReport(filters || {}); });
  ipcMain.handle("settings:get", () => { requireLogin(); return db.getSettings(); });
  ipcMain.handle("settings:save", (_event, settings) => { requireAdmin(); return db.saveSettings(settings); });
  ipcMain.handle("export:csv", async (_event, filters = {}) => {
    const user = requireLogin();
    filters = filters || {};
    const sales = db.listSales({ ...filters, userId: user.role === "admin" ? undefined : user.id });
    const quote = (value) => {
      let text = String(value ?? "");
      if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [[
      "ID Transaksi", "Tanggal", "Kasir", "Nama Produk", "Jumlah",
      "Harga Satuan", "Subtotal Produk", "Subtotal Transaksi", "Diskon",
      "Total", "Dibayar", "Kembalian",
    ]];
    for (const sale of sales) {
      for (const item of sale.items) {
        rows.push([
          sale.id, sale.createdAt, sale.cashierName, item.name, item.quantity,
          item.unitPrice, item.subtotal, sale.subtotal, sale.discount,
          sale.total, sale.paid, sale.change,
        ]);
      }
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Ekspor transaksi ke CSV",
      defaultPath: `transaksi-${filters.from || "semua"}-${filters.to || "sekarang"}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, `\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}`, "utf8");
    return true;
  });
  ipcMain.handle("backup:export", async () => {
    requireAdmin();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Simpan backup database",
      defaultPath: "ukhuwah-mart-backup.db",
      filters: [{ name: "Database SQLite", extensions: ["db"] }],
    });
    if (result.canceled || !result.filePath) return false;
    if (path.resolve(result.filePath) === path.resolve(dbPath)) {
      throw new Error("File ekspor tidak boleh menimpa database aktif.");
    }
    await db.backup(result.filePath);
    return true;
  });
  ipcMain.handle("backup:restore", async () => {
    requireAdmin();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Pilih file backup",
      properties: ["openFile"],
      filters: [{ name: "Database SQLite", extensions: ["db"] }],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    const source = result.filePaths[0];
    if (path.resolve(source) === path.resolve(dbPath)) throw new Error("Pilih file backup yang berbeda dari database aktif.");
    const incoming = new Database(source, { readonly: true, fileMustExist: true });
    try {
      if (incoming.pragma("quick_check", { simple: true }) !== "ok") throw new Error("File backup rusak.");
      const tables = new Set(incoming.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      const requiredColumns = {
        categories: ["id", "name"],
        products: ["id", "name", "selling_price", "stock"],
        sales: ["id", "subtotal", "discount", "total", "paid", "change_due"],
        sale_items: ["sale_id", "product_name", "quantity", "unit_price", "subtotal"],
        users: ["id", "username", "role", "password_salt", "password_hash"],
        settings: ["key", "value"],
      };
      for (const [table, columns] of Object.entries(requiredColumns)) {
        if (!tables.has(table)) throw new Error("File bukan backup Ukhuwah Mart yang valid.");
        const available = new Set(incoming.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
        if (columns.some((column) => !available.has(column))) {
          throw new Error("File backup tidak kompatibel dengan versi aplikasi ini.");
        }
      }
      if (!incoming.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) {
        throw new Error("Backup harus memiliki setidaknya satu akun Admin.");
      }
    } finally {
      incoming.close();
    }

    const safetyPath = `${dbPath}.restore-safety`;
    await db.backup(safetyPath);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    db = null;
    try {
      for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      }
      fs.copyFileSync(source, dbPath);
      for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      }
      db = createDatabase(dbPath);
    } catch (error) {
      if (db) {
        try { db.close(); } catch { /* The connection may already be closed. */ }
      }
      for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      }
      fs.copyFileSync(safetyPath, dbPath);
      db = createDatabase(dbPath);
      throw error;
    } finally {
      if (fs.existsSync(safetyPath)) fs.rmSync(safetyPath);
    }
    currentUser = null;
    return true;
  });
  ipcMain.handle("printers:list", async () => {
    requireLogin();
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(({ name, displayName, isDefault }) => ({ name, displayName, isDefault }));
  });
  ipcMain.handle("receipt:print", async (_event, { receipt, printerName, paperWidth }) => {
    requireLogin();
    const settings = db.getSettings();
    const receiptWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true },
    });
    try {
      const width = paperWidth === "80" ? "80mm" : "58mm";
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]);
      const rows = receipt.items.map((item) =>
        `<div>${escapeHtml(item.name)} × ${item.quantity}<br><span>${formatRupiah(item.subtotal)}</span></div>`,
      ).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: ${width} auto; margin: 3mm; }
        body { width: calc(${width} - 6mm); margin: 0; font: 12px monospace; }
        header, footer { text-align: center; }
        .line { border-top: 1px dashed; margin: 8px 0; }
        .total { font-weight: bold; }
        .items div { margin: 5px 0; }
        .items span { float: right; }
      </style></head><body>
        <header><strong>${escapeHtml(settings.storeName)}</strong><br>
          ${settings.storeAddress ? `${escapeHtml(settings.storeAddress)}<br>` : ""}
          ${settings.storePhone ? `${escapeHtml(settings.storePhone)}<br>` : ""}
        </header>
        <div class="line"></div><div>No. ${receipt.id}<br>${escapeHtml(receipt.createdAt)}</div>
        <div class="line"></div><section class="items">${rows}</section>
        <div class="line"></div>
        <div>Subtotal <span style="float:right">${formatRupiah(receipt.subtotal)}</span></div>
        <div>Diskon <span style="float:right">-${formatRupiah(receipt.discount)}</span></div>
        <div class="total">Total <span style="float:right">${formatRupiah(receipt.total)}</span></div>
        <div>Dibayar <span style="float:right">${formatRupiah(receipt.paid)}</span></div>
        <div>Kembali <span style="float:right">${formatRupiah(receipt.change)}</span></div>
        <div class="line"></div><footer>${escapeHtml(settings.receiptFooter)}</footer>
      </body></html>`;
      await receiptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await new Promise((resolve, reject) => {
        receiptWindow.webContents.print(
          {
            silent: Boolean(printerName),
            deviceName: printerName || undefined,
            printBackground: true,
          },
          (success, failureReason) => {
            if (success) resolve(true);
            else reject(new Error(failureReason || "Pencetakan struk gagal."));
          },
        );
      });
    } finally {
      receiptWindow.close();
    }
  });
}

function formatRupiah(amount) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: "#f7f8f5",
    title: "Ukhuwah Mart POS",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  dbPath = path.join(app.getPath("userData"), "ukhuwah-mart.db");
  db = createDatabase(dbPath);
  registerHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (db) db.close();
});
