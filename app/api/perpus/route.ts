import { NextResponse, type NextRequest } from 'next/server';
import { getDB } from '@/lib/db';
import { cekAuth, cekAdmin } from '@/lib/auth';
import { getBody, handle } from '@/lib/api';
import { todayJakarta } from '@/lib/time';

export const runtime = 'nodejs';

// ============================================================
// GET
// ============================================================
export const GET = handle(async (req: NextRequest) => {
  cekAuth(req); // GET boleh viewer & admin
  const db = getDB();
  const { searchParams } = new URL(req.url);

  // Riwayat yang sudah dikembalikan
  if (searchParams.has('riwayat')) {
    const result = await db.execute(`
      SELECT pb.*, s.nis, s.nama, s.kelas, u.nama AS dicatat_oleh_nama
      FROM peminjaman_buku pb
      JOIN siswa s ON pb.siswa_id = s.id
      JOIN users u ON pb.dicatat_oleh = u.id
      WHERE pb.status = 'dikembalikan'
      ORDER BY pb.tanggal_kembali DESC LIMIT 100
    `);
    return NextResponse.json({ data: result.rows });
  }

  // Buku yang sedang dipinjam siswa tertentu
  if (searchParams.has('siswa_id')) {
    const sid = Number(searchParams.get('siswa_id'));
    const result = await db.execute({
      sql: `
        SELECT pb.* FROM peminjaman_buku pb
        WHERE pb.siswa_id = ? AND pb.status = 'dipinjam'
        ORDER BY pb.tanggal_pinjam DESC
      `,
      args: [sid],
    });
    return NextResponse.json({ data: result.rows });
  }

  // Default: tap yang menunggu diisi judul + daftar sedang dipinjam
  const pendingRes = await db.execute(`
    SELECT tp.id AS tap_id, tp.waktu_tap, tp.device_id,
           s.id AS siswa_id, s.nis, s.nama, s.kelas
    FROM tap_perpus_pending tp
    JOIN siswa s ON tp.siswa_id = s.id
    WHERE tp.selesai = 0
    ORDER BY tp.waktu_tap DESC
  `);

  const dipinjamRes = await db.execute(`
    SELECT pb.*, s.nis, s.nama, s.kelas
    FROM peminjaman_buku pb
    JOIN siswa s ON pb.siswa_id = s.id
    WHERE pb.status = 'dipinjam'
    ORDER BY pb.tanggal_pinjam DESC
  `);

  return NextResponse.json({ pending: pendingRes.rows, dipinjam: dipinjamRes.rows });
});

// ============================================================
// POST — catat peminjaman ATAU tandai kembali
// ============================================================
export const POST = handle(async (req: NextRequest) => {
  const user = cekAdmin(req); // hanya admin/petugas yang boleh input judul & tandai kembali
  const body = await getBody(req);
  const db = getDB();
  const { searchParams } = new URL(req.url);

  // ── TANDAI DIKEMBALIKAN ──
  if (searchParams.has('kembali')) {
    const id = Number(body.id ?? 0);
    if (!id) return NextResponse.json({ error: 'ID peminjaman wajib' }, { status: 400 });

    const tglKembali = todayJakarta();
    const result = await db.execute({
      sql: `UPDATE peminjaman_buku SET status='dikembalikan', tanggal_kembali=? WHERE id=? AND status='dipinjam'`,
      args: [tglKembali, id],
    });

    if (Number(result.rowsAffected) === 0) {
      return NextResponse.json({ error: 'Data tidak ditemukan atau sudah dikembalikan' }, { status: 400 });
    }
    return NextResponse.json({ success: true, pesan: 'Buku ditandai sudah dikembalikan' });
  }

  // ── CATAT PEMINJAMAN BARU (dari tap pending) ──
  const tapId = Number(body.tap_id ?? 0);
  const judulBuku = String(body.judul_buku ?? '').trim();

  if (!tapId) return NextResponse.json({ error: 'tap_id wajib' }, { status: 400 });
  if (!judulBuku) return NextResponse.json({ error: 'Judul buku wajib diisi' }, { status: 400 });

  // Ambil data tap pending
  const tapRes = await db.execute({
    sql: 'SELECT * FROM tap_perpus_pending WHERE id = ? AND selesai = 0',
    args: [tapId],
  });
  const tap = tapRes.rows[0] as any;
  if (!tap) {
    return NextResponse.json({ error: 'Tap tidak ditemukan atau sudah diproses' }, { status: 404 });
  }

  // Simpan peminjaman
  const tglPinjam = todayJakarta();
  const insertRes = await db.execute({
    sql: `
      INSERT INTO peminjaman_buku (siswa_id, judul_buku, device_id, tanggal_pinjam, status, dicatat_oleh)
      VALUES (?, ?, ?, ?, 'dipinjam', ?)
    `,
    args: [tap.siswa_id, judulBuku, tap.device_id, tglPinjam, user.id],
  });
  const peminjamanId = Number(insertRes.lastInsertRowid);

  // Tandai tap sebagai selesai diproses
  await db.execute({
    sql: 'UPDATE tap_perpus_pending SET selesai = 1 WHERE id = ?',
    args: [tapId],
  });

  return NextResponse.json({
    success: true,
    id: peminjamanId,
    pesan: `Peminjaman '${judulBuku}' tercatat`,
  });
});
