import type {
  Category, PosBridge, PosUser, Product, ProductInput, SaleRecord, StoreSettings,
} from "./types";

export function createPreviewBridge(): PosBridge {
  let user: PosUser | null = {
    id: 1,
    username: "admin",
    displayName: "Admin Demo",
    role: "admin",
  };
  let categories: Category[] = [
    { id: 1, name: "Umum" },
    { id: 2, name: "Minuman" },
    { id: 3, name: "Makanan ringan" },
  ];
  let products: Product[] = [
    { id: 1, name: "Kopi Arabika 200g", barcode: "899100100001", category_id: 2, category: "Minuman", costPrice: 35000, sellingPrice: 48000, stock: 18 },
    { id: 2, name: "Teh Melati 50 pcs", barcode: "899100100002", category_id: 2, category: "Minuman", costPrice: 12000, sellingPrice: 18000, stock: 24 },
    { id: 3, name: "Keripik Singkong", barcode: "899100100003", category_id: 3, category: "Makanan ringan", costPrice: 8000, sellingPrice: 12000, stock: 4 },
    { id: 4, name: "Madu Hutan 250ml", barcode: "899100100004", category_id: 1, category: "Umum", costPrice: 42000, sellingPrice: 59000, stock: 9 },
    { id: 5, name: "Air Mineral 600ml", barcode: "899100100005", category_id: 2, category: "Minuman", costPrice: 2500, sellingPrice: 4000, stock: 36 },
    { id: 6, name: "Kurma Sukari 500g", barcode: "899100100006", category_id: 3, category: "Makanan ringan", costPrice: 28000, sellingPrice: 38000, stock: 12 },
  ];
  let sales: SaleRecord[] = [];
  let settings: StoreSettings = {
    storeName: "Ukhuwah Mart",
    storeAddress: "Jl. Persaudaraan No. 12",
    storePhone: "0812-3456-7890",
    receiptFooter: "Terima kasih telah berbelanja",
  };
  let users: PosUser[] = [user];
  let nextProductId = 7;
  let nextCategoryId = 4;
  let nextUserId = 2;
  let nextSaleId = 1;

  const filteredSales = (filters: { from?: string; to?: string }, userId?: number) =>
    sales.filter((sale) => {
      const date = sale.createdAt.slice(0, 10);
      return (!filters.from || date >= filters.from) &&
        (!filters.to || date <= filters.to) &&
        (userId === undefined || sale.cashierName === users.find((entry) => entry.id === userId)?.displayName);
    });

  return {
    setupStatus: async () => false,
    setupAdmin: async ({ username, displayName }) => {
      user = { id: 1, username, displayName, role: "admin" };
      users = [user];
      return user;
    },
    login: async ({ username }) => {
      user = users.find((entry) => entry.username === username) || users[0] || {
        id: 1, username, displayName: username || "Admin Demo", role: "admin",
      };
      return user;
    },
    logout: async () => { user = null; },
    currentUser: async () => user,
    listProducts: async () => products.map((product) => ({ ...product })),
    listCategories: async () => categories.map((category) => ({ ...category })),
    saveCategory: async ({ id, name }) => {
      const normalized = name.trim();
      if (!normalized) throw new Error("Nama kategori wajib diisi.");
      if (id) categories = categories.map((category) => category.id === id ? { ...category, name: normalized } : category);
      else categories.push({ id: nextCategoryId++, name: normalized });
      products = products.map((product) => {
        const category = categories.find((entry) => entry.id === product.category_id);
        return category ? { ...product, category: category.name } : product;
      });
      return id || nextCategoryId - 1;
    },
    deleteCategory: async (id) => {
      if (categories.find((category) => category.id === id)?.name === "Umum") throw new Error("Kategori Umum tidak dapat dihapus.");
      categories = categories.filter((category) => category.id !== id);
      products = products.map((product) => product.category_id === id ? { ...product, category_id: null, category: null } : product);
    },
    saveProduct: async (input: ProductInput) => {
      const category = categories.find((entry) => entry.id === input.categoryId);
      const product = { ...input, id: input.id || nextProductId++, category_id: input.categoryId, category: category?.name || null, barcode: input.barcode || null };
      products = input.id ? products.map((entry) => entry.id === input.id ? product : entry) : [...products, product];
      return product.id;
    },
    importProductsExcel: async () => {
      throw new Error("Impor file Excel tersedia saat aplikasi dijalankan sebagai aplikasi desktop.");
    },
    deleteProduct: async (id) => { products = products.filter((product) => product.id !== id); },
    createSale: async ({ items, paid, discountType, discountValue }) => {
      const receiptItems = items.map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (!product || product.stock < item.quantity) throw new Error("Stok produk tidak mencukupi.");
        return { name: product.name, quantity: item.quantity, unitPrice: product.sellingPrice, subtotal: product.sellingPrice * item.quantity };
      });
      const subtotal = receiptItems.reduce((sum, item) => sum + item.subtotal, 0);
      const discount = discountType === "percent" ? Math.round(subtotal * discountValue / 100) : discountValue;
      const total = subtotal - discount;
      if (paid < total) throw new Error("Uang yang diterima kurang dari total belanja.");
      products = products.map((product) => {
        const sold = items.find((item) => item.productId === product.id);
        return sold ? { ...product, stock: product.stock - sold.quantity } : product;
      });
      const result = {
        id: nextSaleId++,
        subtotal,
        discount,
        discountType,
        discountValue,
        total,
        paid,
        change: paid - total,
        cashierName: user?.displayName || "Admin Demo",
        createdAt: new Date().toLocaleString("id-ID"),
        items: receiptItems,
      };
      sales = [{ ...result }, ...sales];
      return result;
    },
    listSales: async (filters) => filteredSales(filters, user?.role === "cashier" ? user.id : undefined),
    getReport: async (filters) => {
      const selected = filteredSales(filters);
      const productsSold = new Map<string, { name: string; quantity: number; gross: number }>();
      for (const sale of selected) {
        for (const item of sale.items) {
          const current = productsSold.get(item.name) || { name: item.name, quantity: 0, gross: 0 };
          current.quantity += item.quantity;
          current.gross += item.subtotal;
          productsSold.set(item.name, current);
        }
      }
      return {
        transactionCount: selected.length,
        grossSales: selected.reduce((sum, sale) => sum + sale.subtotal, 0),
        discounts: selected.reduce((sum, sale) => sum + sale.discount, 0),
        netSales: selected.reduce((sum, sale) => sum + sale.total, 0),
        itemsSold: selected.reduce((sum, sale) => sum + sale.items.reduce((count, item) => count + item.quantity, 0), 0),
        topProducts: [...productsSold.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
      };
    },
    listUsers: async () => users.map((entry) => ({ ...entry })),
    saveUser: async (input) => {
      const saved: PosUser = { id: input.id || nextUserId++, username: input.username, displayName: input.displayName, role: input.role };
      users = input.id ? users.map((entry) => entry.id === input.id ? saved : entry) : [...users, saved];
      return saved;
    },
    deleteUser: async (id) => { users = users.filter((entry) => entry.id !== id); },
    getSettings: async () => ({ ...settings }),
    saveSettings: async (next) => { settings = { ...next }; return { ...settings }; },
    exportCsv: async () => true,
    exportBackup: async () => true,
    restoreBackup: async () => true,
    listPrinters: async () => [],
    printReceipt: async () => true,
  };
}
