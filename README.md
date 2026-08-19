# Absensi RFID — Next.js + Turso

Migrasi dari backend PHP (mysqli + Byet/GoogieHost) ke **Next.js 14 (App Router)**
dengan database **Turso (libSQL / SQLite)**. Frontend (`dashboard.html`) tetap
dipakai apa adanya — hanya endpoint API-nya yang diarahkan ulang ke `/api/*`.

## Pemetaan file lama → baru

| PHP lama            | Next.js baru                          |
|----------------------|----------------------------------------|
| `config.php`          | `lib/db.ts`, `lib/auth.ts`, `lib/time.ts`, `middleware.ts` |
| `index.php`           | `app/page.tsx` (redirect ke `/dashboard.html`) |
| `login.php`           | `app/api/login/route.ts` |
| `absensi.php`         | `app/api/absensi/route.ts` |
| `dashboard.php`       | `app/api/dashboard/route.ts` |
| `publik.php`          | `app/api/publik/route.ts` |
| `izin_keluar.php`     | `app/api/izin_keluar/route.ts` |
| `perpus.php`          | `app/api/perpus/route.ts` |
| `sesi.php`            | `app/api/sesi/route.ts` |
| `siswa.php`           | `app/api/siswa/route.ts` |
| `rekap.php`           | `app/api/rekap/route.ts` |
| `struktur_database_absensi.sql` (MySQL) | `schema.sql` (SQLite/Turso) |
| `dashboard.html`      | `public/dashboard.html` (sama persis, hanya `API` base & ekstensi `.php` diubah) |

Semua endpoint sekarang **tanpa** akhiran `.php`, mis. `/api/login`,
`/api/absensi`, `/api/rekap?...`. CORS, JWT (HMAC SHA-256), dan alur bisnis
(rate limiting 10 detik, sesi khusus, izin keluar, tap perpus, dsb.) dipertahankan
identik dengan versi PHP.

## 1. Siapkan database Turso

```bash
# install Turso CLI kalau belum ada: https://docs.turso.tech/cli/installation
turso auth login
turso db create absensi
turso db tokens create absensi
```

Catat `Database URL` (bentuknya `libsql://absensi-xxxx.turso.io`) dan token yang
dihasilkan.

## 2. Konfigurasi environment

```bash
cp .env.example .env.local
```

Isi `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, dan (opsional) `JWT_SECRET` /
`ALLOWED_ORIGINS` di `.env.local`.

## 3. Install dependency & terapkan skema

```bash
npm install
node --env-file=.env.local scripts/seed.mjs
```

Ini akan membuat semua tabel (`users`, `siswa`, `absensi`, `izin_keluar`,
`sesi_absensi`, dst.) plus data awal: jadwal Senin–Sabtu dan 1 akun admin
(`admin` / `admin123` — **segera ganti passwordnya**).

## 4. Jalankan secara lokal

```bash
npm run dev
```

Buka `http://localhost:3000` — otomatis redirect ke `/dashboard.html`.

## 5. Deploy

Project ini adalah aplikasi Next.js standar, jadi bisa dideploy ke Vercel,
Railway, atau platform Node lain:

```bash
npm run build
npm start
```

Pastikan environment variable `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`JWT_SECRET`, dan `ALLOWED_ORIGINS` diisi di platform deploy-mu. Update juga
firmware ESP32 supaya menembak `https://domainmu/api/absensi` (tanpa `.php`).

## Catatan perbedaan teknis dari versi PHP

- **Password hashing**: memakai `bcryptjs` di Node, kompatibel dengan hash
  `$2b$...` yang dulu dibuat `password_hash()` PHP — tidak perlu reset password
  admin lama.
- **Token login**: format `header.payload.signature` (base64, HMAC-SHA256)
  dibuat ulang manual di `lib/auth.ts` supaya identik dengan `config.php`,
  jadi token lama/baru saling kompatibel selama `JWT_SECRET` sama.
- **Zona waktu**: MySQL/PHP dulu mengandalkan `date_default_timezone_set('Asia/Jakarta')`
  dan kolom `TIMESTAMP ... ON UPDATE CURRENT_TIMESTAMP`. SQLite/Turso tidak
  punya opsi timezone atau auto-update, jadi `lib/time.ts` menghasilkan
  string waktu Asia/Jakarta secara eksplisit dan setiap `UPDATE` menuliskan
  `updated_at` secara manual (persis seperti query PHP lama yang juga selalu
  menulis `updated_at = NOW()` secara eksplisit).
- **`ON DUPLICATE KEY UPDATE`** (MySQL) diganti `ON CONFLICT (nis) DO UPDATE SET`
  (SQLite) di `app/api/siswa/route.ts` — perilakunya sama: kalau NIS sudah ada,
  datanya di-update; kalau `uid_rfid` baru kosong, UID lama dipertahankan.
- **CSV export** (`rekap.php?format=csv`) ditulis ulang dengan helper kecil
  di `lib/csv.ts` yang meniru `fputcsv()` PHP (quoting, BOM UTF-8, pemisah
  `\r\n`), supaya file yang diunduh identik.
- **CORS**: logika origin whitelist dipindah ke `middleware.ts` (jalan di
  Edge sebelum request masuk ke route handler manapun), sama seperti blok
  CORS paling atas di `config.php`.
