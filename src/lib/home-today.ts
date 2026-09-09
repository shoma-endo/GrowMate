import type { Ga4ConnectionStatus } from '@/types/ga4';
import type { GscConnectionStatus } from '@/types/gsc';
import type { InstagramConnectionStatus } from '@/types/instagram';
import { hasPaidFeatureAccess, type UserRole } from '@/types/user';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';

/**
 * マイホーム（`/`）に出す「今日確認が必要なこと」の組み立て。
 * 表示条件は遷移先の proxy.ts ゲートと同じにする（docs/plans/home-today-spec.md HOME-02）。
 * 純粋関数にして役割 × 状態の組み合わせを単体テストで固定する。
 */

export type HomeTodayItemKind = 'reauth' | 'setup' | 'suggestion';

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
  unreadSuggestionCount?: number | null;
}

export interface HomeToday {
  items: HomeTodayItem[];
  /** いずれかの取得に失敗した（null が渡された）。画面は落とさず注意書きを出す */
  fetchFailed: boolean;
  /** 取得できた連携のうち未連携のものがある。空状態で「設定から始められます」を出す判定に使う */
  hasUnlinked: boolean;
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
  const unread = track(input.unreadSuggestionCount);

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

  if (paid && unread !== undefined && unread > 0) {
    items.push({
      id: 'unread-suggestions',
      kind: 'suggestion',
      // 件数は記事数（toast「N件のコンテンツに改善提案があります」と同じ取得元）
      title: `${unread} 件のコンテンツに改善提案があります`,
      description: 'AI が記事の改善案を用意しました。',
      cta: { label: '提案を確認する', href: '/analytics?unread_suggestion=1' },
    });
  }

  const hasUnlinked =
    (gsc !== undefined && !gsc.connected) ||
    ga4?.connectionStage === 'unlinked' ||
    (googleAds !== undefined && !googleAds.connected);

  return { items, fetchFailed, hasUnlinked };
}
