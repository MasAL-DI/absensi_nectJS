import { NextResponse, type NextRequest } from 'next/server';

// Setara $allowedOrigins di config.php. Bisa dioverride lewat env ALLOWED_ORIGINS
// (pisahkan dengan koma) supaya tidak perlu redeploy untuk ganti domain frontend.
const DEFAULT_ALLOWED = [
  'https://absensi-rfid-railway.vercel.app',
  'http://localhost',
  'http://localhost:3000',
  'http://127.0.0.1',
];

function allowedOrigins(): string[] {
  const fromEnv = process.env.ALLOWED_ORIGINS;
  if (!fromEnv) return DEFAULT_ALLOWED;
  return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
}

function applyCors(res: NextResponse, origin: string) {
  if (origin && allowedOrigins().includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  } else {
    // non-browser (ESP32, Postman, curl) tidak kirim Origin -> izinkan semua
    res.headers.set('Access-Control-Allow-Origin', '*');
  }
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') || '';

  // Preflight OPTIONS -> balas langsung, jangan lanjut ke route handler apapun
  if (req.method === 'OPTIONS') {
    return applyCors(new NextResponse(null, { status: 204 }), origin);
  }

  return applyCors(NextResponse.next(), origin);
}

export const config = {
  matcher: '/api/:path*',
};
