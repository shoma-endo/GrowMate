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
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
}

export interface InstagramAccountInsights {
  reach: number | null;
  views: number | null;
  profileViews: number | null;
  websiteClicks: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  followerCount: number | null;
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
