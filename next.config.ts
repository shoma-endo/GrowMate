import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' https://profile.line-scdn.net data:",
              "connect-src 'self' https://api.line.me https://oauth2.googleapis.com https://openidconnect.googleapis.com https://www.googleapis.com https://accounts.google.com https://public-api.wordpress.com https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  images: {
    domains: ['profile.line-scdn.net'],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // パフォーマンス最適化: 圧縮を明示的に有効化（Next.js 15 ではデフォルトで有効だが明示的に設定）
  compress: true,
  // レスポンスヘッダー最適化
  poweredByHeader: false,
  // React Strict Mode を有効化（潜在的な問題の早期検出、開発環境で二重レンダリングによる検証）
  reactStrictMode: true,
};

export default nextConfig;
