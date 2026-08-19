import { NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { handle } from '@/lib/api';
import { todayJakarta } from '@/lib/time';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const db = getDB();
  const tanggal = todayJakarta();

  const statsRes = await db.execute({
    sql: `
      SELECT
        COUNT(DISTINCT s.id) AS total_siswa,
        SUM(CASE WHEN a.status_masuk='hadir'     THEN 1 ELSE 0 END) AS hadir,
        SUM(CASE WHEN a.status_masuk='terlambat' THEN 1 ELSE 0 END) AS terlambat,
        SUM(CASE WHEN a.waktu_masuk IS NULL       THEN 1 ELSE 0 END) AS alpha,
        SUM(CASE WHEN a.waktu_pulang IS NOT NULL  THEN 1 ELSE 0 END) AS sudah_pulang
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = ?
      WHERE s.aktif = 1
    `,
    args: [tanggal],
  });

  // Rekap per kelas — HANYA angka, TIDAK ADA nama siswa
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

  return NextResponse.json({
    tanggal,
    stats: statsRes.rows[0],
    perKelas: perKelasRes.rows,
  });
});
