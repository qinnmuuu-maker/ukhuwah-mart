# Ukhuwah Mart POS

Aplikasi kasir desktop offline untuk Windows, dibuat dengan Electron, React, dan SQLite.

## Fitur MVP

- Katalog produk lokal dengan tambah, ubah, hapus, barcode, kategori, harga, dan stok.
- Pencarian produk serta input scanner barcode USB/HID pada layar kasir.
- Keranjang, perubahan kuantitas, pembayaran, dan perhitungan kembalian.
- Penyimpanan transaksi dan pengurangan stok secara atomik di SQLite.
- Cetak struk ke printer yang terpasang di Windows, termasuk printer thermal 58 mm/80 mm.

Database dibuat otomatis di direktori data aplikasi Electron (`%APPDATA%/ukhuwah-mart-pos/ukhuwah-mart.db`). Aplikasi tidak memerlukan koneksi internet untuk fungsi kasir. Printer thermal harus sudah dipasang di Windows; pencetakan memakai driver printer Windows dan mendukung pemilihan printer atau dialog cetak.

## Menjalankan dalam mode pengembangan

Persyaratan pengembangan: Node.js dan npm. Jalankan:

```sh
npm install
npm run dev
```

## Pengujian dan build

```sh
npm test
npm run build
```

Untuk menghasilkan installer Windows `.exe`, jalankan `npm run dist:win` dari Windows. Hasil build ada di folder `release/`. Dari Linux, `npm run dist:win:dir` menghasilkan folder aplikasi Windows di `release/win-unpacked/`, termasuk `Ukhuwah Mart POS.exe`; folder itu dapat dibagikan sebagai arsip ZIP dan dijalankan di Windows. NSIS installer dari Linux memerlukan Wine. Electron Builder mengemas runtime Electron dan SQLite; pengguna tidak perlu memasang Node.js atau server database.

## Catatan MVP

Login dan peran, diskon, laporan/riwayat, ekspor, backup/restore, dan pengaturan profil toko belum termasuk MVP awal. Printer memakai antrean dan driver Windows; dukungan perintah ESC/POS langsung dan konfigurasi lanjutan printer memerlukan integrasi perangkat khusus.
