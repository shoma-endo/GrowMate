'use server';

import { cookies, headers } from 'next/headers';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { featureFlags } from '@/config/featureFlags';
import { userService } from '@/server/services/userService';

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

  if (!featureFlags.emailAuthEnabled) {
    return { success: false, error: 'メールログイン機能は現在利用できません。' };
  }

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

export async function signOutEmail(options?: {
  /** LINE ユーザー用。true のとき signOut 失敗でも LINE Cookie を削除して success を返す（障害時ログアウト不能を防ぐ） */
  allowPartialOnTransientError?: boolean;
}): Promise<{ success: boolean; error?: string; /** true のとき LINE のみ解除済みで Supabase セッションが残っている可能性あり */ partial?: boolean }> {
  const supabase = await createSupabaseServerClient();
  const cookieStore = await cookies();

  // Supabase セッションのサインアウト。
  // - AuthSessionMissingError → LINE 専用ユーザー等セッションが元々ない → 正常扱い
  // - その他エラー（Supabase 一時障害など）:
  //   - allowPartialOnTransientError: true（LINE 用）→ LINE Cookie を削除し partial: true で返す
  //   - それ以外（Email 用）→ 失敗を返す（/login 遷移でループするため）
  let partialLogout = false;
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError && signOutError.name !== 'AuthSessionMissingError') {
    console.error('[auth.actions] signOutEmail error:', signOutError.message);
    if (!options?.allowPartialOnTransientError) {
      return { success: false, error: 'ログアウトに失敗しました。再度お試しください。' };
    }
    partialLogout = true;
  }

  cookieStore.delete('line_access_token');
  cookieStore.delete('line_refresh_token');

  return { success: true, ...(partialLogout && { partial: true }) };
}

export async function registerFullName(
  fullName: string
): Promise<{ success: boolean; error?: string }> {
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

  const user = await userService.resolveOrCreateEmailUser(authData.user.id, authData.user.email!);
  const ok = await userService.updateFullName(user.id, fullName.trim());
  if (!ok) {
    return { success: false, error: '登録に失敗しました。再度お試しください。' };
  }

  return { success: true };
}

export async function verifyOtp(
  email: string,
  token: string
): Promise<{ success: boolean; isNewUser?: boolean; error?: string }> {
  maybePurgeMaps();

  if (!featureFlags.emailAuthEnabled) {
    return { success: false, error: 'メールログイン機能は現在利用できません。' };
  }

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
      error: '認証コードが無効または期限切れです。再度お試しください。',
    };
  }

  try {
    const user = await userService.resolveOrCreateEmailUser(data.user.id, data.user.email!);
    await userService.updateLastLoginAt(user.id);
    // Email セッション確立時に古い LINE Cookie を破棄（middleware が LINE 経路を優先しないよう）
    const cookieStore = await cookies();
    cookieStore.delete('line_access_token');
    cookieStore.delete('line_refresh_token');
    const isNewUser = !user.fullName;
    return { success: true, isNewUser };
  } catch (err) {
    console.error('[auth.actions] verifyOtp: failed to resolve public user:', err);
    // auth.users は作成済みだが public.users 解決失敗 → セッション破棄して再試行可能な状態に
    await supabase.auth.signOut();
    const cookieStore = await cookies();
    cookieStore.delete('line_access_token');
    cookieStore.delete('line_refresh_token');
    return {
      success: false,
      error: 'ログイン処理に失敗しました。再度お試しください。',
    };
  }
}
