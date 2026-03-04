'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import type { CanvasSelectionState } from '@/types/canvas';

const MENU_SIZE = {
  menu: { width: 120, height: 40 },
  choice: { width: 200, height: 90 },
  input: { width: 260, height: 190 },
} as const;

const SELECTION_MENU_DELAY_MS = 1000;

export type SelectionMode = 'menu' | 'choice' | 'input' | null;

export interface UseCanvasSelectionOptions {
  /** 選択メニュー表示までの遅延（ms） */
  delayMs?: number;
  /** ストリーミング中は true。この間は content 変更による選択クリアを行わない */
  isStreaming?: boolean;
}

export interface UseCanvasSelectionReturn {
  selectionState: CanvasSelectionState | null;
  activeSelection: CanvasSelectionState | null;
  selectionPreview: string;
  selectionMode: SelectionMode;
  setSelectionMode: React.Dispatch<React.SetStateAction<SelectionMode>>;
  selectionMenuPosition: { top: number; left: number } | null;
  instruction: string;
  setInstruction: React.Dispatch<React.SetStateAction<string>>;
  lastAiError: string | null;
  setLastAiError: React.Dispatch<React.SetStateAction<string | null>>;
  updateSelectionMenuPosition: (
    modeOverride?: SelectionMode,
    anchorOverride?: { top: number; left: number } | null
  ) => void;
  clearSelectionMenu: () => void;
  handleCancelSelectionPanel: () => void;
  /** メニューのみ非表示（選択状態は保持。編集実行前に使用） */
  hideSelectionMenu: () => void;
  /** 遅延表示タイマーのみキャンセル（編集実行前のクイックリセット用） */
  clearSelectionDelay: () => void;
}

/**
 * Canvas AI編集用の選択範囲監視ロジック。
 * TipTapエディタの selectionUpdate を監視し、テキスト選択時にメニューを遅延表示する。
 */
export function useCanvasSelection(
  editor: Editor | null,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  /**
   * undefined のときは選択監視を行わない（onSelectionEdit が渡されていない Canvas では無効）
   */
  enabled: boolean,
  /** content / streamingContent 変更時に選択をリセットするための依存 */
  contentKey: string,
  streamingContentKey: string,
  options: UseCanvasSelectionOptions = {}
): UseCanvasSelectionReturn {
  const { delayMs = SELECTION_MENU_DELAY_MS, isStreaming = false } = options;

  const [selectionState, setSelectionState] = useState<CanvasSelectionState | null>(null);
  const selectionSnapshotRef = useRef<CanvasSelectionState | null>(null);
  const [instruction, setInstruction] = useState('');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(null);
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [lastAiError, setLastAiError] = useState<string | null>(null);

  const selectionAnchorRef = useRef<{ top: number; left: number } | null>(null);
  const selectionShowDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSelection = useMemo(
    () => selectionState ?? selectionSnapshotRef.current,
    [selectionState]
  );

  const selectionPreview = useMemo(() => {
    if (!activeSelection) return '';
    const trimmed = activeSelection.text.replace(/\s+/g, ' ').trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
  }, [activeSelection]);

  const clearSelectionDelay = useCallback(() => {
    if (selectionShowDelayRef.current) {
      clearTimeout(selectionShowDelayRef.current);
      selectionShowDelayRef.current = null;
    }
  }, []);

  const clearSelectionMenu = useCallback(() => {
    clearSelectionDelay();
    setSelectionState(null);
    selectionSnapshotRef.current = null;
    setSelectionMode(null);
    setSelectionMenuPosition(null);
    setInstruction('');
    setLastAiError(null);
    selectionAnchorRef.current = null;
    const domSelection = typeof window !== 'undefined' ? window.getSelection() : null;
    domSelection?.removeAllRanges();
  }, [clearSelectionDelay]);

  /** メニューのみ非表示（選択状態は保持。編集実行前に使用） */
  const hideSelectionMenu = useCallback(() => {
    clearSelectionDelay();
    setSelectionMode(null);
    setSelectionMenuPosition(null);
  }, [clearSelectionDelay]);

  const updateSelectionMenuPosition = useCallback(
    (
      modeOverride?: SelectionMode,
      anchorOverride?: { top: number; left: number } | null
    ) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      let anchor = anchorOverride ?? selectionAnchorRef.current;

      if (!anchor) {
        const selection = typeof window !== 'undefined' ? window.getSelection() : null;
        if (!selection || selection.rangeCount === 0) {
          setSelectionMenuPosition(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        anchor = {
          top: rect.top - containerRect.top + container.scrollTop,
          left: rect.right - containerRect.left + container.scrollLeft + 6,
        };
        selectionAnchorRef.current = anchor;
      }

      const { top: anchorTop, left: anchorLeft } = anchor;
      const scrollTop = container.scrollTop;
      const scrollLeft = container.scrollLeft;
      const mode = modeOverride ?? selectionMode ?? 'menu';
      const size =
        mode === 'choice' ? MENU_SIZE.choice : MENU_SIZE[mode as keyof typeof MENU_SIZE];
      const minTop = scrollTop + 8;
      const minLeft = scrollLeft + 8;
      const maxLeft = scrollLeft + container.clientWidth - size.width - 8;

      const top = Math.max(anchorTop, minTop);
      const left = Math.min(Math.max(anchorLeft, minLeft), Math.max(minLeft, maxLeft));

      if (Number.isFinite(top) && Number.isFinite(left)) {
        setSelectionMenuPosition({ top, left });
      }
    },
    [selectionMode, scrollContainerRef]
  );

  // 選択範囲の監視（Canvas AI編集用）
  useEffect(() => {
    if (!editor || !enabled) return;

    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      const domSelection = typeof window !== 'undefined' ? window.getSelection() : null;
      const container = scrollContainerRef.current;

      if (from === to || !domSelection || domSelection.rangeCount === 0 || !container) {
        clearSelectionMenu();
        return;
      }

      const range = domSelection.getRangeAt(0);
      if (range.collapsed || range.toString().trim().length === 0) {
        clearSelectionMenu();
        return;
      }

      const text = editor.state.doc.textBetween(from, to, '\n', '\n').trim();
      if (!text) {
        clearSelectionMenu();
        return;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const anchor = {
        top: rect.top - containerRect.top + container.scrollTop,
        left: rect.right - containerRect.left + container.scrollLeft + 6,
      };

      const nextState: CanvasSelectionState = { from, to, text };

      clearSelectionDelay();
      selectionShowDelayRef.current = setTimeout(() => {
        selectionShowDelayRef.current = null;
        setSelectionState(nextState);
        selectionSnapshotRef.current = nextState;
        selectionAnchorRef.current = anchor;
        setSelectionMode('choice');
        setInstruction('');
        setLastAiError(null);
        updateSelectionMenuPosition('choice', anchor);
      }, delayMs);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      clearSelectionDelay();
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [
    editor,
    enabled,
    delayMs,
    clearSelectionMenu,
    clearSelectionDelay,
    updateSelectionMenuPosition,
    scrollContainerRef,
  ]);

  // メニュー表示中はスクロール・リサイズで位置を更新
  useEffect(() => {
    if (!selectionMode) return;

    const handle = () => updateSelectionMenuPosition(selectionMode);
    const scrollEl = scrollContainerRef.current;

    window.addEventListener('resize', handle);
    scrollEl?.addEventListener('scroll', handle);

    return () => {
      window.removeEventListener('resize', handle);
      scrollEl?.removeEventListener('scroll', handle);
    };
  }, [selectionMode, updateSelectionMenuPosition, scrollContainerRef]);

  useEffect(() => {
    if (selectionMode) {
      updateSelectionMenuPosition(selectionMode);
    }
  }, [selectionMode, updateSelectionMenuPosition]);

  // content / streamingContent 変更時に選択をリセット
  // ストリーミング中は選択クリアしない（頻繁な更新で選択が途切れる問題を回避）
  useEffect(() => {
    if (isStreaming) return;
    clearSelectionMenu();
  }, [contentKey, streamingContentKey, clearSelectionMenu, isStreaming]);

  // 指示入力時にエラーをクリア（入力で上書きされたことを示す）
  useEffect(() => {
    if (lastAiError && instruction.trim().length > 0) {
      setLastAiError(null);
    }
  }, [instruction, lastAiError]);

  const handleCancelSelectionPanel = useCallback(() => {
    clearSelectionMenu();
  }, [clearSelectionMenu]);

  return {
    selectionState,
    activeSelection,
    selectionPreview,
    selectionMode,
    setSelectionMode,
    selectionMenuPosition,
    instruction,
    setInstruction,
    lastAiError,
    setLastAiError,
    updateSelectionMenuPosition,
    clearSelectionMenu,
    handleCancelSelectionPanel,
    hideSelectionMenu,
    clearSelectionDelay,
};
}
