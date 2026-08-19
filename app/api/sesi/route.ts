import { NextResponse, type NextRequest } from 'next/server';
import { getDB } from '@/lib/db';
import { cekAuth, cekAdmin } from '@/lib/auth';
import { getBody, handle } from '@/lib/api';
import { todayJakarta } from '@/lib/time';

export const runtime = 'nodejs';

// ============================================================
// GET — daftar sesi / detail sesi / daftar device
// ============================================================
export const GET = handle(async (req: NextRequest) => {
  cekAuth(req); // GET boleh viewer & admin
  const db = getDB();
  const { searchParams } = new URL(req.url);

  // Daftar semua device_id yang pernah tercatat (dari absensi & tap_sesi)
  if (searchParams.has('devices')) {
    const rows1 = await db.execute(
      `SELECT DISTINCT device_id FROM absensi WHERE device_id IS NOT NULL AND device_id != ''`
    );
    const rows2 = await db.execute(
      `SELECT DISTINCT device_id FROM tap_sesi WHERE device_id IS NOT NULL AND device_id != ''`
    );
    const all = Array.from(
      new Set([
        ...rows1.rows.map((r: any) => r.device_id),
        ...rows2.rows.map((r: any) => r.device_id),
      ])
    ).sort();
    return NextResponse.json({ devices: all });
  }

  // Detail 1 sesi + siapa saja yang sudah tap
  if (searchParams.has('id')) {
    const id = Number(searchParams.get('id'));

    const sesiRes = await db.execute({
      sql: `
        SELECT sa.*, u.nama AS dibuka_oleh_nama
        FROM sesi_absensi sa
        JOIN users u ON sa.dibuka_oleh = u.id
        WHERE sa.id = ?
      `,
      args: [id],
    });
    const sesi = sesiRes.rows[0] as any;
    if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 });

    // Device yang dipakai sesi ini
    const devRes = await db.execute({
      sql: 'SELECT device_id FROM sesi_device WHERE sesi_id = ?',
      args: [id],
    });
    const devices = devRes.rows.map((r: any) => r.device_id);

    // Siswa yang sudah tap di sesi ini
    const tapRes = await db.execute({
      sql: `
        SELECT s.nis, s.nama, s.kelas, ts.device_id, ts.waktu_tap
        FROM tap_sesi ts JOIN siswa s ON ts.siswa_id = s.id
        WHERE ts.sesi_id = ? ORDER BY ts.waktu_tap
      `,
      args: [id],
    });

    return NextResponse.json({
      ...sesi,
      devices,
      tap_list: tapRes.rows,
      total_tap: tapRes.rows.length,
    });
  }

  // Daftar sesi hari ini (aktif di atas, lalu yang sudah selesai)
  const tanggal = searchParams.get('tanggal') ?? todayJakarta();
  const listRes = await db.execute({
    sql: `
      SELECT sa.*, u.nama AS dibuka_oleh_nama,
             (SELECT COUNT(*) FROM tap_sesi WHERE sesi_id = sa.id) AS total_tap
      FROM sesi_absensi sa
      JOIN users u ON sa.dibuka_oleh = u.id
      WHERE sa.tanggal = ?
      ORDER BY (sa.status = 'aktif') DESC, sa.jam_buka DESC
    `,
    args: [tanggal],
  });

  const list = listRes.rows as any[];

  // Lampirkan device tiap sesi
  for (const s of list) {
    const devRes = await db.execute({
      sql: 'SELECT device_id FROM sesi_device WHERE sesi_id = ?',
      args: [s.id],
    });
    s.devices = devRes.rows.map((r: any) => r.device_id);
  }

  return NextResponse.json({ tanggal, data: list });
});

// ============================================================
// POST — buka sesi baru ATAU tutup sesi
// ============================================================
export const POST = handle(async (req: NextRequest) => {
  const user = cekAdmin(req); // hanya admin yang boleh buka/tutup sesi
  const body = await getBody(req);
  const db = getDB();
  const { searchParams } = new URL(req.url);

  // ── TUTUP SESI ──
  if (searchParams.has('tutup')) {
    const id = Number(body.id ?? 0);
    if (!id) return NextResponse.json({ error: 'ID sesi wajib' }, { status: 400 });

    const jamTutup = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());

    const result = await db.execute({
      sql: `UPDATE sesi_absensi SET status='selesai', jam_tutup=? WHERE id=? AND status='aktif'`,
      args: [jamTutup, id],
    });

    if (Number(result.rowsAffected) === 0) {
      return NextResponse.json({ error: 'Sesi tidak ditemukan atau sudah ditutup' }, { status: 400 });
    }

    // Lepas device dari sesi supaya kembali netral (bisa absen masuk/pulang lagi)
    await db.execute({ sql: 'DELETE FROM sesi_device WHERE sesi_id = ?', args: [id] });

    return NextResponse.json({ success: true, pesan: 'Sesi ditutup, device kembali netral' });
  }

  // ── BUKA SESI BARU ──
  const namaSesi = String(body.nama_sesi ?? '').trim();
  const devices: string[] = Array.isArray(body.devices) ? body.devices : [];

  if (!namaSesi) return NextResponse.json({ error: 'Nama sesi wajib' }, { status: 400 });
  if (!devices.length) return NextResponse.json({ error: 'Pilih minimal 1 device' }, { status: 400 });

  // Cek apakah ada device yang sudah dipakai sesi aktif lain
  const devicesBentrok: string[] = [];
  for (const devRaw of devices) {
    const dev = String(devRaw).trim();
    const bentrokRes = await db.execute({
      sql: `
        SELECT sa.nama_sesi FROM sesi_device sd
        JOIN sesi_absensi sa ON sd.sesi_id = sa.id
        WHERE sd.device_id = ? AND sa.status = 'aktif'
      `,
      args: [dev],
    });
    const bentrok = bentrokRes.rows[0] as any;
    if (bentrok) devicesBentrok.push(`${dev} (sedang dipakai sesi '${bentrok.nama_sesi}')`);
  }

  if (devicesBentrok.length) {
    return NextResponse.json(
      { error: 'Device berikut sedang dipakai sesi lain: ' + devicesBentrok.join(', ') },
      { status: 400 }
    );
  }

  // Buat sesi
  const tanggal = todayJakarta();
  const jamBuka = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());

  const insertRes = await db.execute({
    sql: `
      INSERT INTO sesi_absensi (nama_sesi, tanggal, dibuka_oleh, jam_buka, status)
      VALUES (?, ?, ?, ?, 'aktif')
    `,
    args: [namaSesi, tanggal, user.id, jamBuka],
  });
  const sesiId = Number(insertRes.lastInsertRowid);

  // Daftarkan device ke sesi ini
  for (const devRaw of devices) {
    const dev = String(devRaw).trim();
    await db.execute({
      sql: 'INSERT INTO sesi_device (sesi_id, device_id) VALUES (?, ?)',
      args: [sesiId, dev],
    });
  }

  return NextResponse.json({
    success: true,
    id: sesiId,
    nama_sesi: namaSesi,
    devices,
    pesan: `Sesi '${namaSesi}' dibuka. Device siap dipakai: ${devices.join(', ')}`,
  });
});
