const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pos", {
  listProducts: () => ipcRenderer.invoke("products:list"),
  listCategories: () => ipcRenderer.invoke("categories:list"),
  saveProduct: (product) => ipcRenderer.invoke("products:save", product),
  deleteProduct: (id) => ipcRenderer.invoke("products:delete", id),
  createSale: (sale) => ipcRenderer.invoke("sales:create", sale),
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  printReceipt: (receipt) => ipcRenderer.invoke("receipt:print", receipt),
});
