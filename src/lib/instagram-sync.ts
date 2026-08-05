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

  if (result.stoppedReason === 'time_budget') {
    return {
      type: 'warning',
      message: `${result.synced}件まで更新しました。時間上限のため中断しました。再度「最新化」で続きを取得できます。`,
    };
  }

  if (result.stoppedReason === 'consecutive_failures') {
    return {
      type: 'warning',
      message: `${result.synced}件まで更新しました。連続で取得に失敗したため中断しました。`,
    };
  }

  if (result.failed > 0) {
    return {
      type: 'warning',
      message: `${result.synced + result.failed}件中${result.failed}件の更新に失敗しました`,
    };
  }

  if (result.truncated) {
    return {
      type: 'info',
      message: '直近50件まで取得しました',
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
