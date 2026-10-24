export interface NavigationResult {
  /** page.goto はリダイレクト後の最終レスポンスを返す */
  status: number | null;
  requestedPath: string;
  finalPath: string;
  /**
   * Next はストリーミング開始後の notFound() を 200 のまま `<meta name="robots" content="noindex">` で示す。
   * /unauthorized などの `noindex, nofollow` とは content の完全一致で区別する
   */
  noindex: boolean;
}

/**
 * エラーページや別の画面を測ると「はみ出しなし」で合格してしまう。
 * ストリーミング開始後の error.tsx は 200 で目印も無く、ここでは検出できない。
 */
export function describeNavigationFailure({ status, requestedPath, finalPath, noindex }: NavigationResult): string | null {
  if (status === null) {
    return `${requestedPath} を開いたがレスポンスがありませんでした`;
  }
  if (status >= 400) {
    return `${requestedPath} が HTTP ${status} を返しました`;
  }
  if (finalPath === '/login' && requestedPath !== '/login') {
    return `${requestedPath} が /login へ戻されました。ログイン状態（storageState）を用意してください（docs/runbooks/takt-overnight-preflight.md）`;
  }
  if (finalPath !== requestedPath) {
    return `${requestedPath} が ${finalPath} へ移動しました。ログイン状態のユーザーのロールを確認してください`;
  }
  if (noindex) {
    return `${requestedPath} は 200 を返したが noindex の meta がありました（ストリーミング中の notFound()）`;
  }
  return null;
}
