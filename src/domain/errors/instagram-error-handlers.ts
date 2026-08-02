/**
 * プロアカウント転換より前に投稿されたメディアのインサイト取得エラーか判定する。
 *
 * `GET /{media-id}/insights` は該当メディアに対し `code 100 / error_subcode 2108006` を返す。
 * これは一時的な失敗ではなく、リトライしても永久に取得できない恒久的な状態のため、
 * 「取得に失敗しました」ではなく理由を説明する扱いに分ける。
 * 個人アカウントからプロアカウントへ転換した利用者は転換前の投稿を必ず持つので、
 * 例外ケースではなく既定の体験として起こる。
 *
 * 判定方式は isInstagramReauthError と同じく、parseJsonResponse が
 * レスポンス本文込みで throw する Error のメッセージを見る。
 */
export function isInstagramPreConversionMediaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('error_subcode":2108006') || message.includes('error_subcode: 2108006');
}

/**
 * トークンが失効・取り消しされたと断定できるシグナル。
 * Meta のエラーコード 190 系と、その本文表現のみを見る。
 */
const REVOKED_TOKEN_SIGNALS = [
  'error code 190',
  'code":190',
  'invalid oauth access token',
  'session has expired',
  'token is invalid',
  'token has expired',
] as const;

/**
 * 「トークンがもう使えない」と断定できるエラーか判定する。
 *
 * isInstagramReauthError との違いは `oauthexception` の一語に一致しないこと。
 * Meta はレート制限（code 4 / 17 / 32 / 613）や権限エラーにも
 * `"type":"OAuthException"` を付けて返すため、その一語だけで失効と断定すると
 * 一時的な制限を恒久的な失効として扱ってしまう。
 *
 * **credential を書き換える処理はこちらを使うこと。** 表示だけを切り替える用途は
 * 広めの isInstagramReauthError でよい（一時的な誤判定でも次回読み込みで直る）が、
 * 保存済みの期限を過去へ倒す処理は取り返しがつかない
 * （期限が過去だと resolveInstagramTokenAction がリフレッシュを試みなくなる）。
 */
export function isInstagramRevokedTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return REVOKED_TOKEN_SIGNALS.some(signal => message.includes(signal));
}

/**
 * 再認証を促す表示に切り替えるべきエラーか判定する。
 * 失効の確証がない OAuthException も含む広めの判定。
 */
export function isInstagramReauthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes('oauthexception') ||
    isInstagramRevokedTokenError(error);
}
