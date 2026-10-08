import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, CartItem, Product, ProductInput } from "./types";

type Screen = "kasir" | "produk";

const rupiah = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

function App() {
  const [screen, setScreen] = useState<Screen>("kasir");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [message, setMessage] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paid, setPaid] = useState("");
  const [editor, setEditor] = useState<Product | null | false>(false);
  const [printerName, setPrinterName] = useState("");
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [paperWidth, setPaperWidth] = useState("58");
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const [nextProducts, nextCategories, nextPrinters] = await Promise.all([
      window.pos.listProducts(),
      window.pos.listCategories(),
      window.pos.listPrinters(),
    ]);
    setProducts(nextProducts);
    setCategories(nextCategories);
    setPrinters(nextPrinters);
    setPrinterName((current) => current || nextPrinters.find((printer) => printer.isDefault)?.name || "");
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => setMessage(errorMessage(error)));
  }, []);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0),
    [cart],
  );

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("id");
    if (!query) return products;
    return products.filter((product) =>
      product.name.toLocaleLowerCase("id").includes(query) ||
      product.barcode?.toLocaleLowerCase("id").includes(query),
    );
  }, [products, search]);

  function addProduct(product: Product) {
    if (product.stock < 1) {
      setMessage("Stok produk habis.");
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          setMessage(`Stok ${product.name} hanya ${product.stock}.`);
          return current;
        }
        return current.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
    setMessage("");
    setSearch("");
    searchRef.current?.focus();
  }

  function changeQuantity(productId: number, amount: number) {
    setCart((current) =>
      current.flatMap((item) => {
        if (item.product.id !== productId) return [item];
        const quantity = item.quantity + amount;
        if (quantity < 1) return [];
        if (quantity > item.product.stock) {
          setMessage(`Stok ${item.product.name} hanya ${item.product.stock}.`);
          return [item];
        }
        return [{ ...item, quantity }];
      }),
    );
  }

  async function submitSale() {
    const received = Number(paid);
    if (!Number.isSafeInteger(received) || received < total) {
      setMessage("Nominal pembayaran kurang atau tidak valid.");
      return;
    }
    setBusy(true);
    try {
      const result = await window.pos.createSale({
        items: cart.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        paid: received,
      });
      const receipt = { ...result, createdAt: new Date().toLocaleString("id-ID") };
      setCart([]);
      setPaymentOpen(false);
      setPaid("");
      setMessage(`Transaksi #${result.id} berhasil disimpan.`);
      await refresh();
      try {
        await window.pos.printReceipt({ receipt, printerName, paperWidth });
      } catch (error) {
        setMessage(`Transaksi tersimpan, tetapi struk gagal dicetak: ${errorMessage(error)}`);
      }
    } catch (error) {
      setMessage(errorMessage(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(product: ProductInput) {
    try {
      await window.pos.saveProduct(product);
      setEditor(false);
      setMessage("Produk berhasil disimpan.");
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function removeProduct(product: Product) {
    if (!window.confirm(`Hapus produk "${product.name}"?`)) return;
    try {
      await window.pos.deleteProduct(product.id);
      setMessage("Produk berhasil dihapus.");
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        setScreen("kasir");
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setPaymentOpen(false);
        setEditor(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">U</div>
          <div><strong>ukhuwah</strong><span>mart POS</span></div>
        </div>
        <div className="nav-label">MENU UTAMA</div>
        <button className={`nav-item ${screen === "kasir" ? "active" : ""}`} onClick={() => setScreen("kasir")}>
          <span className="nav-icon">▦</span> Kasir <kbd>F2</kbd>
        </button>
        <button className={`nav-item ${screen === "produk" ? "active" : ""}`} onClick={() => setScreen("produk")}>
          <span className="nav-icon">◫</span> Produk
        </button>
        <div className="sidebar-bottom">
          <div className="offline-status"><span /> Siap digunakan offline</div>
          <div className="version">POS Desktop · MVP</div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">TOKO ANDA</p><h1>{screen === "kasir" ? "Kasir" : "Manajemen Produk"}</h1></div>
          <div className="topbar-right">
            <span className="local-badge"><span /> Data tersimpan lokal</span>
            <span className="avatar">A</span>
            <span className="admin-label">Admin</span>
          </div>
        </header>

        {message && (
          <div className="toast" role="status">
            <span>{message}</span><button aria-label="Tutup notifikasi" onClick={() => setMessage("")}>×</button>
          </div>
        )}

        {screen === "kasir" ? (
          <div className="pos-layout">
            <section className="catalog">
              <div className="section-heading">
                <div><h2>Pilih Produk</h2><p>Cari atau scan barcode produk</p></div>
                <span className="count-pill">{products.length} produk</span>
              </div>
              <label className="search-box">
                <span>⌕</span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && visibleProducts.length === 1) addProduct(visibleProducts[0]);
                  }}
                  placeholder="Cari nama produk atau scan barcode..."
                  autoFocus
                />
                <kbd>↵</kbd>
              </label>
              {visibleProducts.length ? (
                <div className="product-grid">
                  {visibleProducts.map((product, index) => (
                    <button
                      key={product.id}
                      className="product-card"
                      onClick={() => addProduct(product)}
                      disabled={product.stock < 1}
                    >
                      <div className={`product-art art-${index % 5}`}><span>{product.name.charAt(0).toLocaleUpperCase("id")}</span></div>
                      <div className="product-info">
                        <strong>{product.name}</strong>
                        <span>{product.category || "Tanpa kategori"}</span>
                        <div className="product-price">{rupiah(product.sellingPrice)}</div>
                        <div className={`stock ${product.stock < 5 ? "low" : ""}`}>{product.stock > 0 ? `Stok ${product.stock}` : "Stok habis"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state"><div className="empty-icon">◫</div><strong>Produk belum tersedia</strong><p>Tambah produk untuk mulai melayani transaksi.</p><button className="button-secondary" onClick={() => setScreen("produk")}>Kelola produk</button></div>
              )}
            </section>

            <aside className="cart-panel">
              <div className="cart-title">
                <div><h2>Pesanan</h2><p>{cart.length} jenis produk</p></div>
                {cart.length > 0 && <button className="text-button" onClick={() => setCart([])}>Kosongkan</button>}
              </div>
              <div className="cart-items">
                {cart.length === 0 ? (
                  <div className="cart-empty"><div>🛍</div><strong>Keranjang masih kosong</strong><span>Pilih produk untuk memulai transaksi</span></div>
                ) : cart.map((item) => (
                  <div className="cart-row" key={item.product.id}>
                    <div className="cart-row-top"><strong>{item.product.name}</strong><button className="remove-item" onClick={() => setCart((current) => current.filter((row) => row.product.id !== item.product.id))}>×</button></div>
                    <div className="cart-row-bottom"><span>{rupiah(item.product.sellingPrice)}</span><div className="quantity-control"><button onClick={() => changeQuantity(item.product.id, -1)}>−</button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.product.id, 1)}>+</button></div><strong>{rupiah(item.product.sellingPrice * item.quantity)}</strong></div>
                  </div>
                ))}
              </div>
              <div className="cart-summary">
                <div className="summary-line"><span>Subtotal</span><span>{rupiah(total)}</span></div>
                <div className="summary-line"><span>Diskon</span><span>—</span></div>
                <div className="summary-total"><strong>Total</strong><strong>{rupiah(total)}</strong></div>
                <button className="pay-button" disabled={!cart.length} onClick={() => { setPaid(""); setPaymentOpen(true); }}>
                  <span>Bayar sekarang</span><strong>{rupiah(total)}</strong><span className="pay-arrow">→</span>
                </button>
                <div className="printer-settings">
                  <label>Printer struk
                    <select value={printerName} onChange={(event) => setPrinterName(event.target.value)}>
                      <option value="">Pilih dari dialog cetak</option>
                      {printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}
                    </select>
                  </label>
                  <label>Kertas
                    <select value={paperWidth} onChange={(event) => setPaperWidth(event.target.value)}>
                      <option value="58">58 mm</option><option value="80">80 mm</option>
                    </select>
                  </label>
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <ProductManagement
            products={products}
            onAdd={() => setEditor(null)}
            onEdit={setEditor}
            onDelete={(product) => void removeProduct(product)}
          />
        )}
      </section>

      {paymentOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentOpen(false); }}>
          <section className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
            <button className="modal-close" onClick={() => setPaymentOpen(false)}>×</button>
            <p className="eyebrow">SELESAIKAN TRANSAKSI</p>
            <h2 id="payment-title">Pembayaran</h2>
            <div className="payment-total"><span>Total belanja</span><strong>{rupiah(total)}</strong></div>
            <label className="field-label">Uang diterima
              <input autoFocus type="number" min={total} step="1000" value={paid} onChange={(event) => setPaid(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSale(); }} placeholder="Masukkan nominal pembayaran" />
            </label>
            <div className="quick-amounts">
              {[total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000].filter((value, index, values) => values.indexOf(value) === index).map((value) => <button key={value} onClick={() => setPaid(String(value))}>{value === total ? "Uang pas" : rupiah(value)}</button>)}
            </div>
            <div className="change-line"><span>Kembalian</span><strong>{rupiah(Math.max(0, Number(paid || 0) - total))}</strong></div>
            <button className="pay-button modal-pay" disabled={busy || Number(paid) < total} onClick={() => void submitSale()}>{busy ? "Menyimpan transaksi..." : "Simpan & cetak struk"}</button>
          </section>
        </div>
      )}

      {editor !== false && (
        <ProductEditor
          product={editor}
          categories={categories}
          onClose={() => setEditor(false)}
          onSave={(product) => void saveProduct(product)}
        />
      )}
    </main>
  );
}

function ProductManagement({
  products,
  onAdd,
  onEdit,
  onDelete,
}: {
  products: Product[];
  onAdd: () => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = products.filter((product) => `${product.name} ${product.barcode || ""}`.toLocaleLowerCase("id").includes(query.toLocaleLowerCase("id")));

  return (
    <section className="management">
      <div className="management-heading">
        <div><h2>Daftar Produk</h2><p>Kelola katalog dan pantau ketersediaan stok.</p></div>
        <button className="button-primary" onClick={onAdd}><span>＋</span> Tambah produk</button>
      </div>
      <div className="management-toolbar">
        <label className="search-box compact"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama atau barcode..." /></label>
        <span className="count-pill">{filtered.length} produk</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>PRODUK</th><th>BARCODE</th><th>KATEGORI</th><th>HARGA BELI</th><th>HARGA JUAL</th><th>STOK</th><th></th></tr></thead>
          <tbody>
            {filtered.map((product) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong></td><td>{product.barcode || "—"}</td><td>{product.category || "Umum"}</td>
                <td>{rupiah(product.costPrice)}</td><td className="selling-cell">{rupiah(product.sellingPrice)}</td>
                <td><span className={`table-stock ${product.stock < 5 ? "low" : ""}`}>{product.stock}</span></td>
                <td className="actions"><button onClick={() => onEdit(product)}>Ubah</button><button onClick={() => onDelete(product)}>Hapus</button></td>
              </tr>
            ))}
            {!filtered.length && <tr><td className="table-empty" colSpan={7}>Belum ada produk. Tambahkan produk pertama Anda.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductEditor({
  product,
  categories,
  onClose,
  onSave,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSave: (product: ProductInput) => void;
}) {
  const [name, setName] = useState(product?.name || "");
  const [barcode, setBarcode] = useState(product?.barcode || "");
  const [categoryId, setCategoryId] = useState(String(product?.category_id || categories[0]?.id || ""));
  const [costPrice, setCostPrice] = useState(String(product?.costPrice || ""));
  const [sellingPrice, setSellingPrice] = useState(String(product?.sellingPrice || ""));
  const [stock, setStock] = useState(String(product?.stock ?? ""));
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const cost = Number(costPrice);
    const selling = Number(sellingPrice);
    const quantity = Number(stock);
    if (!name.trim()) return setError("Nama produk wajib diisi.");
    if (![cost, selling, quantity].every(Number.isSafeInteger) || cost < 0 || selling < 0 || quantity < 0) {
      return setError("Harga dan stok harus bilangan bulat positif atau nol.");
    }
    onSave({
      ...(product ? { id: product.id } : {}),
      name: name.trim(),
      barcode: barcode.trim(),
      categoryId: categoryId ? Number(categoryId) : null,
      costPrice: cost,
      sellingPrice: selling,
      stock: quantity,
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal product-modal" onSubmit={submit} role="dialog" aria-modal="true">
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <p className="eyebrow">KATALOG PRODUK</p><h2>{product ? "Ubah produk" : "Tambah produk"}</h2>
        <label className="field-label">Nama produk<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Kopi Arabika 200g" /></label>
        <div className="form-row">
          <label className="field-label">Barcode<input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Opsional" /></label>
          <label className="field-label">Kategori<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        </div>
        <div className="form-row">
          <label className="field-label">Harga beli<input type="number" min="0" step="1" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} placeholder="0" /></label>
          <label className="field-label">Harga jual<input type="number" min="0" step="1" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} placeholder="0" /></label>
        </div>
        <label className="field-label">Stok<input type="number" min="0" step="1" value={stock} onChange={(event) => setStock(event.target.value)} placeholder="0" /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Batal</button><button className="button-primary" type="submit">Simpan produk</button></div>
      </form>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui.";
}

export default App;
