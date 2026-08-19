-- =====================================================
-- STRUKTUR DATABASE SISTEM ABSENSI RFID
-- Versi Turso / libSQL (SQLite dialect)
-- Dikonversi dari struktur_database_absensi.sql (MySQL)
--
-- Catatan konversi:
--  * AUTO_INCREMENT       -> INTEGER PRIMARY KEY AUTOINCREMENT
--  * ENUM(...)            -> TEXT + CHECK (col IN (...))
--  * TIME / DATE          -> TEXT (disimpan sebagai 'YYYY-MM-DD' / 'HH:MM:SS',
--                             persis format yang dihasilkan PHP date() dulu)
--  * TIMESTAMP ... ON UPDATE CURRENT_TIMESTAMP -> tidak didukung SQLite,
--    jadi kolom updated_at di-set eksplisit oleh kode aplikasi (lib/time.ts)
--    setiap kali melakukan UPDATE, sama seperti query PHP lama yang selalu
--    menulis "updated_at = NOW()" secara eksplisit.
-- =====================================================

PRAGMA foreign_keys = ON;

-- =====================================================
-- TABEL: users
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  nama       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer')),
  aktif      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TABEL: siswa
-- =====================================================
CREATE TABLE IF NOT EXISTS siswa (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nis        TEXT NOT NULL UNIQUE,
  nama       TEXT NOT NULL,
  kelas      TEXT NOT NULL,
  jk         TEXT NOT NULL DEFAULT 'L' CHECK (jk IN ('L','P')),
  uid_rfid   TEXT UNIQUE,
  hp_ortu    TEXT,
  aktif      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TABEL: jadwal
-- =====================================================
CREATE TABLE IF NOT EXISTS jadwal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hari        TEXT NOT NULL UNIQUE CHECK (hari IN ('Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu')),
  batas_telat TEXT NOT NULL DEFAULT '07:30:00',
  jam_pulang  TEXT NOT NULL DEFAULT '15:00:00'
);

-- =====================================================
-- TABEL: absensi
-- =====================================================
CREATE TABLE IF NOT EXISTS absensi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id      INTEGER NOT NULL,
  kelas         TEXT NOT NULL,
  tanggal       TEXT NOT NULL,
  waktu_masuk   TEXT,
  status_masuk  TEXT CHECK (status_masuk IN ('hadir','terlambat')),
  waktu_pulang  TEXT,
  status_pulang TEXT CHECK (status_pulang IN ('lebih_awal','tepat_waktu')),
  uid_rfid      TEXT,
  device_id     TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (siswa_id, tanggal),
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON absensi(tanggal);

-- =====================================================
-- TABEL: izin_keluar
-- =====================================================
CREATE TABLE IF NOT EXISTS izin_keluar (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id    INTEGER NOT NULL,
  tanggal     TEXT NOT NULL,
  dibuka_oleh INTEGER NOT NULL,
  alasan      TEXT,
  jam_keluar  TEXT,
  jam_kembali TEXT,
  status      TEXT NOT NULL DEFAULT 'menunggu'
              CHECK (status IN ('menunggu','keluar','kembali','selesai_tanpa_kembali','expired')),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE,
  FOREIGN KEY (dibuka_oleh) REFERENCES users(id)
);

-- =====================================================
-- TABEL: sesi_absensi
-- =====================================================
CREATE TABLE IF NOT EXISTS sesi_absensi (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_sesi   TEXT NOT NULL,
  tanggal     TEXT NOT NULL,
  dibuka_oleh INTEGER NOT NULL,
  jam_buka    TEXT NOT NULL,
  jam_tutup   TEXT,
  status      TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','selesai')),
  FOREIGN KEY (dibuka_oleh) REFERENCES users(id)
);

-- =====================================================
-- TABEL: sesi_device
-- =====================================================
CREATE TABLE IF NOT EXISTS sesi_device (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id   INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  FOREIGN KEY (sesi_id) REFERENCES sesi_absensi(id) ON DELETE CASCADE
);

-- =====================================================
-- TABEL: tap_sesi
-- =====================================================
CREATE TABLE IF NOT EXISTS tap_sesi (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id   INTEGER NOT NULL,
  siswa_id  INTEGER NOT NULL,
  device_id TEXT,
  waktu_tap TEXT NOT NULL,
  FOREIGN KEY (sesi_id) REFERENCES sesi_absensi(id) ON DELETE CASCADE,
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE
);

-- =====================================================
-- TABEL: device_perpus
-- =====================================================
CREATE TABLE IF NOT EXISTS device_perpus (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL UNIQUE
);

-- =====================================================
-- TABEL: tap_perpus_pending
-- =====================================================
CREATE TABLE IF NOT EXISTS tap_perpus_pending (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id  INTEGER NOT NULL,
  device_id TEXT,
  waktu_tap TEXT NOT NULL,
  selesai   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE
);

-- =====================================================
-- TABEL: peminjaman_buku
-- =====================================================
CREATE TABLE IF NOT EXISTS peminjaman_buku (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id        INTEGER NOT NULL,
  judul_buku      TEXT NOT NULL,
  device_id       TEXT,
  tanggal_pinjam  TEXT NOT NULL,
  tanggal_kembali TEXT,
  status          TEXT NOT NULL DEFAULT 'dipinjam' CHECK (status IN ('dipinjam','dikembalikan')),
  dicatat_oleh    INTEGER NOT NULL,
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE,
  FOREIGN KEY (dicatat_oleh) REFERENCES users(id)
);

-- =====================================================
-- DATA AWAL: jadwal default Senin-Sabtu
-- =====================================================
INSERT OR IGNORE INTO jadwal (hari, batas_telat, jam_pulang) VALUES
('Senin',  '07:30:00', '15:00:00'),
('Selasa', '07:30:00', '15:00:00'),
('Rabu',   '07:30:00', '15:00:00'),
('Kamis',  '07:30:00', '15:00:00'),
('Jumat',  '07:30:00', '11:30:00'),
('Sabtu',  '07:30:00', '12:00:00');

-- =====================================================
-- DATA AWAL: 1 akun admin default
-- Username: admin | Password: admin123
-- PENTING: segera ganti password ini setelah login pertama kali!
-- (hash bcrypt di bawah kompatibel dengan bcryptjs)
-- =====================================================
INSERT OR IGNORE INTO users (username, password, nama, role, aktif) VALUES
('admin', '$2b$10$1PTaBN8hcRRi1i7/oTZll.do6Fidrx1OIq4w2yAxMEaSXDuZZCP1O', 'Administrator', 'admin', 1);
