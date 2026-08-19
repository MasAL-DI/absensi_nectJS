import { NextResponse, type NextRequest } from 'next/server';
import type { InValue } from '@libsql/client';
import { getDB } from '@/lib/db';
import { cekAuth, cekAdmin } from '@/lib/auth';
import { getBody, handle, methodNotAllowed } from '@/lib/api';

export const runtime = 'nodejs';

export const GET = handle(async (req: NextRequest) => {
  cekAuth(req); // viewer & admin boleh lihat data siswa

  const { searchParams } = new URL(req.url);
  const kelas = searchParams.get('kelas') ?? '';

  const db = getDB();
  let query = 'SELECT id,nis,nama,kelas,jk,uid_rfid,hp_ortu FROM siswa WHERE aktif=1';
  const args: InValue[] = [];
  if (kelas) {
    query += ' AND kelas=?';
    args.push(kelas);
  }
  query += ' ORDER BY kelas, nama';

  const result = await db.execute({ sql: query, args });
  return NextResponse.json(result.rows);
});

export const POST = handle(async (req: NextRequest) => {
  cekAdmin(req);
  const body = await getBody(req);

  const nis = String(body.nis ?? '').trim();
  const nama = String(body.nama ?? '').trim();
  const kelas = String(body.kelas ?? '').trim();
  const jk = String(body.jk ?? 'L').trim();
  const uid = String(body.uid_rfid ?? '').trim();
  const hp = String(body.hp_ortu ?? '').trim();

  if (!nis || !nama || !kelas) {
    return NextResponse.json({ error: 'NIS, nama, kelas wajib' }, { status: 400 });
  }

  // PENTING: kalau UID kosong, harus disimpan sebagai NULL (bukan string ""),
  // karena kolom uid_rfid itu UNIQUE. String kosong berulang akan bentrok.
  const uidParam = uid !== '' ? uid : null;

  const db = getDB();

  // ===== CEK UID SUDAH DIPAKAI SISWA LAIN =====
  if (uid) {
    const dupRes = await db.execute({
      sql: 'SELECT nis, nama FROM siswa WHERE uid_rfid = ? AND nis != ? AND aktif = 1',
      args: [uid, nis],
    });
    const dup = dupRes.rows[0] as any;
    if (dup) {
      return NextResponse.json(
        { error: `UID '${uid}' sudah dipakai siswa lain: ${dup.nama} (NIS: ${dup.nis})` },
        { status: 400 }
      );
    }
  }
  // ===== END CEK UID =====

  // SQLite tidak punya "ON DUPLICATE KEY UPDATE" dengan VALUES(), tapi punya
  // "ON CONFLICT ... DO UPDATE SET" yang setara. Konflik dicek lewat kolom
  // UNIQUE `nis`, sama seperti versi MySQL.
  await db.execute({
    sql: `
      INSERT INTO siswa (nis, nama, kelas, jk, uid_rfid, hp_ortu)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (nis) DO UPDATE SET
        nama = excluded.nama,
        kelas = excluded.kelas,
        jk = excluded.jk,
        uid_rfid = COALESCE(excluded.uid_rfid, siswa.uid_rfid),
        hp_ortu = excluded.hp_ortu
    `,
    args: [nis, nama, kelas, jk, uidParam, hp || null],
  });

  return NextResponse.json({ success: true, pesan: 'Siswa berhasil disimpan' });
});

export async function DELETE() {
  return methodNotAllowed();
}
