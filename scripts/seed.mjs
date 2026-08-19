// Jalankan: npm run seed
// Menerapkan schema.sql (struktur tabel + data awal jadwal & admin) ke database Turso.
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error('TURSO_DATABASE_URL belum diset. Isi file .env.local terlebih dahulu, lalu jalankan:');
  console.error('  node --env-file=.env.local scripts/seed.mjs');
  process.exit(1);
}

const client = createClient({ url, authToken });

const sql = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// Pisah per statement (schema.sql tidak memakai ';' di dalam string literal apa pun)
const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith('--'));

for (const stmt of statements) {
  await client.execute(stmt);
}

console.log(`Selesai. ${statements.length} statement dijalankan ke ${url}`);
process.exit(0);
