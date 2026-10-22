# Ekstensi browser Cognify

Menyimpan teks terpilih, tautan, atau seluruh halaman web ke Cognify. Hanya berbicara dengan app Cognify di komputer yang sama
(`http://127.0.0.1:47615`); tidak ada server di internet. Teks antarmuka mengikuti bahasa browser (Indonesia atau Inggris).

## Memasang

1. Di Cognify: Pengaturan → Data → **Ekstensi browser** → nyalakan, lalu **Buat kode**.
2. Pasang ekstensinya (di bawah), klik ikon Cognify di toolbar, dan masukkan kode 6 angkanya.

| Browser | Cara |
|---|---|
| Chrome, Edge, Brave | Buka halaman ekstensi, nyalakan **Mode pengembang**, pilih **Muat yang belum dibuka**, dan pilih folder ini. |
| Firefox (121 ke atas) | `about:debugging` → **This Firefox** → **Load Temporary Add-on**, pilih `manifest.firefox.json`. Untuk dipakai tetap, bungkus dengan `scripts/pack-extension.sh` dan tandatangani di addons.mozilla.org. |
| Safari (macOS) | `xcrun safari-web-extension-converter extension/ --project-location <folder>`, buka proyek Xcode hasilnya, jalankan, lalu nyalakan di Safari → Pengaturan → Ekstensi. Butuh Xcode. |

## Yang bisa dilakukan

- **Teks terpilih**: klik kanan → satu item *Simpan teks terpilih ke Cognify* (judulnya berubah jadi *Jadikan catatan melayang di Cognify* bila tujuan di popup adalah Catatan melayang), atau pintasan **Alt+Shift+D**. **Alt+Shift+F** langsung membuat catatan melayang dari teks terpilih. Sorotan dari alamat yang sama menumpuk di satu catatan "Sorotan: judul".
- **Halaman**: tombol di popup, klik kanan → *Simpan halaman ini*, atau **Alt+Shift+S**. Halaman diubah jadi teks bersih di dalam browser (halaman yang butuh login ikut bisa), jadi yang dikirim hanya teksnya.
- **Tautan**: klik kanan pada tautan → *Simpan tautan ke Cognify*.
- **Tujuan dan tag**: di popup pilih *Kliping web* (otomatis), *Catatan melayang baru*, atau *Tambahkan ke halaman* yang sudah ada, dan isi tag. Pilihan terakhir dipakai juga oleh klik kanan dan pintasan.

Pintasan bisa diubah di pengaturan ekstensi browser (`chrome://extensions/shortcuts`).

## Keamanan

- Jembatan hanya jalan saat dinyalakan di Cognify. Origin selain ekstensi browser dan Host selain loopback ditolak.
- Pemasangan memakai kode 6 angka (berlaku 5 menit, sekali pakai, gugur setelah 5 kali salah). Sesudahnya ekstensi membawa kunci acak; Cognify hanya menyimpan SHA-256 dari kunci itu.
- Permission: `contextMenus`, `storage`, `activeTab`, `scripting` (membaca halaman hanya saat kamu menyimpannya), dan akses ke `127.0.0.1:47615`.

## Berkas

`manifest.json` (Chrome/Edge/Brave/Safari), `manifest.firefox.json` (Firefox: `background.scripts` dan ID Gecko), `cognify.js` (bicara dengan app, mengubah halaman jadi Markdown), `background.js` (klik kanan dan pintasan), `popup.*`, `_locales/{id,en}`.
