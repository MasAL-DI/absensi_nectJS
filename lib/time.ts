// Pengganti `date_default_timezone_set('Asia/Jakarta')` dari config.php.
// PHP dulu memakai timezone server secara global; di Node kita harus
// eksplisit memformat setiap nilai waktu ke Asia/Jakarta (WIB, UTC+7,
// tanpa DST) di titik-titik yang sama seperti versi PHP.

const TZ = 'Asia/Jakarta';

const HARI_MAP: Record<string, string> = {
  Sunday: 'Minggu',
  Monday: 'Senin',
  Tuesday: 'Selasa',
  Wednesday: 'Rabu',
  Thursday: 'Kamis',
  Friday: 'Jumat',
  Saturday: 'Sabtu',
};

/** Setara PHP: date('Y-m-d') */
export function todayJakarta(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d); // en-CA -> YYYY-MM-DD
}

/** Setara PHP: date('H:i:s') */
export function timeJakarta(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/** Setara PHP: date('Y-m-d H:i:s') */
export function datetimeJakarta(d: Date = new Date()): string {
  return `${todayJakarta(d)} ${timeJakarta(d)}`;
}

/** Setara PHP: ['Minggu',...][date('w')] */
export function hariJakarta(d: Date = new Date()): string {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
  }).format(d);
  return HARI_MAP[weekday] ?? 'Senin';
}

/**
 * Konversi string 'YYYY-MM-DD HH:MM:SS' (dianggap waktu lokal Asia/Jakarta,
 * UTC+7) menjadi epoch detik. Dipakai untuk hitung selisih waktu, setara
 * PHP: time() - strtotime($kolom_datetime_lokal)
 */
export function jakartaStringToEpochSeconds(s: string): number {
  const iso = s.replace(' ', 'T') + '+07:00';
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
