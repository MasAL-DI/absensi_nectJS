import crypto from 'crypto';
import type { NextRequest } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_absensi_smkn1pabelan';

export type AuthUser = {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
  exp?: number;
  [key: string]: unknown;
};

/** Error terkontrol yang membawa status HTTP, dipakai oleh route handler. */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function b64(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/=+$/, '');
}

/** Setara buatToken() di config.php: header.payload.sig, base64 (bukan base64url), '=' dibuang. */
export function buatToken(payload: Record<string, unknown>): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=+$/, '');
  return `${header}.${body}.${sig}`;
}

/** Setara verifikasiToken() di config.php. */
export function verifikasiToken(token: string): AuthUser | false {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, payload, sig] = parts;

  const validSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=+$/, '');
  if (sig !== validSig) return false;

  let data: AuthUser;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return false;
  }

  if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return false;
  return data;
}

/** Setara cekAuth() di config.php. Lempar AuthError kalau tidak valid. */
export function cekAuth(req: NextRequest): AuthUser {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  const user = verifikasiToken(token);
  if (!user) throw new AuthError('Token tidak valid atau kadaluarsa', 401);
  return user;
}

/** Setara cekAdmin() di config.php. */
export function cekAdmin(req: NextRequest): AuthUser {
  const user = cekAuth(req);
  if (user.role !== 'admin') {
    throw new AuthError('Akses ditolak. Hanya admin yang boleh melakukan ini.', 403);
  }
  return user;
}
