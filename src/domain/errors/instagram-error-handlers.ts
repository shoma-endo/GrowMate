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

export function isInstagramReauthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('oauthexception') ||
    message.includes('error code 190') ||
    message.includes('code":190') ||
    message.includes('invalid oauth access token') ||
    message.includes('session has expired') ||
    message.includes('token is invalid') ||
    message.includes('token has expired')
  );
}
