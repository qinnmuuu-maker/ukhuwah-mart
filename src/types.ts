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

export interface SaleReceipt {
  id: number;
  total: number;
  paid: number;
  change: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
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

export interface PosBridge {
  listProducts: () => Promise<Product[]>;
  listCategories: () => Promise<Category[]>;
  saveProduct: (product: ProductInput) => Promise<number>;
  deleteProduct: (id: number) => Promise<void>;
  createSale: (sale: { items: Array<{ productId: number; quantity: number }>; paid: number }) => Promise<SaleReceipt>;
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
