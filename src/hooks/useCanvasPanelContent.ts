import { useEffect, useMemo, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage } from '@/domain/interfaces/IChatService';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import type { BlogStepId } from '@/lib/constants';
import { BLOG_STEP_IDS, STEP7_ID } from '@/lib/constants';
import type { SessionHeadingSection } from '@/types/heading-flow';
import { resolveHeadingCanvasViewMode } from '@/lib/canvas-mode';
import { formatMarkdownHeading } from '@/lib/heading-extractor';
import { resolveStep6ToStep7Lead } from '@/lib/step7-lead';

interface UseCanvasPanelContentParams {
  fallbackMessageIdRef: RefObject<string | null>;
  canvasEditInFlightRef: RefObject<boolean>;
  pendingCombinedVersionIdRef: RefObject<string | null>;
  pendingCombinedContentRef: RefObject<string | null>;
  blogCanvasVersionsByStep: ReturnType<typeof useCanvasVersions>['blogCanvasVersionsByStep'];
  isCanvasStreaming: boolean;
  setCanvasStreamingContent: Dispatch<SetStateAction<string>>;
  isHeadingFlowCanvasStep: boolean;
  isViewingPastHeadingContent: boolean;
  isViewingCombinedContent: boolean;
  canvasStreamingContent: string;
  activeCanvasVersion: ReturnType<typeof useCanvasVersions>['activeCanvasVersion'];
  activeVersionId: ReturnType<typeof useCanvasVersions>['activeVersionId'];
  combinedContentVersions: ReturnType<typeof useHeadingFlow>['combinedContentVersions'];
  latestCombinedContent: string | null;
  headingCanvasViewMode: ReturnType<typeof resolveHeadingCanvasViewMode>;
  headingSections: SessionHeadingSection[];
  step6ToStep7Lead: ReturnType<typeof resolveStep6ToStep7Lead>;
  isStep6ContentStale: boolean;
  viewingHeadingIndex: number | null;
  activeHeadingIndex: number | undefined;
  getLatestStep7HeadingContent: (
    messages: ChatMessage[],
    headingIndex: number,
    minTimestamp?: number
  ) => string | null;
  allMessagesForVersions: ChatMessage[];
  minTsForContentCheck: number | undefined;
  canvasVersionsForStep: ReturnType<typeof useCanvasVersions>['canvasVersionsForStep'];
}

/** Step7 完成形タイル: コンテンツからタイトルと抜粋を抽出 */
const deriveTileFromContent = (content: string) => {
  const c = content?.trim() ?? '';
  if (!c) return { title: '完成形', excerpt: 'クリックしてCanvasで確認' };
  const rawLines = c.split('\n');
  const headingIdx = rawLines.findIndex(line => /^#+\s*/.test(line.trim()));
  const firstIdx = rawLines.findIndex(line => line.trim().length > 0);
  const titleLine = (headingIdx >= 0 ? rawLines[headingIdx] : rawLines[firstIdx]) ?? rawLines[0] ?? '';
  const title = titleLine.trim().replace(/^#+\s*/, '').trim() || '完成形';
  const bodyLines = rawLines.filter((_, i) => i !== headingIdx);
  const body = bodyLines.join('\n').trim();
  const excerptPlain = (body || c)
    .split('\n')
    .map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^[0-9]+\.\s+/, ''))
    .filter(Boolean)
    .join(' ');
  const excerpt = excerptPlain.length > 140 ? `${excerptPlain.slice(0, 140)}…` : excerptPlain || 'クリックしてCanvasで確認';
  return { title, excerpt };
};

export function useCanvasPanelContent({
  fallbackMessageIdRef,
  canvasEditInFlightRef,
  pendingCombinedVersionIdRef,
  pendingCombinedContentRef,
  blogCanvasVersionsByStep,
  isCanvasStreaming,
  setCanvasStreamingContent,
  isHeadingFlowCanvasStep,
  isViewingPastHeadingContent,
  isViewingCombinedContent,
  canvasStreamingContent,
  activeCanvasVersion,
  activeVersionId,
  combinedContentVersions,
  latestCombinedContent,
  headingCanvasViewMode,
  headingSections,
  step6ToStep7Lead,
  isStep6ContentStale,
  viewingHeadingIndex,
  activeHeadingIndex,
  getLatestStep7HeadingContent,
  allMessagesForVersions,
  minTsForContentCheck,
  canvasVersionsForStep,
}: UseCanvasPanelContentParams) {
  // フォールバック表示の自動解除: canvasVersions に待機中 message.id が現れたら streamingContent をクリア
  useEffect(() => {
    const pendingId = fallbackMessageIdRef.current;
    if (!pendingId) return;

    const isResolved = Object.values(blogCanvasVersionsByStep).some(versions =>
      versions.some(v => v.id === pendingId)
    );
    if (isResolved) {
      fallbackMessageIdRef.current = null;
      // AI キャンバス編集が進行中の場合は streamingContent を上書きしない
      if (!isCanvasStreaming && !canvasEditInFlightRef.current) {
        setCanvasStreamingContent('');
      }
    }
  }, [
    blogCanvasVersionsByStep,
    isCanvasStreaming,
    fallbackMessageIdRef,
    canvasEditInFlightRef,
    setCanvasStreamingContent,
  ]);

  const canvasContent = useMemo(() => {
    if (isHeadingFlowCanvasStep) {
      // 旧 model (blog_creation_step7) のタイル: バージョン管理で選ばれた内容をそのまま表示
      if (isViewingPastHeadingContent) {
        return (canvasStreamingContent || activeCanvasVersion?.content) ?? '';
      }
      if (isViewingCombinedContent) {
        const selectedCombined =
          activeVersionId != null
            ? combinedContentVersions.find(
                v => v.id === activeVersionId || String(v.id) === String(activeVersionId)
              )?.content ?? null
            : null;
        const combined =
          selectedCombined ??
          latestCombinedContent ??
          combinedContentVersions[combinedContentVersions.length - 1]?.content ??
          '';
        if (combined.trim()) return combined;
      }
      if (headingCanvasViewMode.isCombinedView) {
        const effectiveVersionId =
          activeVersionId ?? pendingCombinedVersionIdRef.current;
        if (effectiveVersionId === activeVersionId) {
          pendingCombinedVersionIdRef.current = null;
        }
        const foundVersion =
          combinedContentVersions.find(v => v.id === effectiveVersionId) ??
          (effectiveVersionId != null
            ? combinedContentVersions.find(v => String(v.id) === String(effectiveVersionId))
            : undefined);
        const combined =
          foundVersion?.content ??
          (combinedContentVersions.length > 0
            ? combinedContentVersions[combinedContentVersions.length - 1]?.content
            : null) ??
          latestCombinedContent ??
          '';
        if (combined.trim()) return combined;
        // 恒久対応: タイルクリック直後の state 更新遅延による空表示を防止（pendingCombinedContentRef を優先消費）
        const pendingContent = pendingCombinedContentRef.current;
        if (pendingContent != null && pendingContent.trim()) {
          pendingCombinedContentRef.current = null;
          return pendingContent;
        }
        // 本文作成未実施時: 書き出し案＋見出しセクションから結合フォールバックを表示（スキップで開いたときの空表示を防止）
        if (combinedContentVersions.length === 0 && headingSections.length > 0) {
          const sectionContents = headingSections
            .map(s => {
              return `${formatMarkdownHeading(s.headingLevel, s.headingText)}\n\n${(s.content || '').trim()}`;
            })
            .join('\n\n')
            .trim();
          if (sectionContents) {
            const lead = step6ToStep7Lead.content?.trim();
            return lead ? `${lead}\n\n${sectionContents}` : sectionContents;
          }
        }
        // combined が空でも完成形データがあれば表示（ID不一致・遅延などの保険）
        const combinedFallback =
          latestCombinedContent?.trim() ||
          combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
          '';
        const result = combinedFallback || combined;
        return result;
      }
      // 見出し遷移直後は前見出し本文を表示しない（誤保存防止）。表示中がアクティブでなければ stale を無視
      if (
        isStep6ContentStale &&
        viewingHeadingIndex !== null &&
        viewingHeadingIndex === activeHeadingIndex
      ) {
        return '';
      }
      const idx = viewingHeadingIndex ?? 0;
      if (idx >= 0 && idx < headingSections.length) {
        const section = headingSections[idx];
        if (section?.isConfirmed && section.content) {
          return `${formatMarkdownHeading(section.headingLevel, section.headingText)}\n\n${section.content}`;
        }
        const allSectionsEmpty = headingSections.every(s => !s.content || s.content.trim() === '');
        // 未確定見出し: canvasStreamingContent または getLatestStep7HeadingContent を優先
        // （blog_creation_step7_hN はバージョン管理対象外のため activeCanvasVersion に含まれない）
        if (canvasStreamingContent?.trim()) {
          return `${formatMarkdownHeading(section?.headingLevel ?? 3, section?.headingText ?? '')}\n\n${canvasStreamingContent}`;
        }
        const fromChat = getLatestStep7HeadingContent(
          allMessagesForVersions,
          idx,
          minTsForContentCheck
        );
        if (fromChat?.trim()) {
          return `${formatMarkdownHeading(section?.headingLevel ?? 3, section?.headingText ?? '')}\n\n${fromChat}`;
        }
        if (allSectionsEmpty && activeCanvasVersion?.content?.trim()) {
          // 書き出し案送信直後の旧バージョンのみ非表示。今回の生成内容はCanvasに表示する
          const versionCreatedMs = activeCanvasVersion?.createdAtIso
            ? new Date(activeCanvasVersion.createdAtIso).getTime()
            : (activeCanvasVersion?.createdAt ?? 0);
          const sectionsCreatedMs = Math.min(
            ...headingSections.map(s => (s.updatedAt ? new Date(s.updatedAt).getTime() : Infinity))
          );
          if (sectionsCreatedMs !== Infinity && versionCreatedMs < sectionsCreatedMs) {
            // 旧バージョン → 非表示。ただし既存完成形があれば表示（選択バージョン反映）
            if (combinedContentVersions.length > 0) {
              const byId =
                activeVersionId != null
                  ? combinedContentVersions.find(
                      v => v.id === activeVersionId || String(v.id) === String(activeVersionId)
                    )?.content?.trim()
                  : null;
              const cv =
                byId ||
                latestCombinedContent?.trim() ||
                combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
                '';
              if (cv) return cv;
            }
            return '';
          }
        } else if (allSectionsEmpty) {
          // 見出し本文が空でも、既存完成形（session_combined_contents）があれば表示。バージョン選択反映。
          if (combinedContentVersions.length > 0) {
            const byId =
              activeVersionId != null
                ? combinedContentVersions.find(
                    v => v.id === activeVersionId || String(v.id) === String(activeVersionId)
                  )?.content?.trim()
                : null;
            const cv =
              byId ||
              latestCombinedContent?.trim() ||
              combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
              '';
            if (cv) return cv;
          }
          return '';
        }
      }
      // Step7 のみ: 上記で解決できなかった場合の最終フォールバック（空表示の恒久防止）。バージョン選択反映。
      if (combinedContentVersions.length > 0) {
        const byId =
          activeVersionId != null
            ? combinedContentVersions.find(
                v => v.id === activeVersionId || String(v.id) === String(activeVersionId)
              )?.content?.trim()
            : null;
        const fallback =
          byId ||
          latestCombinedContent?.trim() ||
          combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
          '';
        if (fallback) return fallback;
      }
      const finalFallback = activeCanvasVersion?.content ?? '';
      return finalFallback;
    }
    // 未確定の場合は最新のバージョン（生成中の内容含む）を表示
    const finalContent = activeCanvasVersion?.content ?? '';
    return finalContent;
  }, [
    isHeadingFlowCanvasStep,
    isViewingPastHeadingContent,
    canvasStreamingContent,
    headingCanvasViewMode.isCombinedView,
    headingSections,
    combinedContentVersions,
    activeVersionId,
    latestCombinedContent,
    isViewingCombinedContent,
    step6ToStep7Lead.content,
    activeCanvasVersion,
    isStep6ContentStale,
    viewingHeadingIndex,
    activeHeadingIndex,
    allMessagesForVersions,
    getLatestStep7HeadingContent,
    minTsForContentCheck,
    pendingCombinedVersionIdRef,
    pendingCombinedContentRef,
  ]);

  const isCombinedFormView = headingCanvasViewMode.isCombinedView;
  const isHeadingUnitStep7View = headingCanvasViewMode.isViewingHeading;
  const isCombinedFormViewWithVersions = isCombinedFormView && combinedContentVersions.length > 0;

  // 他ステップと同様: canvasVersionsForStep をベースに。Step7 見出し単体のみバージョン管理なし
  const canvasVersionsWithMeta = useMemo(() => {
    if (isHeadingUnitStep7View) return [];
    if (isCombinedFormView && combinedContentVersions.length === 0) {
      return []; // 完成形未取得時はバージョンUI非表示（本文ソースとの不整合を防止）
    }
    if (isCombinedFormViewWithVersions) {
      return combinedContentVersions.map(v => ({
        id: v.id,
        content: v.content,
        versionNumber: v.versionNo,
        isLatest: v.isLatest,
      }));
    }
    return canvasVersionsForStep.map((version, index) => ({
      ...version,
      versionNumber: index + 1,
      isLatest: index === canvasVersionsForStep.length - 1,
    }));
  }, [
    isHeadingUnitStep7View,
    isCombinedFormView,
    isCombinedFormViewWithVersions,
    combinedContentVersions,
    canvasVersionsForStep,
  ]);

  const canvasStepOptions = useMemo(() => {
    // バージョンが1件以上あるステップを表示（nextStepForPlaceholder では除外しない）
    const base = BLOG_STEP_IDS.filter(
      step => (blogCanvasVersionsByStep[step] ?? []).length > 0
    );
    // Step7 完成形は session_combined_contents に保存されるため、combinedContentVersions があれば追加
    if (!base.includes(STEP7_ID) && combinedContentVersions.length > 0) {
      return [...base, STEP7_ID];
    }
    return base;
  }, [blogCanvasVersionsByStep, combinedContentVersions.length]);

  // Step7 完成形タイル: 各バージョンをタイル化。createdAt で時系列マージ用
  const combinedTiles = useMemo(
    () =>
      combinedContentVersions.map(v => {
        const { title, excerpt } = deriveTileFromContent(v.content);
        return {
          id: v.id,
          title,
          excerpt,
          ...(v.createdAt != null && { createdAt: v.createdAt }),
        };
      }),
    [combinedContentVersions]
  );
  return {
    canvasContent,
    isHeadingUnitStep7View,
    canvasVersionsWithMeta,
    canvasStepOptions,
    combinedTiles,
  };
}
