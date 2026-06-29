import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { Toaster } from '@/components/ui/sonner';
import { GlobalToastBridge } from '@/components/GlobalToastBridge';
import { GscNotificationHandler } from '@/components/GscNotificationHandler';

const inter = Inter({ subsets: ['latin'] });

// nonce ベース CSP（middleware で付与）はリクエスト毎の nonce をインラインスクリプトへ
// 注入するため、全ルートを動的レンダリングにする。静的プリレンダリングだと build 時 HTML に
// nonce を付与できず、Next16 で CSP に弾かれてハイドレーションが停止する。
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={inter.className} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthProvider>
          {children}
          <Toaster />
          <GlobalToastBridge />
          <GscNotificationHandler />
        </AuthProvider>
      </body>
    </html>
  );
}
