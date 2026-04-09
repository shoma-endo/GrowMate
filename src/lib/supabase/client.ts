'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database.types';

/**
 * ブラウザ用 Supabase クライアント
 * Supabase Auth セッション（Cookie）を自動管理する
 * 使用場所: Client Component / クライアントサイドのみ
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
      },
    }
  );
}
