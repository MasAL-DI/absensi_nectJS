import { NextResponse, type NextRequest } from 'next/server';
import { getDB } from '@/lib/db';
import { cekAuth } from '@/lib/auth';
import { getBody, handle } from '@/lib/api';
import { todayJakarta, datetimeJakarta } from '@/lib/time';

export const runtime = 'nodejs';

// GET — daftar izin keluar hari ini
export const GET = handle(async (req: NextRequest) => {
  cekAuth(req);

  const { searchParams } = new URL(req.url);
  const tanggal = searchParams.get('tanggal') ?? todayJakarta();

  const db = getDB();
  const result = await db.execute({
    sql: `
      SELECT
        ik.id,
        s.nis, s.nama, s.kelas,
        ik.alasan,
        ik.jam_keluar, ik.jam_kembali,
        ik.status,
        ik.created_at,
        u.nama AS dibuka_oleh_nama
      FROM izin_keluar ik
      JOIN siswa s ON ik.siswa_id = s.id
      JOIN users  u ON ik.dibuka_oleh = u.id
      WHERE ik.tanggal = ?
      ORDER BY ik.created_at DESC
    `,
    args: [tanggal],
  });

  return NextResponse.json({ tanggal, data: result.rows });
});

// POST — buka sesi izin keluar / batalkan (?batalkan)
export const POST = handle(async (req: NextRequest) => {
  const user = cekAuth(req);
  const body = await getBody(req);
  const { searchParams } = new URL(req.url);

  const db = getDB();

  // Batalkan izin
  if (searchParams.has('batalkan')) {
    const id = Number(body.id ?? 0);
    if (!id) return NextResponse.json({ error: 'ID izin wajib' }, { status: 400 });

    await db.execute({
      sql: `UPDATE izin_keluar SET status = 'expired', updated_at = ? WHERE id = ?`,
      args: [datetimeJakarta(), id],
    });

    return NextResponse.json({ success: true, pesan: 'Izin dibatalkan' });
  }

  // Buka izin baru
  const siswaId = Number(body.siswa_id ?? 0);
  const alasan = String(body.alasan ?? '').trim();

  if (!siswaId) return NextResponse.json({ error: 'siswa_id wajib' }, { status: 400 });

  const tanggal = todayJakarta();

  // Cek siswa ada
  const siswaRes = await db.execute({
    sql: 'SELECT id, nama, kelas FROM siswa WHERE id = ? AND aktif = 1',
    args: [siswaId],
  });
  const siswa = siswaRes.rows[0] as any;
  if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 });

  // Cek sudah ada izin aktif
  const existingRes = await db.execute({
    sql: `
      SELECT id FROM izin_keluar
      WHERE siswa_id = ? AND tanggal = ? AND status IN ('menunggu','keluar')
    `,
    args: [siswaId, tanggal],
  });
  if (existingRes.rows[0]) {
    return NextResponse.json({ error: 'Siswa sudah memiliki izin keluar aktif' }, { status: 400 });
  }

  // Cek siswa sudah tap masuk hari ini
  const sudahMasukRes = await db.execute({
    sql: 'SELECT id FROM absensi WHERE siswa_id = ? AND tanggal = ? AND waktu_masuk IS NOT NULL',
    args: [siswaId, tanggal],
  });
  if (!sudahMasukRes.rows[0]) {
    return NextResponse.json({ error: 'Siswa belum tap masuk hari ini' }, { status: 400 });
  }

  // Buat izin
  const insertRes = await db.execute({
    sql: `
      INSERT INTO izin_keluar (siswa_id, tanggal, dibuka_oleh, alasan, status)
      VALUES (?, ?, ?, ?, 'menunggu')
    `,
    args: [siswaId, tanggal, user.id, alasan || null],
  });

  return NextResponse.json({
    success: true,
    id: Number(insertRes.lastInsertRowid),
    nama: siswa.nama,
    kelas: siswa.kelas,
    pesan: 'Sesi izin keluar dibuka. Siswa bisa tap kartu di gerbang.',
    status: 'menunggu',
  });
});
