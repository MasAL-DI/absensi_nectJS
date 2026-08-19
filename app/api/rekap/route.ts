import { NextResponse, type NextRequest } from 'next/server';
import type { InValue } from '@libsql/client';
import { getDB } from '@/lib/db';
import { cekAuth } from '@/lib/auth';
import { handle } from '@/lib/api';
import { todayJakarta } from '@/lib/time';
import { CsvBuilder, csvResponseHeaders } from '@/lib/csv';
import { fmtYMD, isoWeekNumber, isoWeekMonday, addDays, dayOfWeek } from '@/lib/isoweek';

export const runtime = 'nodejs';

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const NAMA_HARI_KERJA = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function jam(s: string | null | undefined): string {
  return s ? String(s).slice(0, 5) : '-';
}

export const GET = handle(async (req: NextRequest) => {
  cekAuth(req);

  const { searchParams } = new URL(req.url);
  const kelas = searchParams.get('kelas') ?? '';
  const format = searchParams.get('format') ?? 'json';
  const mode = searchParams.get('mode') ?? 'bulanan';

  if (!kelas) {
    return NextResponse.json({ error: 'Parameter kelas wajib' }, { status: 400 });
  }

  const db = getDB();

  // ══════════════════════════════════════════════════════════
  // MODE: HARIAN
  // ══════════════════════════════════════════════════════════
  if (mode === 'harian') {
    const tanggal = searchParams.get('tanggal') ?? todayJakarta();

    const result = await db.execute({
      sql: `
        SELECT
          s.nis, s.nama, s.kelas,
          a.tanggal,
          a.waktu_masuk,  a.status_masuk,
          a.waktu_pulang, a.status_pulang
        FROM siswa s
        LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = ?
        WHERE s.kelas = ? AND s.aktif = 1
        ORDER BY s.nama
      `,
      args: [tanggal, kelas],
    });
    const rows = result.rows as any[];

    if (format === 'csv') {
      const namaFile = `rekap_harian_${kelas}_${tanggal}.csv`;
      const csv = new CsvBuilder();
      csv.row([`REKAP ABSENSI HARIAN — Kelas: ${kelas} — Tanggal: ${tanggal}`]);
      csv.blank();
      csv.row(['No', 'NIS', 'Nama', 'Kelas', 'Status Masuk', 'Jam Masuk', 'Status Pulang', 'Jam Pulang']);

      let no = 1;
      let cHadir = 0;
      let cTelat = 0;
      let cAlpha = 0;
      for (const r of rows) {
        const statusM = r.status_masuk ?? 'alpha';
        const statusP = r.status_pulang ?? '-';
        if (statusM === 'hadir') cHadir++;
        else if (statusM === 'terlambat') cTelat++;
        else cAlpha++;

        csv.row([no++, r.nis, r.nama, r.kelas, statusM, jam(r.waktu_masuk), statusP, jam(r.waktu_pulang)]);
      }

      csv.blank();
      csv.row(['', '', 'TOTAL', '', `Hadir: ${cHadir}`, '', `Terlambat: ${cTelat}`, `Alpha: ${cAlpha}`]);

      return new NextResponse(csv.toString(), { headers: csvResponseHeaders(namaFile) });
    }

    return NextResponse.json({ mode: 'harian', tanggal, kelas, data: rows });
  }

  // ══════════════════════════════════════════════════════════
  // MODE: MINGGUAN
  // ══════════════════════════════════════════════════════════
  if (mode === 'mingguan') {
    const todayParts = todayJakarta().split('-').map(Number);
    const defaultMinggu = `${todayParts[0]}-W${String(
      isoWeekNumber(todayParts[0], todayParts[1], todayParts[2])
    ).padStart(2, '0')}`;
    const mingguStr = searchParams.get('minggu') ?? defaultMinggu;

    const tahun = parseInt(mingguStr.slice(0, 4), 10);
    const minggu = parseInt(mingguStr.slice(6), 10);
    const { y, m, d } = isoWeekMonday(tahun, minggu);
    const senin = fmtYMD(y, m, d);
    const sabtuParts = addDays(y, m, d, 5);
    const sabtu = fmtYMD(sabtuParts.y, sabtuParts.m, sabtuParts.d);

    const rawRes = await db.execute({
      sql: `
        SELECT
          s.nis, s.nama, s.kelas,
          a.tanggal,
          a.waktu_masuk,  a.status_masuk,
          a.waktu_pulang, a.status_pulang
        FROM siswa s
        LEFT JOIN absensi a
          ON s.id = a.siswa_id AND a.tanggal BETWEEN ? AND ?
        WHERE s.kelas = ? AND s.aktif = 1
        ORDER BY s.nama, a.tanggal
      `,
      args: [senin, sabtu, kelas],
    });
    const rawRows = rawRes.rows as any[];

    // Susun daftar 6 hari (Senin..Sabtu)
    const hariList: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = addDays(y, m, d, i);
      hariList.push(fmtYMD(p.y, p.m, p.d));
    }

    type HariEntry = { waktu_masuk: string | null; status_masuk: string | null; waktu_pulang: string | null; status_pulang: string | null };
    const siswaMap = new Map<string, { nis: string; nama: string; kelas: string; hari: Record<string, HariEntry> }>();

    for (const r of rawRows) {
      const key = r.nis;
      if (!siswaMap.has(key)) {
        const hariEmpty: Record<string, HariEntry> = {};
        for (const tgl of hariList) {
          hariEmpty[tgl] = { waktu_masuk: null, status_masuk: null, waktu_pulang: null, status_pulang: null };
        }
        siswaMap.set(key, { nis: r.nis, nama: r.nama, kelas: r.kelas, hari: hariEmpty });
      }
      if (r.tanggal) {
        siswaMap.get(key)!.hari[r.tanggal] = {
          waktu_masuk: r.waktu_masuk,
          status_masuk: r.status_masuk,
          waktu_pulang: r.waktu_pulang,
          status_pulang: r.status_pulang,
        };
      }
    }

    const rows = Array.from(siswaMap.values());

    if (format === 'csv') {
      const namaFile = `rekap_mingguan_${kelas}_${mingguStr}.csv`;
      const csv = new CsvBuilder();
      csv.row([`REKAP ABSENSI MINGGUAN — Kelas: ${kelas} — Minggu: ${mingguStr}`]);
      csv.blank();

      const header = ['No', 'NIS', 'Nama'];
      hariList.forEach((tgl, i) => {
        const [yy, mm, dd] = tgl.split('-').map(Number);
        const label = `${NAMA_HARI_KERJA[i]} ${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}`;
        header.push(`${label} — Jam Masuk`, `${label} — Jam Pulang`, `${label} — Status`);
      });
      csv.row(header);

      let no = 1;
      for (const r of rows) {
        const baris: unknown[] = [no++, r.nis, r.nama];
        for (const tgl of hariList) {
          const h = r.hari[tgl] ?? ({} as HariEntry);
          baris.push(jam(h.waktu_masuk), jam(h.waktu_pulang), h.status_masuk ?? 'alpha');
        }
        csv.row(baris);
      }

      return new NextResponse(csv.toString(), { headers: csvResponseHeaders(namaFile) });
    }

    return NextResponse.json({ mode: 'mingguan', minggu: mingguStr, senin, sabtu, kelas, hari: hariList, data: rows });
  }

  // ══════════════════════════════════════════════════════════
  // MODE: BULANAN
  // ══════════════════════════════════════════════════════════
  const bulan = searchParams.get('bulan') ?? todayJakarta().slice(0, 7);

  const ringkasanRes = await db.execute({
    sql: `
      SELECT
        s.nis, s.nama, s.kelas,
        SUM(CASE WHEN a.status_masuk='hadir'     THEN 1 ELSE 0 END) AS hadir,
        SUM(CASE WHEN a.status_masuk='terlambat' THEN 1 ELSE 0 END) AS terlambat,
        SUM(CASE WHEN a.waktu_masuk IS NULL       THEN 1 ELSE 0 END) AS alpha,
        COUNT(a.id) AS total_hadir,
        SUM(CASE WHEN a.waktu_pulang IS NOT NULL  THEN 1 ELSE 0 END) AS total_pulang
      FROM siswa s
      LEFT JOIN absensi a
        ON s.id = a.siswa_id AND strftime('%Y-%m', a.tanggal) = ?
      WHERE s.kelas = ? AND s.aktif = 1
      GROUP BY s.id ORDER BY s.nama
    `,
    args: [bulan, kelas],
  });
  const ringkasan = ringkasanRes.rows as any[];

  const detailRes = await db.execute({
    sql: `
      SELECT
        s.nis,
        a.tanggal,
        a.waktu_masuk,  a.status_masuk,
        a.waktu_pulang, a.status_pulang
      FROM siswa s
      LEFT JOIN absensi a
        ON s.id = a.siswa_id AND strftime('%Y-%m', a.tanggal) = ?
      WHERE s.kelas = ? AND s.aktif = 1 AND a.tanggal IS NOT NULL
      ORDER BY s.nama, a.tanggal
    `,
    args: [bulan, kelas],
  });
  const detailRows = detailRes.rows as any[];

  const detailMap = new Map<string, Record<string, any>>();
  for (const d of detailRows) {
    if (!detailMap.has(d.nis)) detailMap.set(d.nis, {});
    detailMap.get(d.nis)![d.tanggal] = {
      waktu_masuk: d.waktu_masuk,
      status_masuk: d.status_masuk,
      waktu_pulang: d.waktu_pulang,
      status_pulang: d.status_pulang,
    };
  }

  if (format === 'csv') {
    const namaFile = `rekap_bulanan_${kelas}_${bulan}`.replace(/[ /]/g, '_') + '.csv';
    const csv = new CsvBuilder();
    csv.row([`REKAP ABSENSI BULANAN — Kelas: ${kelas} — Bulan: ${bulan}`]);
    csv.blank();

    csv.row(['=== RINGKASAN ===']);
    csv.row(['No', 'NIS', 'Nama', 'Kelas', 'Hadir', 'Terlambat', 'Alpha', 'Total Hadir', 'Total Pulang']);

    let no = 1;
    let totalHadir = 0;
    let totalTerlambat = 0;
    let totalAlpha = 0;
    for (const r of ringkasan) {
      csv.row([
        no++,
        r.nis,
        r.nama,
        r.kelas,
        r.hadir ?? 0,
        r.terlambat ?? 0,
        r.alpha ?? 0,
        r.total_hadir ?? 0,
        r.total_pulang ?? 0,
      ]);
      totalHadir += Number(r.hadir ?? 0);
      totalTerlambat += Number(r.terlambat ?? 0);
      totalAlpha += Number(r.alpha ?? 0);
    }

    csv.blank();
    csv.row(['', '', 'TOTAL', '', totalHadir, totalTerlambat, totalAlpha, '', '']);

    csv.blank();
    csv.row(['=== DETAIL JAM MASUK & PULANG ===']);
    csv.row(['NIS', 'Nama', 'Tanggal', 'Hari', 'Status Masuk', 'Jam Masuk', 'Status Pulang', 'Jam Pulang']);

    for (const r of ringkasan) {
      const detail = detailMap.get(r.nis) ?? {};
      const tanggalKeys = Object.keys(detail).sort();
      for (const tgl of tanggalKeys) {
        const dd = detail[tgl];
        const [yy, mm, ddNum] = tgl.split('-').map(Number);
        const hariIdx = dayOfWeek(yy, mm, ddNum);
        csv.row([
          r.nis,
          r.nama,
          `${String(ddNum).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yy}`,
          NAMA_HARI[hariIdx],
          dd.status_masuk ?? '-',
          jam(dd.waktu_masuk),
          dd.status_pulang ?? '-',
          jam(dd.waktu_pulang),
        ]);
      }
    }

    return new NextResponse(csv.toString(), { headers: csvResponseHeaders(namaFile) });
  }

  return NextResponse.json({ mode: 'bulanan', kelas, bulan, data: ringkasan });
});
