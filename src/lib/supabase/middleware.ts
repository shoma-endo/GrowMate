import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database.types';
import type { User } from '@supabase/supabase-js';

export interface SupabaseSessionResult {
  /** 更新済み Cookie を含むレスポンス。必ず元の NextResponse の代わりに使うこと */
  supabaseResponse: NextResponse;
  /** 有効な Supabase Auth ユーザー。未ログイン時は null */
  supabaseUser: User | null;
}

/**
 * middleware 用 Supabase クライアント + セッション更新
 * Next.js middleware から呼び出し、アクセストークンを自動リフレッシュする
 *
 * 重要: createServerClient と supabase.auth.getUser() の間にコードを挟まないこと
 * Cookie の読み書きタイミングがずれるとセッションが壊れる
 */
export async function updateSupabaseSession(
  request: NextRequest,
  nonce?: string
): Promise<SupabaseSessionResult> {
  const forwardedHeaders = new Headers(request.headers);
  if (nonce) {
    forwardedHeaders.set('x-nonce', nonce);
  }
  let supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders } });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // request の Cookie を更新（後続のミドルウェア/ハンドラ向け）
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // response の Cookie を更新（ブラウザへの Set-Cookie 向け）
          supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // セッション更新を実行。getUser() は Auth サーバーで再検証するため getSession() より信頼性が高い
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, supabaseUser: user };
}
