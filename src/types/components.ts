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
 * `profile` / `liffObject` 等は旧 LINE LIFF 連携からの互換フィールドで、常に null を返す。
 */
export interface AuthContextType {
  isLoggedIn: boolean;
  /** 初回の認証確認中だけ true。パス変更時の再検証は AppShell 内の本文ローディングで扱う。 */
  isLoading: boolean;
  /** legacy: 常に null */
  profile: null;
  user?: import('@/types/user').User | null;
  login: () => void;
  /** サインアウトに成功したら /login へ遷移して true。失敗時は状態を変えず false（呼び出し側が通知する） */
  logout: () => Promise<boolean>;
  /** legacy: 常に null */
  liffObject: null;
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

interface ExistingWordPressSettings {
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

interface GoogleAdsConnectionStatus {
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
  instagramStatus?: import('@/types/instagram').InstagramConnectionStatus | undefined;
}

interface WordPressSettingsState {
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

export interface DeleteChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  chatTitle: string;
  isDeleting?: boolean;
  mode?: 'chat' | 'content';
  hasOrphanContent?: boolean;
}

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  isDeleting?: boolean;
  confirmLabel?: string;
  deletingLabel?: string;
  confirmDisabled?: boolean;
}
