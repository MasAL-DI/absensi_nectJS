import { NextResponse, type NextRequest } from 'next/server';
import type { InValue } from '@libsql/client';
import { getDB } from '@/lib/db';
import { cekAuth } from '@/lib/auth';
import { getBody, handle } from '@/lib/api';
import {
  todayJakarta,
  timeJakarta,
  datetimeJakarta,
  hariJakarta,
  jakartaStringToEpochSeconds,
  nowEpochSeconds,
} from '@/lib/time';

export const runtime = 'nodejs';

// POST — dari ESP32
export const POST = handle(async (req: NextRequest) => {
  const body = await getBody(req);
  const uid = String(body.uid ?? '').trim();
  const kelasEsp = String(body.kelas ?? '').trim(); // kelas dari ESP32
  const deviceId = String(body.device_id ?? '').trim(); // ID perangkat (opsional, untuk log)

  if (!uid) {
    return NextResponse.json({ status: 'error', pesan: 'UID wajib' }, { status: 400 });
  }

  const db = getDB();

  const siswaRes = await db.execute({
    sql: 'SELECT * FROM siswa WHERE uid_rfid = ? AND aktif = 1',
    args: [uid],
  });
  const siswa = siswaRes.rows[0] as any;

  if (!siswa) {
    return NextResponse.json({ status: 'tidak_terdaftar', pesan: 'Kartu tidak terdaftar', uid });
  }

  // Kelas: prioritaskan dari database siswa, fallback ke ESP32
  const kelasFinal = siswa.kelas || kelasEsp;

  const tanggal = todayJakarta();
  const waktu = timeJakarta();

  // ===== CEK: APAKAH DEVICE INI DEVICE PERPUSTAKAAN PERMANEN =====
  if (deviceId) {
    const perpusRes = await db.execute({
      sql: 'SELECT 1 FROM device_perpus WHERE device_id = ?',
      args: [deviceId],
    });
    if (perpusRes.rows.length) {
      const waktuLengkap = datetimeJakarta();
      await db.execute({
        sql: 'INSERT INTO tap_perpus_pending (siswa_id, device_id, waktu_tap, selesai) VALUES (?, ?, ?, 0)',
        args: [siswa.id, deviceId, waktuLengkap],
      });

      return NextResponse.json({
        status: 'tap_perpus',
        nama: siswa.nama,
        pesan: 'Silakan tunggu, petugas akan input buku',
      });
    }
  }
  // ===== END CEK DEVICE PERPUS =====

  // ===== CEK SESI AKTIF DI DEVICE INI (dzuhur, ekskul, dll) =====
  if (deviceId) {
    const sesiRes = await db.execute({
      sql: `
        SELECT sa.id, sa.nama_sesi
        FROM sesi_device sd
        JOIN sesi_absensi sa ON sd.sesi_id = sa.id
        WHERE sd.device_id = ? AND sa.status = 'aktif'
        LIMIT 1
      `,
      args: [deviceId],
    });
    const sesiAktif = sesiRes.rows[0] as any;

    if (sesiAktif) {
      const sudahTapRes = await db.execute({
        sql: 'SELECT id FROM tap_sesi WHERE sesi_id = ? AND siswa_id = ?',
        args: [sesiAktif.id, siswa.id],
      });
      const sudahTap = sudahTapRes.rows[0];

      if (sudahTap) {
        return NextResponse.json({
          status: 'sudah_tap_sesi',
          nama: siswa.nama,
          pesan: `Sudah tercatat di sesi '${sesiAktif.nama_sesi}'`,
        });
      }

      await db.execute({
        sql: 'INSERT INTO tap_sesi (sesi_id, siswa_id, device_id, waktu_tap) VALUES (?, ?, ?, ?)',
        args: [sesiAktif.id, siswa.id, deviceId, waktu],
      });

      return NextResponse.json({
        status: 'tap_sesi',
        nama: siswa.nama,
        nama_sesi: sesiAktif.nama_sesi,
        waktu,
        pesan: `Tercatat: ${sesiAktif.nama_sesi}`,
      });
    }
  }
  // ===== END CEK SESI AKTIF =====

  // ===== RATE LIMITING: cegah tap ganda dalam 10 detik =====
  const tapTerakhirRes = await db.execute({
    sql: `
      SELECT updated_at FROM absensi
      WHERE siswa_id = ? AND tanggal = ?
      ORDER BY updated_at DESC LIMIT 1
    `,
    args: [siswa.id, tanggal],
  });
  const tapTerakhir = tapTerakhirRes.rows[0] as any;

  if (tapTerakhir) {
    const selisihDetik = nowEpochSeconds() - jakartaStringToEpochSeconds(String(tapTerakhir.updated_at));
    if (selisihDetik < 10) {
      return NextResponse.json({
        status: 'terlalu_cepat',
        nama: siswa.nama,
        pesan: 'Tap terlalu cepat, tunggu sebentar',
        tunggu: 10 - selisihDetik,
      });
    }
  }
  // ===== END RATE LIMITING =====

  // CEK: apakah ada izin keluar aktif untuk siswa ini?
  const izinRes = await db.execute({
    sql: `
      SELECT * FROM izin_keluar
      WHERE siswa_id = ? AND tanggal = ? AND status IN ('menunggu','keluar')
      ORDER BY id DESC LIMIT 1
    `,
    args: [siswa.id, tanggal],
  });
  const izin = izinRes.rows[0] as any;

  // Kalau ada izin menunggu -> ini tap keluar sementara
  if (izin && izin.status === 'menunggu') {
    await db.execute({
      sql: `UPDATE izin_keluar SET jam_keluar = ?, status = 'keluar', updated_at = ? WHERE id = ?`,
      args: [waktu, datetimeJakarta(), izin.id],
    });

    return NextResponse.json({
      status: 'izin_keluar',
      nama: siswa.nama,
      kelas: siswa.kelas,
      waktu,
      pesan: 'Silakan keluar, jangan lupa tap saat kembali',
    });
  }

  // Kalau sedang keluar -> ini tap kembali
  if (izin && izin.status === 'keluar') {
    await db.execute({
      sql: `UPDATE izin_keluar SET jam_kembali = ?, status = 'kembali', updated_at = ? WHERE id = ?`,
      args: [waktu, datetimeJakarta(), izin.id],
    });

    return NextResponse.json({
      status: 'kembali',
      nama: siswa.nama,
      kelas: siswa.kelas,
      waktu,
      pesan: 'Selamat datang kembali!',
    });
  }

  // TAP NORMAL: masuk atau pulang
  const absensiRes = await db.execute({
    sql: 'SELECT * FROM absensi WHERE siswa_id = ? AND tanggal = ?',
    args: [siswa.id, tanggal],
  });
  const absensi = absensiRes.rows[0] as any;

  // Ambil jadwal hari ini
  const hari = hariJakarta();
  const jadwalRes = await db.execute({
    sql: 'SELECT * FROM jadwal WHERE hari = ?',
    args: [hari],
  });
  const jadwal = jadwalRes.rows[0] as any;

  const batasTelat = jadwal?.batas_telat ?? '07:30:00';
  const jamPulang = jadwal?.jam_pulang ?? '15:00:00';

  // Belum ada record hari ini -> TAP MASUK
  if (!absensi) {
    const statusMasuk = waktu > batasTelat ? 'terlambat' : 'hadir';

    await db.execute({
      sql: `
        INSERT INTO absensi (siswa_id, kelas, tanggal, waktu_masuk, status_masuk, uid_rfid, device_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [siswa.id, kelasFinal, tanggal, waktu, statusMasuk, uid, deviceId || null, datetimeJakarta()],
    });

    return NextResponse.json({
      status: statusMasuk,
      tipe: 'masuk',
      nama: siswa.nama,
      kelas: kelasFinal,
      nis: siswa.nis,
      waktu,
      device_id: deviceId,
      pesan: statusMasuk === 'hadir' ? 'Selamat datang!' : 'Harap lebih tepat waktu!',
    });
  }

  // Sudah tap masuk, belum tap pulang -> TAP PULANG
  if (absensi && absensi.waktu_pulang === null) {
    const statusPulang = waktu < jamPulang ? 'lebih_awal' : 'tepat_waktu';

    await db.execute({
      sql: `UPDATE absensi SET waktu_pulang = ?, status_pulang = ?, updated_at = ? WHERE id = ?`,
      args: [waktu, statusPulang, datetimeJakarta(), absensi.id],
    });

    return NextResponse.json({
      status: statusPulang,
      tipe: 'pulang',
      nama: siswa.nama,
      kelas: siswa.kelas,
      waktu,
      pesan: statusPulang === 'tepat_waktu' ? 'Sampai jumpa!' : 'Pulang lebih awal',
    });
  }

  // Sudah tap masuk & pulang -> selesai
  return NextResponse.json({
    status: 'sudah_lengkap',
    nama: siswa.nama,
    kelas: siswa.kelas,
    pesan: 'Absensi hari ini sudah lengkap',
  });
});

// GET — rekap harian
export const GET = handle(async (req: NextRequest) => {
  cekAuth(req);

  const { searchParams } = new URL(req.url);
  const tanggal = searchParams.get('tanggal') ?? todayJakarta();
  const kelas = searchParams.get('kelas') ?? '';

  const db = getDB();

  let query = `
    SELECT s.nis, s.nama, s.kelas,
           a.waktu_masuk, a.status_masuk,
           a.waktu_pulang, a.status_pulang,
           a.tanggal
    FROM siswa s
    LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = ?
    WHERE s.aktif = 1
  `;
  const args: InValue[] = [tanggal];

  if (kelas) {
    query += ' AND s.kelas = ?';
    args.push(kelas);
  }
  query += ' ORDER BY s.kelas, s.nama';

  const result = await db.execute({ sql: query, args });

  return NextResponse.json({ tanggal, data: result.rows });
});
