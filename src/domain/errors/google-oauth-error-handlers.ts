const extractRefreshErrorStatus = (message: string): number | null => {
  const match = message.match(/Status (\d+)/);
  return match ? Number(match[1]) : null;
};

/**
 * Google OAuth トークンリフレッシュ失敗が「本当の認証失効」かどうかを判定する。
 * googleTokenService.refreshAccessToken は 5xx/429 でも 400/401 でも同じ文言
 * （`Google OAuthトークンリフレッシュに失敗しました: Status {code}`）を投げるため、
 * まずステータスコードで判定し、取れない場合はメッセージの部分一致にフォールバックする。
 *
 * 文字列フォールバックのパターンは isGa4ReauthError（src/domain/errors/ga4-error-handlers.ts）と
 * ほぼ同じだが、意図的に再利用していない: isGa4ReauthError は `'トークンリフレッシュに失敗'`
 * という汎用文言を含んでおり、これは上記の同一文言問題によりステータスに関係なく常に一致してしまう
 * （＝一時的失敗まで再認証要と誤判定する、本ファイルが解消しようとしている欠陥そのもの）。
 * isGa4ReauthError 自体は /setup 系の既存挙動を変えないため今回は修正せず据え置いている。
 */
export function isGoogleOAuthReauthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = extractRefreshErrorStatus(message);
  if (status !== null) {
    return status === 400 || status === 401 || status === 403;
  }
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid_grant') ||
    lower.includes('token has been expired') ||
    lower.includes('token has been revoked') ||
    lower.includes('insufficient permissions') ||
    lower.includes('permission_denied') ||
    lower.includes('insufficientpermissions')
  );
}
