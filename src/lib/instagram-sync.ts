import { INSTAGRAM_SYNC_MEDIA_LIMIT } from '@/lib/constants';
import type { InstagramSyncResult } from '@/types/instagram';

type SyncToastType = 'success' | 'warning' | 'error' | 'info';

export function getInstagramSyncToastMessage(
  result: InstagramSyncResult & { needsReauth?: boolean }
): { type: SyncToastType; message: string } {
  if (result.needsReauth) {
    return {
      type: 'error',
      message: 'Instagramの再認証が必要です。連携設定から再連携してください。',
    };
  }

  if (result.stoppedReason === 'rate_limit') {
    return {
      type: 'warning',
      message: 'Instagram APIの利用上限に近づいたため、同期を中断しました。時間をおいて再度お試しください。',
    };
  }

  const retryHint =
    result.mode === 'backfill'
      ? '「過去の投稿をインポート」をもう一度押すと続きを取得できます。'
      : '再度「最新化」で続きを取得できます。';

  if (result.stoppedReason === 'time_budget') {
    return {
      type: 'warning',
      message: `${result.synced}件まで更新しました。時間上限のため中断しました。${retryHint}`,
    };
  }

  if (result.stoppedReason === 'consecutive_failures') {
    return {
      type: 'warning',
      message: `${result.synced}件まで更新しました。連続で取得に失敗したため中断しました。${retryHint}`,
    };
  }

  if (result.failed > 0) {
    return {
      type: 'warning',
      message: `${result.synced + result.failed}件中${result.failed}件の更新に失敗しました`,
    };
  }

  if (result.mode === 'backfill') {
    if (result.backfillCompleted) {
      return {
        type: 'success',
        message: `過去の投稿のインポートが完了しました（今回${result.synced}件）`,
      };
    }
    // 中断理由（stoppedReason）は既に上でハンドリング済み。ここに到達するのは
    // 時間予算いっぱいまで複数バッチ処理してもなお末端に到達しなかったケースで、
    // truncated の有無に関わらず「まだ続きがある」ことを意味する。
    return {
      type: 'info',
      message: `過去の投稿を${result.synced}件インポートしました。続きがあります。「過去の投稿をインポート」からさらに取得できます。`,
    };
  }

  if (result.truncated) {
    return {
      type: 'info',
      message: `直近${INSTAGRAM_SYNC_MEDIA_LIMIT}件まで取得しました。さらに新しい投稿がある可能性があります。「過去の投稿をインポート」からも取得できます。`,
    };
  }

  if (result.synced === 0 && result.skipped === 0 && result.preConversionCount === 0) {
    return {
      type: 'success',
      message: '更新対象の投稿はありませんでした',
    };
  }

  return {
    type: 'success',
    message: `${result.synced}件を更新しました`,
  };
}
