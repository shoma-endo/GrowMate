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
 * GSC/GA4/Google Ads はいずれも同一の googleTokenService.refreshAccessToken を経由するため、
 * この関数を唯一の判定器として共有する（2026-09-12統合。旧 isTokenExpiredError /
 * isGa4ReauthError / googleAds.actions.ts ローカル版 isGoogleAdsReauthError は廃止）。
 * 旧実装が個別に持っていた `'トークンリフレッシュに失敗'` という汎用文言の部分一致は、
 * 上記の同一文言問題によりステータスに関係なく常に一致してしまう（＝一時的失敗まで
 * 再認証要と誤判定する）ため、意図的に含めていない。
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
