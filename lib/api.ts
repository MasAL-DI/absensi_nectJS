import { NextResponse, type NextRequest } from 'next/server';
import { AuthError } from './auth';

/** Setara getBody() di config.php */
export async function getBody(req: NextRequest): Promise<Record<string, any>> {
  try {
    const data = await req.json();
    return data ?? {};
  } catch {
    return {};
  }
}

/** Bungkus handler supaya AuthError (dari cekAuth/cekAdmin) otomatis jadi response JSON yang rapi. */
export function handle(
  fn: (req: NextRequest) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error(err);
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan server';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export function methodNotAllowed() {
  return NextResponse.json({ error: 'Method tidak didukung' }, { status: 405 });
}
