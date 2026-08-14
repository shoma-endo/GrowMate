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
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'profile.line-scdn.net',
      },
      // Instagram のメディア・サムネイル配信元（CSP img-src と同じ許可範囲。proxy.ts の buildCspHeader 参照）。
      // ホスト一覧は src/lib/constants.ts の INSTAGRAM_CDN_HOSTS が正本。next.config.ts は Next 起動時に
      // alias 解決前に読まれるため import せず、変更時はここも手動で同期すること。
      // `*` は単一セグメントのみ一致するため、scontent.xx.fbcdn.net のような多段サブドメインには
      // `**`（複数セグメント一致）を使う必要がある。
      // 注意: 現状 src/components/InstagramMediaThumbnail.tsx は常に unoptimized な
      // <Image> を使っており、unoptimized は /_next/image（remotePatterns を検証する
      // image-optimizer.js）自体を経由しないため、本設定は現時点で実効性が無い
      // （node_modules/next/dist/shared/lib/get-img-props.js で確認、2026-08-14）。
      // unoptimized を外して最適化を有効化する場合に備えた設定として残す。
      {
        protocol: 'https',
        hostname: '**.cdninstagram.com',
      },
      {
        protocol: 'https',
        hostname: '**.fbcdn.net',
      },
    ],
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
