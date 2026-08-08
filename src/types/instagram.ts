export interface InstagramCredential {
  igUserId: string;
  username: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  accessToken: string;
  accessTokenExpiresAt: string;
  accessTokenIssuedAt: string;
  scope: string[];
  lastSyncedAt: string | null;
  /** 過去投稿取り込み（backfill）の再開カーソル。null は未着手または直近リセット済み */
  backfillCursor: string | null;
  /** 過去投稿取り込みが完了した日時。null は未完了（進行中 or 未着手） */
  backfillCompletedAt: string | null;
}

export interface InstagramConnectionStatus {
  connected: boolean;
  needsReauth?: boolean;
  username?: string | null;
}

export interface InstagramProfile {
  igUserId: string;
  username: string | null;
  name: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

export interface InstagramMediaInsights {
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  totalInteractions: number | null;
  reposts: number | null;
  reelsSkipRate: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
}

export interface InstagramAccountInsightsDailyRow {
  date: string;
  reach: number | null;
  followerCount: number | null;
}

type InstagramInsightsUnavailableReason = 'pre_conversion' | 'retention_expired';

export type InstagramMediaSortKey = 'posted_at' | 'reach' | 'views';
export type InstagramMediaTypeFilter = 'all' | 'reels' | 'feed';

export interface InstagramMediaListItem {
  id: string;
  igMediaId: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  mediaProductType: 'FEED' | 'REELS';
  caption: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string;
  postedAt: string;
  likeCount: number | null;
  commentsCount: number | null;
  reach: number | null;
  views: number | null;
  saved: number | null;
  shares: number | null;
  totalInteractions: number | null;
  reposts: number | null;
  reelsSkipRate: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
  insightsSyncedAt: string | null;
  insightsUnavailable: boolean;
  insightsUnavailableReason: InstagramInsightsUnavailableReason | null;
}

export interface InstagramMediaPageResult {
  items: InstagramMediaListItem[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export type InstagramSyncStoppedReason = 'time_budget' | 'consecutive_failures' | 'rate_limit';

/**
 * incremental: 「最新化」ボタン。DB内最新投稿日時（ウォーターマーク）より新しい投稿のみ取得。
 * backfill: 「過去の投稿をインポート」ボタン。永続化したカーソルから続きを取得し、
 *           既存投稿はインサイト取得をスキップしてページングのみ進める。
 */
export type InstagramSyncMode = 'incremental' | 'backfill';

export interface InstagramSyncResult {
  mode: InstagramSyncMode;
  synced: number;
  failed: number;
  skipped: number;
  truncated: boolean;
  preConversionCount: number;
  stoppedReason?: InstagramSyncStoppedReason;
  /** backfill モード時のみ意味を持つ。true = アカウントの投稿履歴を末端まで取り込み終えた */
  backfillCompleted: boolean;
}

export interface InstagramMediaPreview {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  mediaProductType: 'FEED' | 'REELS';
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  timestamp: string;
  permalink: string;
  likeCount: number | null;
  commentsCount: number | null;
  insights: InstagramMediaInsights;
}

export interface InstagramPreviewData {
  profile: InstagramProfile;
  media: InstagramMediaPreview[];
  /** 再試行で回復しうる取得失敗の件数 */
  failedCount?: number;
  /** プロアカウント転換前の投稿で、恒久的に指標を取得できない件数（失敗ではない） */
  preConversionCount?: number;
}

const INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES = ['BUSINESS', 'MEDIA_CREATOR'] as const;

// 公式の /me フィールド表は account_type を `Business` / `Media_Creator` と記載しているが、
// 2026-08-01 の本番疎通で実 API が返したのは `MEDIA_CREATOR`（全大文字）だった。
// ドキュメントと実挙動が食い違っているため、どちらでも通るよう大小文字を無視して比較する。
export function isInstagramProfessionalAccount(accountType: string | null | undefined): boolean {
  if (!accountType) {
    return false;
  }
  const normalized = accountType.toUpperCase();
  return (INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES as readonly string[]).includes(normalized);
}
