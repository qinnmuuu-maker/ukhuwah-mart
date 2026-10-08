export interface Product {
  id: number;
  name: string;
  barcode: string | null;
  category_id: number | null;
  category: string | null;
  costPrice: number;
  sellingPrice: number;
  stock: number;
}

export interface Category {
  id: number;
  name: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface PosUser {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "cashier";
}

export interface SaleReceipt {
  id: number;
  subtotal: number;
  discount: number;
  discountType: "amount" | "percent";
  discountValue: number;
  total: number;
  paid: number;
  change: number;
  cashierName: string;
  createdAt?: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

export interface SaleRecord extends SaleReceipt {
  createdAt: string;
}

export interface ProductInput {
  id?: number;
  name: string;
  barcode: string;
  categoryId: number | null;
  costPrice: number;
  sellingPrice: number;
  stock: number;
}

export interface StoreSettings {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  receiptFooter: string;
}

export interface SalesFilters {
  from: string;
  to: string;
}

export interface ProductImportResult {
  canceled: boolean;
  imported: number;
  duplicates: number;
  duplicateRows: Array<{ row: number; message: string }>;
  errors: Array<{ row: number; message: string }>;
}

export interface PosBridge {
  setupStatus: () => Promise<boolean>;
  setupAdmin: (details: { username: string; displayName: string; password: string }) => Promise<PosUser>;
  login: (credentials: { username: string; password: string }) => Promise<PosUser>;
  logout: () => Promise<void>;
  currentUser: () => Promise<PosUser | null>;
  listProducts: () => Promise<Product[]>;
  listCategories: () => Promise<Category[]>;
  saveCategory: (category: { id?: number; name: string }) => Promise<number>;
  deleteCategory: (id: number) => Promise<void>;
  saveProduct: (product: ProductInput) => Promise<number>;
  importProductsExcel: () => Promise<ProductImportResult>;
  deleteProduct: (id: number) => Promise<void>;
  createSale: (sale: {
    items: Array<{ productId: number; quantity: number }>;
    paid: number;
    discountType: "amount" | "percent";
    discountValue: number;
  }) => Promise<SaleReceipt>;
  listSales: (filters: SalesFilters) => Promise<SaleRecord[]>;
  getReport: (filters: SalesFilters) => Promise<{
    transactionCount: number;
    grossSales: number;
    discounts: number;
    netSales: number;
    itemsSold: number;
    topProducts: Array<{ name: string; quantity: number; gross: number }>;
  }>;
  listUsers: () => Promise<PosUser[]>;
  saveUser: (user: {
    id?: number;
    username: string;
    displayName: string;
    role: PosUser["role"];
    password?: string;
  }) => Promise<PosUser>;
  deleteUser: (id: number) => Promise<void>;
  getSettings: () => Promise<StoreSettings>;
  saveSettings: (settings: StoreSettings) => Promise<StoreSettings>;
  exportCsv: (filters: SalesFilters) => Promise<boolean>;
  exportBackup: () => Promise<boolean>;
  restoreBackup: () => Promise<boolean>;
  listPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>;
  printReceipt: (options: {
    receipt: SaleReceipt & { createdAt: string };
    printerName: string;
    paperWidth: string;
  }) => Promise<boolean>;
}

declare global {
  interface Window {
    pos: PosBridge;
  }
}
