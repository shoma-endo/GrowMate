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

export interface CanvasBubbleState {
  isVisible: boolean;
  message: string;
  type: 'markdown' | 'text' | 'download';
  position: { top: number; left: number };
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
}

export interface CanvasSelectionState {
  from: number;
  to: number;
  text: string;
}
