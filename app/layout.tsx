import { Inter } from 'next/font/google';
import './globals.css';
import { LiffProvider } from '@/components/LiffProvider';
import { Toaster } from '@/components/ui/sonner';
import { GlobalToastBridge } from '@/components/GlobalToastBridge';
import { GscNotificationHandler } from '@/components/GscNotificationHandler';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={inter.className} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <LiffProvider>
          {children}
          <Toaster />
          <GlobalToastBridge />
          <GscNotificationHandler />
        </LiffProvider>
      </body>
    </html>
  );
}
