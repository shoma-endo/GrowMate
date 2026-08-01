/**
 * クライアント側（AuthProvider）で認証不要とみなすパス。
 *
 * proxy.ts にも同名の PUBLIC_PATHS があり、そちらが実際の認証ゲート。こちらは
 * ローディング表示・フッター・クライアント側リダイレクトの出し分けに使う UI 制御。
 *
 * 両者の中身は意図的に異なる。proxy.ts 側は '/' と '/unauthorized' を含むが、この 2 つは
 * クライアント側では認証必須のままにする必要がある（'/' を公開扱いにすると、未ログイン
 * 訪問者が空の '/' に留まり続ける）。
 *
 * 公開パスを増やすときは、クライアント側でも認証不要でよいものに限り両方へ追加する。
 * proxy.ts だけに追加すると、サーバは通すのに AuthProvider がマウント直後の useEffect で
 * /login へ戻すため、セッションを持たない利用者は画面に到達できない。
 */
const CLIENT_PUBLIC_PATHS = ['/home', '/privacy', '/terms', '/login', '/review-login'] as const;

/**
 * 完全一致、またはスラッシュ区切りの前方一致で判定する。
 * '/loginx' のような別パスを誤って公開扱いしないよう、境界を明示的に見る。
 */
export function isClientPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return CLIENT_PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'));
}
