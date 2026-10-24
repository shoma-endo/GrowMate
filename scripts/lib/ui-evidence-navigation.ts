/** scripts/takt-ui-evidence.ts が画面を開いた結果を、測ってよい状態かで判定する */
export interface NavigationResult {
  /** page.goto のレスポンス（リダイレクト後の最終レスポンス）のステータス。レスポンスが無ければ null */
  status: number | null;
  requestedPath: string;
  finalPath: string;
}

/**
 * 測れない理由を返す。測ってよければ null。
 * HTTP エラーやリダイレクト先の別画面を測ると、エラーページや別の画面が「はみ出しなし」で合格してしまう。
 */
export function describeNavigationFailure({ status, requestedPath, finalPath }: NavigationResult): string | null {
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
  return null;
}
