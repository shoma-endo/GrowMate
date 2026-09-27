import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import Script from 'next/script';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { Toaster } from '@/components/ui/sonner';
import { GscNotificationHandler } from '@/components/GscNotificationHandler';
import { env } from '@/env';

const inter = Inter({ subsets: ['latin'] });

// nonce ベース CSP（middleware で付与）はリクエスト毎の nonce をインラインスクリプトへ
// 注入するため、全ルートを動的レンダリングにする。静的プリレンダリングだと build 時 HTML に
// nonce を付与できず、Next16 で CSP に弾かれてハイドレーションが停止する。
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const clarityProjectId = env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

  return (
    <html lang="ja" className={inter.className} suppressHydrationWarning>
      <body suppressHydrationWarning data-clarity-mask="true">
        <AuthProvider>
          {children}
          <GscNotificationHandler />
        </AuthProvider>
        {/* AppShell の main（isolate）の外に置く。Sonner はポータルしないため、中に置くと Dialog/Sheet のオーバーレイの下に潜る */}
        <Toaster />
        {clarityProjectId && (
          <Script id="microsoft-clarity" strategy="afterInteractive" nonce={nonce}>
            {`(function(c,l,a,r,i,t,y){
c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", ${JSON.stringify(clarityProjectId)});`}
          </Script>
        )}
      </body>
    </html>
  );
}
