'use server';

import { headers } from 'next/headers';

import { isUnavailable } from '@/authUtils';
import { isUnauthenticatedAuthError } from '@/lib/supabase/auth-errors';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { clearAuthCookies } from '@/server/middleware/auth.middleware';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { EmailAuthLinkConflictError, PendingAuthDeletionError, userService } from '@/server/services/userService';

// インメモリ レート制限
// Note: Vercel/Edge 環境では複数インスタンスが存在するため、Supabase Auth 側の制限を主防衛線とし、
// ここはベストエフォートの補助防衛線として扱う
const emailLastSent = new Map<string, number>();
const ipWindowData = new Map<string, { count: number; windowStart: number }>();

const EMAIL_COOLDOWN_MS = 60_000; // 1 email あたり 60秒
const IP_MAX_COUNT = 5; // 1 IP あたり 1分間の上限
const IP_WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5分ごとに掃除

let lastCleanup = 0;

// 期限切れエントリを遅延掃除する。各 action 先頭で呼び出す。
function maybePurgeMaps(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, ts] of emailLastSent) {
    if (now - ts >= EMAIL_COOLDOWN_MS) emailLastSent.delete(key);
  }
  for (const [key, data] of ipWindowData) {
    if (now - data.windowStart >= IP_WINDOW_MS) ipWindowData.delete(key);
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_REGEX = /^\d{6}$/;

export async function sendOtpEmail(
  email: string
): Promise<{ success: boolean; error?: string }> {
  maybePurgeMaps();

  // 入力バリデーション
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim()) || email.length > 254) {
    return { success: false, error: '有効なメールアドレスを入力してください。' };
  }

  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const now = Date.now();

  // email 単位レート制限
  const lastSent = emailLastSent.get(normalizedEmail);
  if (lastSent !== undefined && now - lastSent < EMAIL_COOLDOWN_MS) {
    const remaining = Math.ceil((EMAIL_COOLDOWN_MS - (now - lastSent)) / 1000);
    return { success: false, error: `${remaining}秒後に再送信できます` };
  }

  // IP 単位レート制限（IP が判別できない場合はスキップ。'unknown' を共通キーにすると全ユーザーが共同 throttling されるため）
  if (ip) {
    const ipData = ipWindowData.get(ip);
    if (ipData) {
      if (now - ipData.windowStart < IP_WINDOW_MS) {
        if (ipData.count >= IP_MAX_COUNT) {
          return {
            success: false,
            error: '送信回数の上限に達しました。しばらく待ってから再試行してください。',
          };
        }
        ipData.count += 1;
      } else {
        ipWindowData.set(ip, { count: 1, windowStart: now });
      }
    } else {
      ipWindowData.set(ip, { count: 1, windowStart: now });
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: { shouldCreateUser: true },
  });

  if (error) {
    console.error('[auth.actions] sendOtpEmail error:', error.message);
    // 汎用メッセージ（メール列挙攻撃対策）
    return {
      success: false,
      error: 'メールの送信に失敗しました。しばらく待ってから再試行してください。',
    };
  }

  emailLastSent.set(normalizedEmail, now);
  return { success: true };
}

export async function signOutEmail(): Promise<{ success: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError && !isUnauthenticatedAuthError(signOutError)) {
    console.error('[auth.actions] signOutEmail error:', signOutError.message);
    return { success: false, error: 'ログアウトに失敗しました。もう一度お試しください。' };
  }

  // LINE cookie が残っていると middleware が /login → / へリダイレクトするため削除する
  await clearAuthCookies();

  return { success: true };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * メール OTP 経路で `public.users` 解決に失敗したとき、Supabase セッションを破棄する。
 * verifyOtp の競合・汎用失敗、registerFullName の競合と挙動を揃える。
 */
async function signOutSupabaseSession(supabase: SupabaseServerClient): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error && !isUnauthenticatedAuthError(error)) {
    console.error('[auth.actions] signOutSupabaseSession error:', error.message);
  }
}

export async function registerFullName(
  fullName: string
): Promise<{ success: boolean; error?: string; nextPath?: string }> {
  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    return { success: false, error: 'フルネームを入力してください。' };
  }
  if (fullName.trim().length > 100) {
    return { success: false, error: 'フルネームは100文字以内で入力してください。' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { success: false, error: 'セッションが無効です。再度ログインしてください。' };
  }

  let user;
  try {
    user = await userService.resolveOrCreateEmailUser(authData.user.id, authData.user.email!);
  } catch (e) {
    if (e instanceof EmailAuthLinkConflictError) {
      await signOutSupabaseSession(supabase);
      return { success: false, error: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT };
    }
    if (e instanceof PendingAuthDeletionError) {
      await signOutSupabaseSession(supabase);
      return { success: false, error: ERROR_MESSAGES.AUTH.PENDING_AUTH_DELETION };
    }
    throw e;
  }
  const ok = await userService.updateFullName(user.id, fullName.trim());
  if (!ok) {
    return { success: false, error: '登録に失敗しました。もう一度お試しください。' };
  }

  // 新規は unavailable のままなので停止画面へ。利用可能ロールはホームへ。
  return {
    success: true,
    nextPath: isUnavailable(user.role) ? '/unavailable' : '/',
  };
}

export async function verifyOtp(
  email: string,
  token: string
): Promise<{ success: boolean; isNewUser?: boolean; error?: string }> {
  maybePurgeMaps();

  // 入力バリデーション
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim()) || email.length > 254) {
    return { success: false, error: '有効なメールアドレスを入力してください。' };
  }
  if (typeof token !== 'string' || !OTP_REGEX.test(token)) {
    return { success: false, error: '認証コードは6桁の数字で入力してください。' };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: 'email',
  });

  if (error || !data.user) {
    // 列挙耐性のある汎用メッセージ
    return {
      success: false,
      error: '認証コードが無効または期限切れです。もう一度お試しください。',
    };
  }

  try {
    const user = await userService.resolveOrCreateEmailUser(data.user.id, data.user.email!);
    await userService.updateLastLoginAt(user.id);
    // 古い LINE Cookie が残っていると middleware が LINE 経路を優先するため破棄する
    await clearAuthCookies();
    const isNewUser = !user.fullName;
    return { success: true, isNewUser };
  } catch (err) {
    if (err instanceof EmailAuthLinkConflictError) {
      await signOutSupabaseSession(supabase);
      return { success: false, error: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT };
    }
    if (err instanceof PendingAuthDeletionError) {
      await signOutSupabaseSession(supabase);
      return { success: false, error: ERROR_MESSAGES.AUTH.PENDING_AUTH_DELETION };
    }
    console.error('[auth.actions] verifyOtp: failed to resolve public user:', err);
    // auth.users は作成済みだが public.users 解決失敗 → セッション破棄して再試行可能な状態に
    await signOutSupabaseSession(supabase);
    return {
      success: false,
      error: 'ログイン処理に失敗しました。もう一度お試しください。',
    };
  }
}

/**
 * Meta App Review のレビュアー専用ログイン。
 *
 * GrowMate の通常ログインはメール OTP のみで、レビュアーは受信箱に到達できない
 * （審査用 Gmail で Google のリスクベース認証が発動し、確認コードが当方の電話にしか
 * 届かない状態を 2026-08-01 に実測）。提出ガイドは "If we can't access your app for
 * any reason, your entire submission will be rejected" と定めているため、審査用の
 * 固定アカウント1件に限りパスワードで入れる経路を用意する。
 *
 * - `REVIEW_LOGIN_EMAIL` に一致するアドレス以外は受け付けない。未設定なら経路ごと無効。
 *   審査終了後はこの環境変数を消すだけで塞げる（ページ側も同じ変数で 404 になる）
 * - `signInWithPassword` はユーザーを作成しないため、Supabase の新規登録設定は変更不要
 * - public.users の解決以降は verifyOtp と同一の処理・同一の失敗時挙動にする
 */
export async function signInWithReviewPassword(
  email: string,
  password: string
): Promise<{ success: boolean; isNewUser?: boolean; error?: string }> {
  maybePurgeMaps();

  const allowedEmail = process.env.REVIEW_LOGIN_EMAIL?.trim().toLowerCase();
  if (!allowedEmail) {
    return { success: false, error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_DISABLED };
  }

  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim()) || email.length > 254) {
    return { success: false, error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_INVALID };
  }
  if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
    return { success: false, error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_INVALID };
  }
  // 審査用の1アカウント以外はこの経路を通さない（パスワードを持つ別アカウントの流用を防ぐ）
  if (email.trim().toLowerCase() !== allowedEmail) {
    return { success: false, error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_INVALID };
  }

  // IP 単位レート制限（sendOtpEmail と同じ枠を共有する）
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) {
    const now = Date.now();
    const windowData = ipWindowData.get(ip);
    if (windowData && now - windowData.windowStart < IP_WINDOW_MS) {
      if (windowData.count >= IP_MAX_COUNT) {
        return { success: false, error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_RATE_LIMITED };
      }
      windowData.count += 1;
    } else {
      ipWindowData.set(ip, { count: 1, windowStart: now });
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error || !data.user) {
    // 列挙耐性のため、存在しないアカウントとパスワード誤りを区別しない
    return { success: false, error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_INVALID };
  }

  try {
    const user = await userService.resolveOrCreateEmailUser(data.user.id, data.user.email!);
    await userService.updateLastLoginAt(user.id);
    await clearAuthCookies();
    // full_name 未登録のまま '/' へ送ると proxy.ts:157-160 が /login（OTP 画面）へ戻し、
    // レビュアーは OTP を受け取れないため詰む。verifyOtp と同じく isNewUser を返して
    // 呼び出し側で FullNameDialog を出させる。
    const isNewUser = !user.fullName;
    return { success: true, isNewUser };
  } catch (err) {
    if (err instanceof EmailAuthLinkConflictError) {
      await signOutSupabaseSession(supabase);
      return { success: false, error: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT };
    }
    if (err instanceof PendingAuthDeletionError) {
      await signOutSupabaseSession(supabase);
      return { success: false, error: ERROR_MESSAGES.AUTH.PENDING_AUTH_DELETION };
    }
    console.error('[auth.actions] signInWithReviewPassword: failed to resolve public user:', err);
    await signOutSupabaseSession(supabase);
    return { success: false, error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_FAILED };
  }
}
