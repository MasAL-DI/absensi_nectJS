import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDB } from '@/lib/db';
import { buatToken } from '@/lib/auth';
import { getBody, handle, methodNotAllowed } from '@/lib/api';

export const runtime = 'nodejs';

export const POST = handle(async (req: NextRequest) => {
  const body = await getBody(req);
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '').trim();

  if (!username || !password) {
    return NextResponse.json({ error: 'Username dan password wajib' }, { status: 400 });
  }

  const db = getDB();
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE username = ? AND aktif = 1',
    args: [username],
  });
  const user = result.rows[0] as any;

  if (!user || !(await bcrypt.compare(password, String(user.password)))) {
    return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 });
  }

  const token = buatToken({
    id: Number(user.id),
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 8 * 3600,
  });

  return NextResponse.json({ token, nama: user.nama, role: user.role });
});

export async function GET() {
  return methodNotAllowed();
}
