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
  failedCount?: number;
}

const INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES = ['BUSINESS', 'MEDIA_CREATOR'] as const;

// 公式ドキュメントの /me フィールド表は account_type を `Business` / `Media_Creator` と記載し、
// 旧 Basic Display API は全大文字を返していた。どちらでも通るよう大小文字を無視して比較する。
export function isInstagramProfessionalAccount(accountType: string | null | undefined): boolean {
  if (!accountType) {
    return false;
  }
  const normalized = accountType.toUpperCase();
  return (INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES as readonly string[]).includes(normalized);
}
