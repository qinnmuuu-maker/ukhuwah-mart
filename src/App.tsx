import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Category, CartItem, PosUser, Product, ProductInput, SaleRecord, SalesFilters, StoreSettings,
} from "./types";
import { createPreviewBridge } from "./preview";

type Screen = "kasir" | "produk" | "riwayat" | "laporan" | "pengaturan";
type DiscountType = "amount" | "percent";

const rupiah = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function App() {
  const [initializing, setInitializing] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<PosUser | null>(null);
  const [screen, setScreen] = useState<Screen>("kasir");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [report, setReport] = useState<Awaited<ReturnType<typeof window.pos.getReport>> | null>(null);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [users, setUsers] = useState<PosUser[]>([]);
  const [filters, setFilters] = useState<SalesFilters>({ from: today(), to: today() });
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [message, setMessage] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paid, setPaid] = useState("");
  const [editor, setEditor] = useState<Product | null | false>(false);
  const [editingUser, setEditingUser] = useState<PosUser | null | false>(false);
  const [expandedSale, setExpandedSale] = useState<number | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [discountValue, setDiscountValue] = useState("0");
  const [printerName, setPrinterName] = useState("");
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [paperWidth, setPaperWidth] = useState("58");
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (import.meta.env.DEV && !window.pos) {
      window.pos = createPreviewBridge();
      const previewUser: PosUser = {
        id: 1,
        username: "admin",
        displayName: "Admin Demo",
        role: "admin",
      };
      setUser(previewUser);
      setNeedsSetup(false);
      setMessage("Mode pratinjau browser: data contoh, tidak tersimpan.");
      setInitializing(false);
      void Promise.all([
        window.pos.listProducts(),
        window.pos.listCategories(),
        window.pos.listPrinters(),
        window.pos.getSettings(),
      ]).then(([nextProducts, nextCategories, nextPrinters, nextSettings]) => {
        setProducts(nextProducts);
        setCategories(nextCategories);
        setPrinters(nextPrinters);
        setSettings(nextSettings);
      }).catch((error: unknown) => setMessage(errorMessage(error)));
      return;
    }
    void window.pos.setupStatus()
      .then(setNeedsSetup)
      .catch((error: unknown) => setMessage(errorMessage(error)))
      .finally(() => setInitializing(false));
  }, []);

  async function refreshCatalog() {
    const [nextProducts, nextCategories, nextPrinters, nextSettings] = await Promise.all([
      window.pos.listProducts(), window.pos.listCategories(), window.pos.listPrinters(), window.pos.getSettings(),
    ]);
    setProducts(nextProducts);
    setCategories(nextCategories);
    setPrinters(nextPrinters);
    setSettings(nextSettings);
    setPrinterName((current) => current || nextPrinters.find((printer) => printer.isDefault)?.name || "");
  }

  async function refreshScreenData(target = screen, nextFilters = filters) {
    if (!user) return;
    if (target === "riwayat") setSales(await window.pos.listSales(nextFilters));
    if (target === "laporan") {
      const [nextReport, nextSales] = await Promise.all([
        window.pos.getReport(nextFilters), window.pos.listSales(nextFilters),
      ]);
      setReport(nextReport);
      setSales(nextSales);
    }
    if (target === "pengaturan" && user.role === "admin") {
      const [nextSettings, nextUsers, nextCategories] = await Promise.all([
        window.pos.getSettings(), window.pos.listUsers(), window.pos.listCategories(),
      ]);
      setSettings(nextSettings);
      setUsers(nextUsers);
      setCategories(nextCategories);
    }
  }

  async function finishLogin(nextUser: PosUser) {
    setUser(nextUser);
    setScreen("kasir");
    setMessage(`Halo, ${nextUser.displayName}.`);
    try {
      await refreshCatalog();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function authenticate(event: React.FormEvent<HTMLFormElement>, setup: boolean) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const details = {
        username: String(form.get("username") || ""),
        password: String(form.get("password") || ""),
      };
      const nextUser = setup
        ? await window.pos.setupAdmin({
          ...details,
          displayName: String(form.get("displayName") || ""),
        })
        : await window.pos.login(details);
      setNeedsSetup(false);
      await finishLogin(nextUser);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0),
    [cart],
  );
  const numericDiscount = Number(discountValue) || 0;
  const discount = discountType === "percent"
    ? Math.round(subtotal * numericDiscount / 100)
    : numericDiscount;
  const total = Math.max(0, subtotal - discount);
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("id");
    return query ? products.filter((product) =>
      product.name.toLocaleLowerCase("id").includes(query) ||
      product.barcode?.toLocaleLowerCase("id").includes(query),
    ) : products;
  }, [products, search]);

  function addProduct(product: Product) {
    if (product.stock < 1) {
      setMessage("Stok produk habis.");
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing && existing.quantity >= product.stock) {
        setMessage(`Stok ${product.name} hanya ${product.stock}.`);
        return current;
      }
      return existing
        ? current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { product, quantity: 1 }];
    });
    setMessage("");
    setSearch("");
    searchRef.current?.focus();
  }

  function changeQuantity(productId: number, amount: number) {
    setCart((current) => current.flatMap((item) => {
      if (item.product.id !== productId) return [item];
      const quantity = item.quantity + amount;
      if (quantity < 1) return [];
      if (quantity > item.product.stock) {
        setMessage(`Stok ${item.product.name} hanya ${item.product.stock}.`);
        return [item];
      }
      return [{ ...item, quantity }];
    }));
  }

  async function submitSale() {
    const received = Number(paid);
    if (!Number.isSafeInteger(received) || received < total) {
      setMessage("Nominal pembayaran kurang atau tidak valid.");
      return;
    }
    if (!Number.isSafeInteger(numericDiscount) || numericDiscount < 0 ||
      (discountType === "percent" && numericDiscount > 100) || discount > subtotal) {
      setMessage("Nilai diskon tidak valid atau melebihi subtotal.");
      return;
    }
    setBusy(true);
    try {
      const result = await window.pos.createSale({
        items: cart.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        paid: received,
        discountType,
        discountValue: numericDiscount,
      });
      const receipt = { ...result, createdAt: new Date().toLocaleString("id-ID") };
      setCart([]);
      setPaymentOpen(false);
      setPaid("");
      setDiscountValue("0");
      setMessage(`Transaksi #${result.id} berhasil disimpan.`);
      await refreshCatalog();
      try {
        await window.pos.printReceipt({ receipt, printerName, paperWidth });
      } catch (error) {
        setMessage(`Transaksi tersimpan, tetapi struk gagal dicetak: ${errorMessage(error)}`);
      }
      await refreshScreenData();
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshCatalog();
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(product: ProductInput) {
    try {
      await window.pos.saveProduct(product);
      setEditor(false);
      setMessage("Produk berhasil disimpan.");
      await refreshCatalog();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function removeProduct(product: Product) {
    if (!window.confirm(`Hapus produk "${product.name}"?`)) return;
    try {
      await window.pos.deleteProduct(product.id);
      setMessage("Produk berhasil dihapus.");
      await refreshCatalog();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function importProductsExcel() {
    setImportBusy(true);
    try {
      const result = await window.pos.importProductsExcel();
      if (result.canceled) return;
      await refreshCatalog();
      const details = [
        ...result.duplicateRows.slice(0, 2).map((row) => `Baris ${row.row}: ${row.message}`),
        ...result.errors.slice(0, 2).map((row) => `Baris ${row.row}: ${row.message}`),
      ];
      const remaining = result.duplicateRows.length + result.errors.length - details.length;
      setMessage(
        `Impor selesai: ${result.imported} produk ditambahkan, ${result.duplicates} duplikat dilewati, ${result.errors.length} baris gagal.` +
        (details.length ? ` ${details.join(" · ")}` : "") +
        (remaining > 0 ? ` · ${remaining} masalah lainnya.` : ""),
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setImportBusy(false);
    }
  }

  async function changeScreen(target: Screen) {
    setScreen(target);
    try {
      if (target === "kasir" || target === "produk") await refreshCatalog();
      await refreshScreenData(target);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function applyFilters(next = filters) {
    setFilters(next);
    try {
      await refreshScreenData(screen, next);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function exportCsv() {
    try {
      if (await window.pos.exportCsv(filters)) setMessage("File CSV berhasil diekspor.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function handleBackup(restore: boolean) {
    if (restore && !window.confirm("Pemulihan akan mengganti seluruh data saat ini. Lanjutkan?")) return;
    setBusy(true);
    try {
      const completed = restore ? await window.pos.restoreBackup() : await window.pos.exportBackup();
      if (!completed) return;
      if (restore) {
        setUser(null);
        setNeedsSetup(false);
        setCart([]);
        setMessage("Database dipulihkan. Silakan login memakai akun dari backup.");
      } else {
        setMessage("Backup database berhasil disimpan.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "F2" && user) {
        event.preventDefault();
        void changeScreen("kasir");
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setPaymentOpen(false);
        setEditor(false);
        setEditingUser(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  if (initializing) return <main className="auth-screen"><div className="modal"><h2>Memuat Ukhuwah Mart POS…</h2></div></main>;
  if (!user) return (
    <main className="auth-screen">
      <form className="modal auth-card" onSubmit={(event) => void authenticate(event, needsSetup)}>
        <div className="brand-mark">U</div>
        <p className="eyebrow">{needsSetup ? "PENGATURAN AWAL" : "AKUN LOKAL"}</p>
        <h2>{needsSetup ? "Buat akun Admin" : "Masuk ke kasir"}</h2>
        {needsSetup && <p className="muted-copy">Buat akun Admin pertama. Kata sandi disimpan dalam bentuk hash di perangkat ini.</p>}
        {needsSetup && <label className="field-label">Nama lengkap<input name="displayName" required autoFocus placeholder="Nama Admin" /></label>}
        <label className="field-label">Username<input name="username" required autoFocus={!needsSetup} minLength={3} autoComplete="username" /></label>
        <label className="field-label">Kata sandi<input name="password" required type="password" minLength={8} autoComplete={needsSetup ? "new-password" : "current-password"} /></label>
        {message && <p className="form-error">{message}</p>}
        <button className="button-primary auth-submit" disabled={busy}>{busy ? "Memproses…" : needsSetup ? "Buat akun Admin" : "Masuk"}</button>
        <p className="muted-copy">Aplikasi dan data transaksi tersimpan di perangkat ini.</p>
      </form>
    </main>
  );

  const isAdmin = user.role === "admin";
  const title: Record<Screen, string> = {
    kasir: "Kasir", produk: "Manajemen Produk", riwayat: "Riwayat Transaksi",
    laporan: "Laporan Penjualan", pengaturan: "Pengaturan Toko",
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">U</div><div><strong>ukhuwah</strong><span>mart POS</span></div></div>
        <div className="nav-label">MENU UTAMA</div>
        <NavButton current={screen} target="kasir" onSelect={changeScreen}>▦ Kasir <kbd>F2</kbd></NavButton>
        {isAdmin && <NavButton current={screen} target="produk" onSelect={changeScreen}>◫ Produk</NavButton>}
        <NavButton current={screen} target="riwayat" onSelect={changeScreen}>◷ Riwayat</NavButton>
        {isAdmin && <>
          <NavButton current={screen} target="laporan" onSelect={changeScreen}>▤ Laporan</NavButton>
          <NavButton current={screen} target="pengaturan" onSelect={changeScreen}>⚙ Pengaturan</NavButton>
        </>}
        <div className="sidebar-bottom">
          <div className="offline-status"><span /> Siap digunakan offline</div>
          <button className="logout-button" onClick={() => {
            void window.pos.logout().then(() => { setUser(null); setCart([]); setMessage(""); });
          }}>Keluar ({user.displayName})</button>
          <div className="version">POS Desktop · Lokal</div>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{settings?.storeName || "TOKO ANDA"}</p><h1>{title[screen]}</h1></div>
          <div className="topbar-right"><span className="local-badge"><span /> Data tersimpan lokal</span><span className="avatar">{user.displayName.charAt(0).toLocaleUpperCase("id")}</span><span className="admin-label">{user.displayName} · {isAdmin ? "Admin" : "Kasir"}</span></div>
        </header>
        {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Tutup notifikasi" onClick={() => setMessage("")}>×</button></div>}

        {screen === "kasir" && (
          <div className="pos-layout">
            <section className="catalog">
              <div className="section-heading"><div><h2>Pilih Produk</h2><p>Cari atau scan barcode produk</p></div><span className="count-pill">{products.length} produk</span></div>
              <label className="search-box"><span>⌕</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && visibleProducts.length === 1) addProduct(visibleProducts[0]); }} placeholder="Cari nama produk atau scan barcode..." autoFocus /><kbd>↵</kbd></label>
              {visibleProducts.length ? <div className="product-grid">{visibleProducts.map((product, index) => (
                <button key={product.id} className="product-card" onClick={() => addProduct(product)} disabled={product.stock < 1}>
                  <div className={`product-art art-${index % 5}`}><span>{product.name.charAt(0).toLocaleUpperCase("id")}</span></div>
                  <div className="product-info"><strong>{product.name}</strong><span>{product.category || "Tanpa kategori"}</span><div className="product-price">{rupiah(product.sellingPrice)}</div><div className={`stock ${product.stock < 5 ? "low" : ""}`}>{product.stock > 0 ? `Stok ${product.stock}` : "Stok habis"}</div></div>
                </button>
              ))}</div> : <div className="empty-state"><strong>Produk belum tersedia</strong><p>Tambah produk untuk mulai melayani transaksi.</p>{isAdmin && <button className="button-secondary" onClick={() => void changeScreen("produk")}>Kelola produk</button>}</div>}
            </section>
            <aside className="cart-panel">
              <div className="cart-title"><div><h2>Pesanan</h2><p>{cart.length} jenis produk</p></div>{cart.length > 0 && <button className="text-button" onClick={() => setCart([])}>Kosongkan</button>}</div>
              <div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><strong>Keranjang masih kosong</strong><span>Pilih produk untuk memulai transaksi</span></div> : cart.map((item) => (
                <div className="cart-row" key={item.product.id}>
                  <div className="cart-row-top"><strong>{item.product.name}</strong><button className="remove-item" onClick={() => setCart((current) => current.filter((row) => row.product.id !== item.product.id))}>×</button></div>
                  <div className="cart-row-bottom"><span>{rupiah(item.product.sellingPrice)}</span><div className="quantity-control"><button onClick={() => changeQuantity(item.product.id, -1)}>−</button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.product.id, 1)}>+</button></div><strong>{rupiah(item.product.sellingPrice * item.quantity)}</strong></div>
                </div>
              ))}</div>
              <div className="cart-summary">
                <div className="summary-line"><span>Subtotal</span><span>{rupiah(subtotal)}</span></div>
                <div className="discount-control"><label>Diskon<select value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountType)}><option value="amount">Nominal (Rp)</option><option value="percent">Persentase (%)</option></select></label><input aria-label="Nilai diskon" type="number" min="0" max={discountType === "percent" ? 100 : subtotal} step="1" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} /></div>
                <div className="summary-line"><span>Potongan diskon</span><span>-{rupiah(discount)}</span></div>
                <div className="summary-total"><strong>Total</strong><strong>{rupiah(total)}</strong></div>
                <button className="pay-button" disabled={!cart.length} onClick={() => { setPaid(""); setPaymentOpen(true); }}><span>Bayar sekarang</span><strong>{rupiah(total)}</strong><span className="pay-arrow">→</span></button>
                <div className="printer-settings"><label>Printer struk<select value={printerName} onChange={(event) => setPrinterName(event.target.value)}><option value="">Pilih dari dialog cetak</option>{printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}</select></label><label>Kertas<select value={paperWidth} onChange={(event) => setPaperWidth(event.target.value)}><option value="58">58 mm</option><option value="80">80 mm</option></select></label></div>
              </div>
            </aside>
          </div>
        )}

        {screen === "produk" && isAdmin && <ProductManagement products={products} categories={categories} onAdd={() => setEditor(null)} onImport={() => void importProductsExcel()} importBusy={importBusy} onEdit={setEditor} onDelete={(product) => void removeProduct(product)} onCategoryChange={() => void refreshCatalog()} notify={setMessage} />}
        {screen === "riwayat" && <SalesHistory sales={sales} filters={filters} onFilter={applyFilters} onExport={() => void exportCsv()} expanded={expandedSale} onExpand={setExpandedSale} />}
        {screen === "laporan" && isAdmin && <SalesReport report={report} filters={filters} sales={sales} onFilter={applyFilters} onExport={() => void exportCsv()} />}
        {screen === "pengaturan" && isAdmin && settings && <SettingsPanel settings={settings} users={users} onSettings={async (next) => {
          try { setSettings(await window.pos.saveSettings(next)); setMessage("Profil toko berhasil disimpan."); } catch (error) { setMessage(errorMessage(error)); }
        }} onAddUser={() => setEditingUser(null)} onEditUser={setEditingUser} onDeleteUser={async (selected) => {
          if (!window.confirm(`Hapus akun ${selected.displayName}?`)) return;
          try { await window.pos.deleteUser(selected.id); setUsers(await window.pos.listUsers()); setMessage("Akun pengguna dihapus."); } catch (error) { setMessage(errorMessage(error)); }
        }} onBackup={() => void handleBackup(false)} onRestore={() => void handleBackup(true)} busy={busy} />}
      </section>

      {paymentOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentOpen(false); }}>
        <section className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
          <button className="modal-close" onClick={() => setPaymentOpen(false)}>×</button><p className="eyebrow">SELESAIKAN TRANSAKSI</p><h2 id="payment-title">Pembayaran</h2>
          <div className="payment-total"><span>Total belanja</span><strong>{rupiah(total)}</strong></div>
          <label className="field-label">Uang diterima<input autoFocus type="number" min={total} step="1000" value={paid} onChange={(event) => setPaid(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitSale(); }} placeholder="Masukkan nominal pembayaran" /></label>
          <div className="quick-amounts">{[total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000].filter((value, index, values) => values.indexOf(value) === index).map((value) => <button key={value} onClick={() => setPaid(String(value))}>{value === total ? "Uang pas" : rupiah(value)}</button>)}</div>
          <div className="change-line"><span>Kembalian</span><strong>{rupiah(Math.max(0, Number(paid || 0) - total))}</strong></div>
          <button className="pay-button modal-pay" disabled={busy || Number(paid) < total} onClick={() => void submitSale()}>{busy ? "Menyimpan transaksi..." : "Simpan & cetak struk"}</button>
        </section>
      </div>}
      {editor !== false && <ProductEditor product={editor} categories={categories} onClose={() => setEditor(false)} onSave={(product) => void saveProduct(product)} />}
      {editingUser !== false && <UserEditor user={editingUser} onClose={() => setEditingUser(false)} onSave={async (value) => {
        try {
          const saved = await window.pos.saveUser(value);
          if (saved.id === user.id) setUser(saved);
          setEditingUser(false);
          setUsers(await window.pos.listUsers());
          setMessage("Akun pengguna berhasil disimpan.");
        } catch (error) { setMessage(errorMessage(error)); }
      }} />}
    </main>
  );
}

function NavButton({ current, target, onSelect, children }: {
  current: Screen; target: Screen; onSelect: (screen: Screen) => void; children: React.ReactNode;
}) {
  return <button className={`nav-item ${current === target ? "active" : ""}`} onClick={() => void onSelect(target)}>{children}</button>;
}

function DateFilter({ filters, onFilter }: { filters: SalesFilters; onFilter: (filters: SalesFilters) => void }) {
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  return <div className="filter-bar">
    <label>Dari<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
    <label>Sampai<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    <button className="button-primary" onClick={() => onFilter({ from, to })}>Terapkan</button>
  </div>;
}

function SalesHistory({ sales, filters, onFilter, onExport, expanded, onExpand }: {
  sales: SaleRecord[]; filters: SalesFilters; onFilter: (filters: SalesFilters) => void;
  onExport: () => void; expanded: number | null; onExpand: (id: number | null) => void;
}) {
  return <section className="management">
    <div className="management-heading"><div><h2>Transaksi tersimpan</h2><p>Riwayat lokal yang dapat difilter dan diekspor.</p></div><button className="button-primary" onClick={onExport}>Ekspor CSV</button></div>
    <DateFilter filters={filters} onFilter={onFilter} />
    <div className="table-wrap"><table><thead><tr><th>NO.</th><th>TANGGAL</th><th>KASIR</th><th>ITEM</th><th>DISKON</th><th>TOTAL</th><th></th></tr></thead><tbody>
      {sales.map((sale) => <><tr key={sale.id} className="clickable-row" onClick={() => onExpand(expanded === sale.id ? null : sale.id)}>
        <td>#{sale.id}</td><td>{sale.createdAt}</td><td>{sale.cashierName || "—"}</td><td>{sale.items.reduce((count, item) => count + item.quantity, 0)}</td><td>{rupiah(sale.discount)}</td><td><strong>{rupiah(sale.total)}</strong></td><td>{expanded === sale.id ? "−" : "+"}</td>
      </tr>{expanded === sale.id && <tr key={`${sale.id}-details`}><td colSpan={7}><div className="sale-detail"><strong>Rincian</strong>{sale.items.map((item, index) => <div key={`${sale.id}-${index}`}><span>{item.name} × {item.quantity}</span><span>{rupiah(item.subtotal)}</span></div>)}<div><span>Subtotal {rupiah(sale.subtotal)} · Diskon {rupiah(sale.discount)}</span><span>Dibayar {rupiah(sale.paid)} · Kembali {rupiah(sale.change)}</span></div></div></td></tr>}</>)}
      {!sales.length && <tr><td className="table-empty" colSpan={7}>Tidak ada transaksi untuk periode ini.</td></tr>}
    </tbody></table></div>
  </section>;
}

function SalesReport({ report, filters, sales, onFilter, onExport }: {
  report: Awaited<ReturnType<typeof window.pos.getReport>> | null; filters: SalesFilters;
  sales: SaleRecord[]; onFilter: (filters: SalesFilters) => void; onExport: () => void;
}) {
  return <section className="management">
    <div className="management-heading"><div><h2>Ringkasan penjualan</h2><p>Angka berdasarkan rentang tanggal yang dipilih.</p></div><button className="button-primary" onClick={onExport}>Ekspor CSV</button></div>
    <DateFilter filters={filters} onFilter={onFilter} />
    {report && <><div className="metric-grid">
      <Metric label="Transaksi" value={String(report.transactionCount)} />
      <Metric label="Produk terjual" value={String(report.itemsSold)} />
      <Metric label="Penjualan kotor" value={rupiah(report.grossSales)} />
      <Metric label="Diskon" value={rupiah(report.discounts)} />
      <Metric label="Penjualan bersih" value={rupiah(report.netSales)} />
    </div><div className="report-columns"><div><h3>Produk terlaris</h3><div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>QTY</th><th>PENJUALAN</th></tr></thead><tbody>
      {report.topProducts.map((product) => <tr key={product.name}><td>{product.name}</td><td>{product.quantity}</td><td>{rupiah(product.gross)}</td></tr>)}
      {!report.topProducts.length && <tr><td className="table-empty" colSpan={3}>Belum ada penjualan.</td></tr>}
    </tbody></table></div></div><div><h3>Transaksi terbaru</h3><div className="table-wrap"><table><thead><tr><th>NO.</th><th>WAKTU</th><th>TOTAL</th></tr></thead><tbody>{sales.slice(0, 8).map((sale) => <tr key={sale.id}><td>#{sale.id}</td><td>{sale.createdAt}</td><td>{rupiah(sale.total)}</td></tr>)}</tbody></table></div></div></div></>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>;
}

function ProductManagement({ products, categories, onAdd, onImport, importBusy, onEdit, onDelete, onCategoryChange, notify }: {
  products: Product[]; categories: Category[]; onAdd: () => void; onEdit: (product: Product) => void;
  onImport: () => void; importBusy: boolean;
  onDelete: (product: Product) => void; onCategoryChange: () => void; notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = products.filter((product) => `${product.name} ${product.barcode || ""}`.toLocaleLowerCase("id").includes(query.toLocaleLowerCase("id")));
  async function editCategory(category?: Category) {
    const name = window.prompt(category ? "Ubah nama kategori" : "Nama kategori baru", category?.name || "");
    if (name === null) return;
    try {
      await window.pos.saveCategory({ ...(category ? { id: category.id } : {}), name });
      notify("Kategori berhasil disimpan.");
      onCategoryChange();
    } catch (error) { notify(errorMessage(error)); }
  }
  async function removeCategory(category: Category) {
    if (!window.confirm(`Hapus kategori "${category.name}"? Produk di kategori ini akan menjadi tanpa kategori.`)) return;
    try {
      await window.pos.deleteCategory(category.id);
      notify("Kategori berhasil dihapus.");
      onCategoryChange();
    } catch (error) { notify(errorMessage(error)); }
  }
  return <section className="management">
    <div className="management-heading">
      <div><h2>Daftar Produk</h2><p>Kelola katalog dan pantau ketersediaan stok.</p></div>
      <div className="management-actions"><button className="button-secondary" disabled={importBusy} onClick={onImport}>{importBusy ? "Mengimpor…" : "Impor Excel"}</button><button className="button-primary" onClick={onAdd}>＋ Tambah produk</button></div>
    </div>
    <p className="import-help">Format .xls atau .xlsx · Kolom wajib: Nama Produk, Harga Jual, Stok · Opsional: Barcode, Kategori, Harga Beli · Barcode ganda dilewati.</p>
    <div className="management-toolbar"><label className="search-box compact"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama atau barcode..." /></label><span>{filtered.length} produk</span></div>
    <div className="table-wrap"><table><thead><tr><th>NAMA PRODUK</th><th>BARCODE</th><th>KATEGORI</th><th>HARGA BELI</th><th>HARGA JUAL</th><th>STOK</th><th></th></tr></thead><tbody>
      {filtered.map((product) => <tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.barcode || "—"}</td><td>{product.category || "Umum"}</td><td>{rupiah(product.costPrice)}</td><td className="selling-cell">{rupiah(product.sellingPrice)}</td><td className={`table-stock ${product.stock < 5 ? "low" : ""}`}>{product.stock}</td><td className="actions"><button onClick={() => onEdit(product)}>Ubah</button><button onClick={() => onDelete(product)}>Hapus</button></td></tr>)}
      {!filtered.length && <tr><td className="table-empty" colSpan={7}>Belum ada produk. Tambahkan produk pertama Anda.</td></tr>}
    </tbody></table></div>
    <div className="category-panel"><div className="management-heading"><div><h2>Kategori</h2><p>Kelola kategori yang tersedia di katalog.</p></div><button className="button-secondary" onClick={() => void editCategory()}>Tambah kategori</button></div><div className="category-list">{categories.map((category) => <div className="category-chip" key={category.id}><span>{category.name}</span><button onClick={() => void editCategory(category)}>Ubah</button>{category.name !== "Umum" && <button onClick={() => void removeCategory(category)}>Hapus</button>}</div>)}</div></div>
  </section>;
}

function SettingsPanel({ settings, users, onSettings, onAddUser, onEditUser, onDeleteUser, onBackup, onRestore, busy }: {
  settings: StoreSettings; users: PosUser[]; onSettings: (settings: StoreSettings) => void;
  onAddUser: () => void; onEditUser: (user: PosUser) => void; onDeleteUser: (user: PosUser) => void;
  onBackup: () => void; onRestore: () => void; busy: boolean;
}) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  const set = (key: keyof StoreSettings, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <section className="management settings-layout">
    <div className="management-heading"><div><h2>Profil toko</h2><p>Informasi ini ditampilkan pada struk transaksi.</p></div></div>
    <div className="settings-card">
      <label className="field-label">Nama toko<input value={form.storeName} onChange={(event) => set("storeName", event.target.value)} maxLength={200} /></label>
      <label className="field-label">Alamat<input value={form.storeAddress} onChange={(event) => set("storeAddress", event.target.value)} maxLength={200} /></label>
      <label className="field-label">Nomor telepon<input value={form.storePhone} onChange={(event) => set("storePhone", event.target.value)} maxLength={200} /></label>
      <label className="field-label">Pesan pada struk<input value={form.receiptFooter} onChange={(event) => set("receiptFooter", event.target.value)} maxLength={200} /></label>
      <button className="button-primary" onClick={() => onSettings(form)}>Simpan profil toko</button>
    </div>
    <div className="management-heading"><div><h2>Akun pengguna</h2><p>Akun lokal dan peran Admin/Kasir.</p></div><button className="button-primary" onClick={onAddUser}>＋ Tambah pengguna</button></div>
    <div className="table-wrap"><table><thead><tr><th>NAMA</th><th>USERNAME</th><th>PERAN</th><th></th></tr></thead><tbody>{users.map((selected) => <tr key={selected.id}><td>{selected.displayName}</td><td>{selected.username}</td><td>{selected.role === "admin" ? "Admin" : "Kasir"}</td><td className="actions"><button onClick={() => onEditUser(selected)}>Ubah</button><button onClick={() => onDeleteUser(selected)}>Hapus</button></td></tr>)}</tbody></table></div>
    <div className="backup-card"><div><h2>Backup & pemulihan</h2><p>Backup menyimpan produk, transaksi, akun, dan pengaturan di file SQLite.</p></div><div className="backup-actions"><button className="button-secondary" disabled={busy} onClick={onBackup}>Simpan backup</button><button className="button-secondary danger-button" disabled={busy} onClick={onRestore}>Pulihkan backup</button></div></div>
  </section>;
}

function UserEditor({ user, onClose, onSave }: {
  user: PosUser | null; onClose: () => void;
  onSave: (value: { id?: number; username: string; displayName: string; role: PosUser["role"]; password?: string }) => void;
}) {
  const [error, setError] = useState("");
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (!user && password.length < 8) { setError("Kata sandi minimal 8 karakter."); return; }
    if (password && password.length < 8) { setError("Kata sandi minimal 8 karakter."); return; }
    onSave({
      ...(user ? { id: user.id } : {}),
      username: String(form.get("username") || ""),
      displayName: String(form.get("displayName") || ""),
      role: String(form.get("role")) as PosUser["role"],
      ...(password ? { password } : {}),
    });
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">AKUN LOKAL</p><h2>{user ? "Ubah pengguna" : "Tambah pengguna"}</h2>
    <label className="field-label">Nama<input name="displayName" defaultValue={user?.displayName || ""} required autoFocus /></label>
    <label className="field-label">Username<input name="username" defaultValue={user?.username || ""} required minLength={3} /></label>
    <label className="field-label">Peran<select name="role" defaultValue={user?.role || "cashier"}><option value="admin">Admin</option><option value="cashier">Kasir</option></select></label>
    <label className="field-label">Kata sandi{user && <span className="muted-copy"> (kosongkan jika tidak diubah)</span>}<input name="password" type="password" minLength={8} required={!user} autoComplete="new-password" /></label>
    {error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Batal</button><button className="button-primary">Simpan</button></div>
  </form></div>;
}

function ProductEditor({ product, categories, onClose, onSave }: {
  product: Product | null; categories: Category[]; onClose: () => void; onSave: (product: ProductInput) => void;
}) {
  const [name, setName] = useState(product?.name || "");
  const [barcode, setBarcode] = useState(product?.barcode || "");
  const [categoryId, setCategoryId] = useState(String(product?.category_id || categories[0]?.id || ""));
  const [costPrice, setCostPrice] = useState(String(product?.costPrice ?? ""));
  const [sellingPrice, setSellingPrice] = useState(String(product?.sellingPrice ?? ""));
  const [stock, setStock] = useState(String(product?.stock ?? ""));
  const [error, setError] = useState("");
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const cost = Number(costPrice); const selling = Number(sellingPrice); const quantity = Number(stock);
    if (!name.trim()) return setError("Nama produk wajib diisi.");
    if (![cost, selling, quantity].every(Number.isSafeInteger) || cost < 0 || selling < 0 || quantity < 0) return setError("Harga dan stok harus bilangan bulat positif atau nol.");
    onSave({ ...(product ? { id: product.id } : {}), name: name.trim(), barcode: barcode.trim(), categoryId: categoryId ? Number(categoryId) : null, costPrice: cost, sellingPrice: selling, stock: quantity });
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal product-modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">KATALOG PRODUK</p><h2>{product ? "Ubah produk" : "Tambah produk"}</h2>
    <label className="field-label">Nama produk<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="form-row"><label className="field-label">Barcode<input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Opsional" /></label><label className="field-label">Kategori<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
    <div className="form-row"><label className="field-label">Harga beli<input type="number" min="0" step="1" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} /></label><label className="field-label">Harga jual<input type="number" min="0" step="1" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} /></label></div>
    <label className="field-label">Stok<input type="number" min="0" step="1" value={stock} onChange={(event) => setStock(event.target.value)} /></label>
    {error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Batal</button><button className="button-primary" type="submit">Simpan produk</button></div>
  </form></div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui.";
}

export default App;
