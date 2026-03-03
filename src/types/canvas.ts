/**
 * キャンバス関連の型定義
 */
import type { BlogStepId } from '@/lib/constants';

export interface CanvasSelectionEditPayload {
  instruction: string;
  selectedText: string;
  canvasContent: string;
}

export interface CanvasSelectionEditResult {
  replacementHtml: string;
  explanation?: string;
}

export interface CanvasHeadingItem {
  level: number;
  text: string;
  id: string;
}

export interface CanvasVersionOption {
  id: string;
  content: string;
  versionNumber: number;
  isLatest?: boolean;
  raw?: string;
}

export interface CanvasPanelProps {
  onClose: () => void;
  content?: string;
  isVisible?: boolean;
  onSelectionEdit?: (payload: CanvasSelectionEditPayload) => Promise<CanvasSelectionEditResult>;
  versions?: CanvasVersionOption[];
  activeVersionId?: string | null;
  onVersionSelect?: (versionId: string) => void;
  stepOptions?: BlogStepId[];
  activeStepId?: BlogStepId | null;
  onStepSelect?: (stepId: BlogStepId) => void;
  streamingContent?: string;
  /** Canvas表示内容を保存時に参照するための ref。CanvasPanel が表示更新時に随時更新する */
  canvasContentRef?: React.MutableRefObject<string>;
  // 見出し単位生成フロー用
  headingIndex?: number;
  /** Step7 で見出し単体操作UI（進捗・コピー等）を表示するか */
  showHeadingUnitActions?: boolean;
  totalHeadings?: number;
  isSavingHeading?: boolean;
  /** 見出し保存エラー（保存/再結合失敗）を操作ボタン付近に表示する */
  headingSaveError?: string | null;
  headingInitError?: string | null;
  onRetryHeadingInit?: () => void;
  isRetryingHeadingInit?: boolean;
  isStreaming?: boolean;
  /** true のときアウトラインを非表示（見出し単位編集時のみ） */
  hideOutline?: boolean;
  /** マッピングできない旧形式の Step7 タイル表示中の場合 true。完成形 UI を除外する */
  hideHeadingProgressAndNav?: boolean;
}

export interface CanvasSelectionState {
  from: number;
  to: number;
  text: string;
}
