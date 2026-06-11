import type { NextConfig } from 'next';

// Baseline security headers on every response (ported from first_attempt — its
// rationale held up). CSP ships report-only until we've confirmed nothing legit
// trips it across every route, then flip the key to enforce. Security-first
// (SCOPE §2): a supply-chain compromise or forgotten plugin can't silently widen these.
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next hydration inline + dev eval
      "style-src 'self' 'unsafe-inline'",                // Tailwind + inline style attrs
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co", // REST + Realtime; Meta/provider calls are worker-side only
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
] as const;

const nextConfig: NextConfig = {
  // @workerchat/shared ships built JS in dist; no transpile needed. The CRM must
  // never pull a provider chat SDK (CONTRACTS §1) — shared has none.
  async headers() {
    return [
      { source: '/:path*', headers: [...SECURITY_HEADERS] },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
