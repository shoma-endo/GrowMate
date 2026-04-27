import { useCallback, useState } from 'react';
import type { ServerActionResult } from '@/lib/async-handler';
import { getErrorMessage } from '@/lib/async-handler';

/**
 * Server Action実行オプション
 */
interface UseServerActionOptions<T> {
  /**
   * 成功時のコールバック
   */
  onSuccess?: (data: T) => void;

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
 * Server Action呼び出し用のCustom Hook
 *
 * Server Actionのtry-catch-finallyパターンを統一し、
 * isLoading, errorの状態管理を自動化します。
 *
 * @example
 * ```typescript
 * const { execute, isLoading, error } = useServerAction<WordPressConnectionStatus>();
 *
 * useEffect(() => {
 *   execute(fetchWordPressStatusAction, {
 *     onSuccess: setWpStatus,
 *     defaultErrorMessage: 'ステータス取得に失敗しました',
 *   });
 * }, []);
 * ```
 *
 * @template T - Server Actionが返すデータの型
 */
export function useServerAction<T>() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (
      action: () => Promise<ServerActionResult<T>>,
      options?: UseServerActionOptions<T>
    ): Promise<{ success: boolean; data?: T; error?: string }> => {
      const {
        onSuccess,
        defaultErrorMessage = '処理に失敗しました',
        logErrors = true,
      } = options || {};

      setIsLoading(true);
      setError(null);

      try {
        const result = await action();

        if (result.success && result.data !== undefined) {
          onSuccess?.(result.data);
          return { success: true, data: result.data };
        } else {
          const errorMessage = result.error || defaultErrorMessage;
          setError(errorMessage);

          if (logErrors) {
            console.error(new Error(errorMessage));
          }

          return { success: false, error: errorMessage };
        }
      } catch (err) {
        const errorMessage = getErrorMessage(err, defaultErrorMessage);
        setError(errorMessage);

        if (logErrors) {
          console.error(err);
        }

        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /**
   * エラーをクリア
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    /**
     * Server Actionを実行
     */
    execute,

    /**
     * 実行中かどうか
     */
    isLoading,

    /**
     * エラーメッセージ (nullの場合はエラーなし)
     */
    error,

    /**
     * エラーをクリアする関数
     */
    clearError,

    /**
     * エラーを手動で設定する関数
     */
    setError,
  };
}
