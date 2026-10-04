import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import LoginClient from './LoginClient';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-gray-500">読み込み中...</p>
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
