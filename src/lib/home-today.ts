import type { Ga4ConnectionStatus } from '@/types/ga4';
import type { GscConnectionStatus } from '@/types/gsc';
import type { InstagramConnectionStatus } from '@/types/instagram';
import { hasPaidFeatureAccess, type UserRole } from '@/types/user';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';

/**
 * マイホーム（`/`）に出す「連携の異常」の組み立て。
 * 改善提案は toast（GscNotificationHandler）が全画面で担うのでここには置かない。
 * 表示条件は遷移先の proxy.ts ゲートと同じにする（docs/plans/home-today-spec.md HOME-02）。
 * 純粋関数にして役割 × 状態の組み合わせを単体テストで固定する。
 */

export type HomeTodayItemKind = 'reauth' | 'setup';

interface HomeTodayItem {
  id: string;
  kind: HomeTodayItemKind;
  title: string;
  description: string;
  cta: { label: string; href: string };
}

/** null は取得失敗、undefined は役割上そもそも取得しない */
export interface HomeTodayInput {
  role: UserRole | null;
  gsc?: GscConnectionStatus | null;
  ga4?: Ga4ConnectionStatus | null;
  googleAds?: { connected: boolean; needsReauth: boolean } | null;
  instagram?: InstagramConnectionStatus | null;
}

export interface HomeToday {
  items: HomeTodayItem[];
  /** いずれかの取得に失敗した（null が渡された）。画面は落とさず注意書きを出す */
  fetchFailed: boolean;
  /** 取得できた連携のうち未連携のものがある。空状態で「設定から始められます」を出す判定に使う */
  hasUnlinked: boolean;
}

/**
 * Google Ads の連携状態が「一時的失敗」（本当の再認証要ではないerror）かどうかを判定する。
 * setup系2画面（app/setup/page.tsx・app/setup/google-ads/page.tsx）で条件がずれないよう、
 * 単一の関数に集約する。
 */
export function isGoogleAdsTemporaryError(status: {
  connected: boolean;
  needsReauth: boolean;
  error?: string;
}): boolean {
  return status.connected && !status.needsReauth && Boolean(status.error);
}

/**
 * Google Ads 連携状態の取得が「取得失敗」扱いになるかを判定する。
 * needsReauth:true は再連携待ちの正当な状態なので取得失敗ではない。
 * それ以外で error が付いている場合（一時的なリフレッシュ失敗・DB書き込み失敗等）は
 * 取得失敗として汎用バナー（fetchFailed）に流す。
 */
export function isGoogleAdsFetchFailed(
  result:
    | { ok: true; value: { connected: boolean; needsReauth: boolean; error?: string } }
    | { ok: false }
): boolean {
  return !result.ok || (Boolean(result.value.error) && !result.value.needsReauth);
}

export function buildHomeToday(input: HomeTodayInput): HomeToday {
  const paid = hasPaidFeatureAccess(input.role);
  const items: HomeTodayItem[] = [];
  let fetchFailed = false;

  const track = <T>(value: T | null | undefined): T | undefined => {
    if (value === null) fetchFailed = true;
    return value ?? undefined;
  };

  const gsc = track(input.gsc);
  const ga4 = track(input.ga4);
  const googleAds = track(input.googleAds);
  const instagram = track(input.instagram);

  // 異常（放置するとデータが止まる）を先に置く
  if (paid && gsc?.connected && gsc.needsReauth) {
    items.push({
      id: 'gsc-reauth',
      kind: 'reauth',
      title: 'Google Search Console の再連携が必要です',
      description: '検索順位の取得が止まっています。',
      cta: { label: '再連携する', href: '/setup/gsc' },
    });
  }
  // GSC だけ連携した利用者は GA4 が unlinked かつ needsReauth になる（ga4-status.ts）。
  // 未連携は「変化」ではないので connected を必須にする（/setup の ga4Setup.actions と同じ扱い）
  if (paid && ga4?.connected && ga4.needsReauth) {
    items.push({
      id: 'ga4-reauth',
      kind: 'reauth',
      title: 'Google Analytics 4 の再連携が必要です',
      description: 'アクセス解析の取得が止まっています。',
      cta: { label: '再連携する', href: '/setup/ga4' },
    });
  } else if (paid && ga4?.connectionStage === 'linked_unselected') {
    items.push({
      id: 'ga4-unselected',
      kind: 'setup',
      title: 'Google Analytics 4 のプロパティが選ばれていません',
      description: '連携は済んでいますが、対象サイトが未選択です。',
      cta: { label: 'プロパティを選ぶ', href: '/setup/ga4' },
    });
  }
  if (googleAds?.needsReauth) {
    items.push({
      id: 'google-ads-reauth',
      kind: 'reauth',
      title: 'Google Ads の再連携が必要です',
      description: '広告データの取得が止まっています。',
      cta: { label: '再連携する', href: '/setup/google-ads' },
    });
  }
  if (canAccessInstagram(input.role) && instagram?.needsReauth) {
    items.push({
      id: 'instagram-reauth',
      kind: 'reauth',
      title: 'Instagram の再連携が必要です',
      description: '投稿データの取得が止まっています。',
      cta: { label: '再連携する', href: '/setup/instagram' },
    });
  }

  const hasUnlinked =
    (gsc !== undefined && !gsc.connected) ||
    ga4?.connectionStage === 'unlinked' ||
    (googleAds !== undefined && !googleAds.connected);

  return { items, fetchFailed, hasUnlinked };
}
