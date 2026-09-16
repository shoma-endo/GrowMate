import { INSTAGRAM_SYNC_MEDIA_LIMIT } from '@/lib/constants';
import { getJstDateISOFromTimestamp } from '@/lib/date-utils';
import type { InstagramSyncResult } from '@/types/instagram';

type SyncToastType = 'success' | 'warning' | 'error' | 'info';

/**
 * Instagram タブの初回表示で自動同期すべきかを判定する。
 *
 * 粒度は JST の1日。ブログ側 GA4 取込の `resolveGa4SyncRange`（`already_synced`）と同型で、
 * 「今日まだ同期していなければ取りに行く、済んでいれば DB のまま表示する」ことでレート枠
 * （1同期あたり最大 51 コール）の消費を1日1回に抑える。
 *
 * @param lastSyncedAt `instagram_credentials.last_synced_at`。null は未同期
 * @param todayJst 現在の JST 日付（`YYYY-MM-DD`）
 */
export function shouldAutoSyncInstagram(lastSyncedAt: string | null, todayJst: string): boolean {
  if (lastSyncedAt === null) {
    return true;
  }
  try {
    // `< todayJst` ではなく不一致で見る。クロックスキューや手入力で last_synced_at が未来に
    // なったとき、大小比較だとその日付を過ぎるまで自動同期が永久に止まる
    return getJstDateISOFromTimestamp(lastSyncedAt) !== todayJst;
  } catch (error) {
    // getJstDateISOFromTimestamp は不正値で throw する。Server Component 内で投げると
    // 画面全体が 500 になるため握る。値は自前の timestamptz 列なので通常は到達しない。
    // 「要同期」に倒すのは、黙って永久に同期されなくなるより気づける方を選ぶため
    // （実際の発火回数は呼び出し側の1日1回ガードで抑えられる）。
    console.error('[Instagram Sync] invalid lastSyncedAt', { lastSyncedAt, error });
    return true;
  }
}

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
      message: 'Instagram APIの利用上限に近づいたため、同期を中断しました。時間をおいてもう一度お試しください。',
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
