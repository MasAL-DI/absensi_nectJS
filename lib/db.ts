import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;

/**
 * Ganti dari getDB() di config.php (mysqli) — sekarang mengembalikan
 * client Turso (libSQL) yang di-cache antar request dalam proses yang sama.
 */
export function getDB(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error(
        'TURSO_DATABASE_URL belum diset. Salin .env.example ke .env.local dan isi kredensial Turso.'
      );
    }

    client = createClient({ url, authToken });
  }
  return client;
}
