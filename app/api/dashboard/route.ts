import { NextResponse, type NextRequest } from 'next/server';
import { getDB } from '@/lib/db';
import { cekAuth } from '@/lib/auth';
import { handle } from '@/lib/api';
import { todayJakarta } from '@/lib/time';

export const runtime = 'nodejs';

export const GET = handle(async (req: NextRequest) => {
  cekAuth(req);

  const db = getDB();
  const tanggal = todayJakarta();

  // Statistik kehadiran
  const statsRes = await db.execute({
    sql: `
      SELECT
        COUNT(DISTINCT s.id) AS total_siswa,
        SUM(CASE WHEN a.status_masuk='hadir'     THEN 1 ELSE 0 END) AS hadir,
        SUM(CASE WHEN a.status_masuk='terlambat' THEN 1 ELSE 0 END) AS terlambat,
        SUM(CASE WHEN a.waktu_masuk IS NULL       THEN 1 ELSE 0 END) AS alpha,
        SUM(CASE WHEN a.waktu_pulang IS NOT NULL  THEN 1 ELSE 0 END) AS sudah_pulang,
        SUM(CASE WHEN a.waktu_masuk IS NOT NULL
                  AND a.waktu_pulang IS NULL       THEN 1 ELSE 0 END) AS masih_di_sekolah
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = ?
      WHERE s.aktif = 1
    `,
    args: [tanggal],
  });
  const stats = statsRes.rows[0];

  // Rekap per kelas
  const perKelasRes = await db.execute({
    sql: `
      SELECT
        s.kelas,
        COUNT(s.id) AS total_siswa,
        SUM(CASE WHEN a.status_masuk='hadir'     THEN 1 ELSE 0 END) AS hadir,
        SUM(CASE WHEN a.status_masuk='terlambat' THEN 1 ELSE 0 END) AS terlambat,
        SUM(CASE WHEN a.waktu_masuk IS NULL       THEN 1 ELSE 0 END) AS alpha
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = ?
      WHERE s.aktif = 1
      GROUP BY s.kelas ORDER BY s.kelas
    `,
    args: [tanggal],
  });

  // 10 tap terakhir
  const scanRes = await db.execute({
    sql: `
      SELECT s.nama, s.kelas, a.waktu_masuk, a.waktu_pulang, a.status_masuk, a.updated_at
      FROM absensi a JOIN siswa s ON a.siswa_id = s.id
      WHERE a.tanggal = ?
      ORDER BY a.updated_at DESC LIMIT 10
    `,
    args: [tanggal],
  });

  // Izin keluar aktif (menunggu tap atau sedang keluar)
  const izinRes = await db.execute({
    sql: `
      SELECT ik.id, s.nama, s.kelas, ik.alasan, ik.jam_keluar, ik.status, ik.created_at
      FROM izin_keluar ik JOIN siswa s ON ik.siswa_id = s.id
      WHERE ik.tanggal = ? AND ik.status IN ('menunggu','keluar')
      ORDER BY ik.created_at DESC
    `,
    args: [tanggal],
  });

  return NextResponse.json({
    tanggal,
    stats,
    perKelas: perKelasRes.rows,
    scanTerakhir: scanRes.rows,
    izinAktif: izinRes.rows,
  });
});
