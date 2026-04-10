/**
 * コンポーネント専用の型定義
 */
import type { WordPressType } from './wordpress';
import type { UserRole } from './user';
import type { GscConnectionStatus } from './gsc';
import type { Ga4ConnectionStatus } from './ga4';

/**
 * 認証コンテキスト（クライアント側）。Email セッション中心。
 *
 * `profile` / `liffObject` / `isLineCookieAuth` / `getAccessToken` 等は
 * 旧 LINE LIFF 連携からの互換フィールドで、常に固定値（null / false / 空文字）を返す。
 */
export interface AuthContextType {
  isLoggedIn: boolean;
  isLoading: boolean;
  /** legacy: 常に null */
  profile: null;
  user?: import('@/types/user').User | null;
  /** legacy: 常に false */
  isOwnerViewMode: boolean;
  /** legacy: 常に false */
  isLineCookieAuth: boolean;
  login: () => void;
  logout: () => void | Promise<void>;
  /** legacy: 常に null */
  liffObject: null;
  /** legacy: 常に空文字を返す（Server Action 側で Email セッション解決にフォールバック） */
  getAccessToken: () => Promise<string>;
  refreshUser: () => Promise<boolean>;
}

export interface AuthProviderProps {
  children: React.ReactNode;
  /** @deprecated 互換用。効果なし */
  initialize?: boolean;
}

/**
 * コンポーネントProps型定義
 */
export interface WordPressSettingsFormProps {
  existingSettings: ExistingWordPressSettings | null;
  role: UserRole;
}

export interface ExistingWordPressSettings {
  id?: string | undefined;
  wpType: WordPressType;
  wpSiteId?: string | undefined;
  wpSiteUrl?: string | undefined;
  wpUsername?: string | undefined;
  wpApplicationPassword?: string | undefined;
  wpContentTypes?: string[] | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface GoogleAdsConnectionStatus {
  connected: boolean;
  needsReauth: boolean;
  googleAccountEmail: string | null;
  customerId: string | null;
}

export interface SetupDashboardProps {
  wordpressSettings: WordPressSettingsState;
  gscStatus: GscConnectionStatus;
  ga4Status: Ga4ConnectionStatus;
  googleAdsStatus?: GoogleAdsConnectionStatus | undefined;
  isAdmin?: boolean | undefined;
}

export interface WordPressSettingsState {
  hasSettings: boolean;
  type: 'wordpress_com' | 'self_hosted';
  siteId?: string;
  siteUrl?: string;
}

/**
 * セッションリスト関連の型定義
 */
export interface SessionListItem {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface SessionListContentProps {
  sessions: SessionListItem[];
  sessionId: string;
  hoveredSessionId: string | null;
  onLoadSession: (id: string) => void;
  onDeleteClick: (session: SessionListItem, e: React.MouseEvent) => void;
  onStartNewChat: () => void;
  onHoverSession: (sessionId: string | null) => void;
  sessionListRef: React.RefObject<HTMLDivElement | null>;
  onToggleSidebar?: () => void;
  showToggleButton?: boolean;
  headerExtra?: React.ReactNode;
  disableActions?: boolean;
}

/**
 * UI コンポーネント関連の型定義
 */
export interface NavItem {
  icon: React.ReactNode;
  label: string;
  href: string;
}

export interface DeleteChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  chatTitle: string;
  isDeleting?: boolean;
  mode?: 'chat' | 'content';
  hasOrphanContent?: boolean;
}
