import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database.types';

/**
 * サーバー用 Supabase クライアント
 * Route Handler / Server Action / Server Component で使用する
 * 認証確認は必ず supabase.auth.getUser() を使用し、getSession() は認証可否判定に使わない
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component からの呼び出し時は setAll が失敗する場合がある
            // middleware でセッション更新済みであれば無視してよい
          }
        },
      },
    }
  );
}
