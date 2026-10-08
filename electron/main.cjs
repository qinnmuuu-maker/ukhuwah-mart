const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { createDatabase } = require("./database.cjs");

let db;
let mainWindow;

function registerHandlers() {
  ipcMain.handle("products:list", () => db.listProducts());
  ipcMain.handle("categories:list", () => db.listCategories());
  ipcMain.handle("products:save", (_event, product) => db.saveProduct(product));
  ipcMain.handle("products:delete", (_event, id) => db.deleteProduct(id));
  ipcMain.handle("sales:create", (_event, sale) => db.createSale(sale));
  ipcMain.handle("printers:list", async () => {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(({ name, displayName, isDefault }) => ({ name, displayName, isDefault }));
  });
  ipcMain.handle("receipt:print", async (_event, { receipt, printerName, paperWidth }) => {
    const receiptWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true },
    });
    try {
      const width = paperWidth === "58" ? "58mm" : "80mm";
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
        <header><strong>UKHUWAH MART</strong><br>Terima kasih telah berbelanja</header>
        <div class="line"></div><div>No. ${receipt.id}<br>${escapeHtml(receipt.createdAt)}</div>
        <div class="line"></div><section class="items">${rows}</section>
        <div class="line"></div>
        <div class="total">Total <span style="float:right">${formatRupiah(receipt.total)}</span></div>
        <div>Dibayar <span style="float:right">${formatRupiah(receipt.paid)}</span></div>
        <div>Kembali <span style="float:right">${formatRupiah(receipt.change)}</span></div>
        <div class="line"></div><footer>Barang yang sudah dibeli<br>tidak dapat dikembalikan.</footer>
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
  db = createDatabase(path.join(app.getPath("userData"), "ukhuwah-mart.db"));
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
