# Ukhuwah Mart POS

Aplikasi kasir desktop offline untuk Windows, dibuat dengan Electron, React, dan SQLite.

## Fitur

- Login lokal dengan setup akun Admin pertama, akun Admin/Kasir, serta pembatasan akses berdasarkan peran. Kata sandi disimpan dengan salt dan hash scrypt.
- Katalog produk: tambah, ubah, hapus, cari, barcode, kategori, harga beli/jual, dan stok; daftar kategori dapat dikelola.
- Impor katalog dari workbook Excel `.xls` atau `.xlsx`. Header wajib: `Nama Produk`, `Harga Jual`, `Stok`; `Barcode`, `Kategori`, dan `Harga Beli` bersifat opsional. Nama header bahasa Inggris (`Name`, `Selling Price`, `Stock`, dan seterusnya) juga dikenali. Baris dengan barcode yang sudah terdaftar atau duplikat dalam file dilewati dan dilaporkan; kategori yang belum ada dibuat otomatis. Harga dan stok harus bilangan bulat non-negatif.
- Kasir: pencarian produk atau scanner barcode USB/HID, keranjang, perubahan kuantitas, diskon nominal/persentase, pembayaran, dan kembalian.
- Transaksi disimpan dan stok dikurangi secara atomik di SQLite; data transaksi menyimpan rincian item, diskon, kasir, pembayaran, dan kembalian.
- Riwayat transaksi dengan filter tanggal dan laporan penjualan (jumlah transaksi/item, penjualan kotor, diskon, penjualan bersih, serta produk terlaris).
- Ekspor transaksi ke CSV yang dapat dibuka di Excel.
- Backup database ke file SQLite dan pemulihan manual melalui Pengaturan. Pemulihan mengganti data aktif dan mengharuskan login ulang menggunakan akun pada backup.
- Profil toko (nama, alamat, telepon, dan pesan struk) serta pencetakan struk ke printer Windows; mendukung pemilihan printer dan kertas thermal 58 mm/80 mm.

Database dibuat otomatis di direktori data aplikasi Electron (`%APPDATA%/ukhuwah-mart-pos/ukhuwah-mart.db`). Aplikasi tidak memerlukan koneksi internet. Akun awal Admin dibuat saat pertama kali aplikasi dibuka. Admin dapat membuat akun Kasir/Admin tambahan.

## Menjalankan dalam mode pengembangan

Persyaratan pengembangan: Node.js dan npm. Jalankan:

```sh
npm install
npm run dev
```

Jika Electron tidak dapat dijalankan di lingkungan Linux, tampilan dapat dipratinjau dengan `npx vite --host 0.0.0.0`, lalu buka port 5173 di browser. Dalam mode development browser, aplikasi menampilkan katalog contoh dan transaksi demo tanpa menyimpan data.

## Pengujian dan build

```sh
npm test
npm run build
```

Untuk menghasilkan installer Windows `.exe`, jalankan `npm run dist:win` dari Windows. Hasil build ada di folder `release/`. Dari Linux, `npm run dist:win:dir` menghasilkan folder aplikasi Windows di `release/win-unpacked/`, termasuk `Ukhuwah Mart POS.exe`; folder itu dapat dibagikan sebagai arsip ZIP dan dijalankan di Windows. NSIS installer dari Linux memerlukan Wine. Electron Builder mengemas runtime Electron dan SQLite; pengguna tidak perlu memasang Node.js atau server database.

## Batasan

Printer menggunakan antrean dan driver printer Windows; koneksi ESC/POS langsung dan konfigurasi perangkat printer lanjutan belum tersedia. Ekspor laporan saat ini menggunakan CSV, bukan XLSX/PDF.
