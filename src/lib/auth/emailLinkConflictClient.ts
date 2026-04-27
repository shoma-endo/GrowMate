/**
 * メール紐付け競合時のクライアント導線（next/headers 等のサーバー専用モジュールを import しない）
 */
const EMAIL_LINK_CONFLICT_LOGIN_PATH = '/login?reason=email_link_conflict' as const;

export function isEmailLinkConflictResult(value: unknown): value is {
  success: false;
  error: string;
  emailLinkConflict: true;
} {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.emailLinkConflict === true &&
    obj.success === false &&
    typeof obj.error === 'string'
  );
}

/** 履歴を汚さずログインへ（Server Action の競合ペイロード・409 共通） */
export function replaceToEmailLinkConflictLogin(): void {
  if (typeof window === 'undefined') return;
  window.location.replace(EMAIL_LINK_CONFLICT_LOGIN_PATH);
}
