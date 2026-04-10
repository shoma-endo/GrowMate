/**
 * Server Action用の共通エラーハンドリングユーティリティ
 *
 * try-catch-finallyパターンの重複を排除し、
 * エラーハンドリングを統一的に処理します。
 */

/**
 * Server Actionの標準的な戻り値の型
 */
export interface ServerActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  /** メール紐付け競合（クライアントが専用ログイン導線へ誘導可能） */
  emailLinkConflict?: true;
}

/**
 * 非同期アクション実行時のオプション
 */
export interface AsyncHandlerOptions<T> {
  /**
   * 成功時のコールバック
   */
  onSuccess?: (data: T) => void;

  /**
   * エラー時のコールバック
   */
  onError?: (error: Error) => void;

  /**
   * Loading状態を設定する関数
   */
  setLoading?: (loading: boolean) => void;

  /**
   * メッセージを設定する関数
   */
  setMessage?: (message: string | null) => void;

  /**
   * デフォルトのエラーメッセージ
   */
  defaultErrorMessage?: string;

  /**
   * エラー発生時もコンソールログを出力するか
   * @default true
   */
  logErrors?: boolean;
}

/**
 * Server Actionを実行し、共通のエラーハンドリングを適用
 *
 * @example
 * ```typescript
 * await handleAsyncAction(
 *   () => fetchGscStatus(),
 *   {
 *     onSuccess: (data) => setStatus(data),
 *     setLoading: setIsLoading,
 *     setMessage: setAlertMessage,
 *     defaultErrorMessage: 'ステータスの取得に失敗しました',
 *   }
 * );
 * ```
 */
export async function handleAsyncAction<T>(
  action: () => Promise<ServerActionResult<T>>,
  options: AsyncHandlerOptions<T>
): Promise<void> {
  const {
    onSuccess,
    onError,
    setLoading,
    setMessage,
    defaultErrorMessage = '処理に失敗しました',
    logErrors = true,
  } = options;

  setLoading?.(true);
  setMessage?.(null);

  try {
    const result = await action();

    if (result.success) {
      // 成功時はdataの有無に関わらずonSuccessを呼び出す
      // DELETE操作など、返すデータがない場合もある
      onSuccess?.(result.data as T);
    } else {
      const errorMessage = result.error || defaultErrorMessage;
      const error = new Error(errorMessage);

      if (logErrors) {
        console.error(error);
      }

      setMessage?.(errorMessage);
      onError?.(error);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : defaultErrorMessage;

    if (logErrors) {
      console.error(error);
    }

    setMessage?.(errorMessage);
    onError?.(error instanceof Error ? error : new Error(errorMessage));
  } finally {
    setLoading?.(false);
  }
}

/**
 * エラーメッセージを安全に取得
 *
 * @param error - エラーオブジェクト
 * @param fallback - フォールバックメッセージ
 * @returns エラーメッセージ文字列
 */
export function getErrorMessage(error: unknown, fallback = '不明なエラーが発生しました'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}
