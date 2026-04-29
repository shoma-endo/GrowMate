import { useState, useMemo, useEffect } from 'react';
import { BlogStepId, BLOG_STEP_IDS, STEP7_ID, isStep7HeadingModel } from '@/lib/constants';
import { extractBlogStepFromModel, normalizeCanvasContent } from '@/lib/canvas-content';
import { ChatMessage } from '@/domain/interfaces/IChatService';
import { BlogCanvasVersion, StepVersionsMap } from '@/types/chat-layout';
import type { CombinedContentVersion } from '@/hooks/useHeadingFlow';

interface UseCanvasVersionsParams {
  /** Step7 完成形（session_combined_contents）を step7 のバージョンとして他ステップと同様に扱う */
  step7VersionsOverride?: CombinedContentVersion[];
}

export function useCanvasVersions(
  messages: ChatMessage[],
  resolvedCanvasStep: BlogStepId | null,
  params?: UseCanvasVersionsParams
) {
  const { step7VersionsOverride } = params ?? {};
  const [selectedVersionByStep, setSelectedVersionByStep] = useState<
    Partial<Record<BlogStepId, string | null>>
  >({});
  const [followLatestByStep, setFollowLatestByStep] = useState<
    Partial<Record<BlogStepId, boolean>>
  >({});

  const { map: blogCanvasVersionsByStep, step7FromMessages } = useMemo(() => {
    const initialMap = BLOG_STEP_IDS.reduce((acc, step) => {
      acc[step] = [] as BlogCanvasVersion[];
      return acc;
    }, {} as StepVersionsMap);

    (messages ?? []).forEach(message => {
      if (!message || message.role !== 'assistant') return;
      const step = extractBlogStepFromModel(message.model);
      if (!step) return;
      // Step7 見出し単体はバージョン管理に含めない（Canvas表示は別経路で行う）
      if (step === STEP7_ID && isStep7HeadingModel(message.model)) return;

      const normalizedContent = normalizeCanvasContent(message.content);
      const version: BlogCanvasVersion = {
        id: message.id,
        content: normalizedContent,
        raw: message.content,
        step,
        createdAt: message.timestamp ? message.timestamp.getTime() : 0,
        createdAtIso: message.timestamp ? message.timestamp.toISOString() : null,
      };

      if (message.model) {
        version.model = message.model;
      }

      initialMap[step].push(version);
    });

    BLOG_STEP_IDS.forEach(step => {
      initialMap[step].sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }
        return a.id.localeCompare(b.id);
      });
    });

    // Step7 メッセージ由来（見出し編集判定用。完成形で汚染しない）
    const step7FromMessages = initialMap[STEP7_ID] ?? [];

    // Step7 完成形は session_combined_contents 由来。バージョン選択UI用に step7 スロットを上書き
    if (step7VersionsOverride && step7VersionsOverride.length > 0) {
      const mapped: BlogCanvasVersion[] = step7VersionsOverride.map(v => ({
        id: v.id,
        content: v.content,
        raw: v.content,
        step: STEP7_ID,
        createdAt: v.createdAt ? new Date(v.createdAt).getTime() : 0,
        createdAtIso: v.createdAt ?? null,
      }));
      mapped.sort((a, b) => a.createdAt - b.createdAt); // 他ステップと同様 昇順（最新=末尾）
      initialMap[STEP7_ID] = mapped;
    }

    return { map: initialMap, step7FromMessages };
  }, [messages, step7VersionsOverride]);

  useEffect(() => {
    const selectionUpdates: Partial<Record<BlogStepId, string | null>> = {};
    const followUpdates: Partial<Record<BlogStepId, boolean>> = {};
    let selectionChanged = false;
    let followChanged = false;

    BLOG_STEP_IDS.forEach(step => {
      const versions = blogCanvasVersionsByStep[step] ?? [];
      const latestId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;
      const currentSelection = selectedVersionByStep[step] ?? null;
      const followLatest = followLatestByStep[step] !== false;
      const currentExists =
        currentSelection !== null && versions.some(version => version.id === currentSelection);

      if (!versions.length) {
        if (currentSelection !== null) {
          selectionUpdates[step] = null;
          selectionChanged = true;
        }
        if (followLatestByStep[step] !== undefined && followLatestByStep[step] !== true) {
          followUpdates[step] = true;
          followChanged = true;
        }
        return;
      }

      if (!currentExists) {
        if (latestId) {
          selectionUpdates[step] = latestId;
          selectionChanged = true;
        }
        if (followLatestByStep[step] !== true) {
          followUpdates[step] = true;
          followChanged = true;
        }
        return;
      }

      if (followLatest && latestId && currentSelection !== latestId) {
        selectionUpdates[step] = latestId;
        selectionChanged = true;
      }
    });

    if (selectionChanged) {
      setSelectedVersionByStep(prev => {
        const next = { ...prev };
        BLOG_STEP_IDS.forEach(step => {
          if (Object.prototype.hasOwnProperty.call(selectionUpdates, step)) {
            next[step] = selectionUpdates[step] ?? null;
          }
        });
        return next;
      });
    }

    if (followChanged) {
      setFollowLatestByStep(prev => {
        const next = { ...prev };
        BLOG_STEP_IDS.forEach(step => {
          if (Object.prototype.hasOwnProperty.call(followUpdates, step)) {
            next[step] = followUpdates[step] ?? true;
          }
        });
        return next;
      });
    }
  }, [blogCanvasVersionsByStep, selectedVersionByStep, followLatestByStep]);

  const canvasVersionsForStep = useMemo<BlogCanvasVersion[]>(() => {
    if (!resolvedCanvasStep) return [];
    return blogCanvasVersionsByStep[resolvedCanvasStep] ?? [];
  }, [blogCanvasVersionsByStep, resolvedCanvasStep]);

  const activeVersionId = resolvedCanvasStep
    ? (selectedVersionByStep[resolvedCanvasStep] ?? null)
    : null;

  const activeCanvasVersion = useMemo(() => {
    if (!resolvedCanvasStep) return null;
    const versions = blogCanvasVersionsByStep[resolvedCanvasStep] ?? [];
    if (!versions.length) return null;
    if (activeVersionId) {
      const matched = versions.find(version => version.id === activeVersionId);
      if (matched) return matched;
    }
    return versions[versions.length - 1];
  }, [resolvedCanvasStep, activeVersionId, blogCanvasVersionsByStep]);

  return {
    blogCanvasVersionsByStep,
    step7FromMessages,
    selectedVersionByStep,
    followLatestByStep,
    setSelectedVersionByStep,
    setFollowLatestByStep,
    canvasVersionsForStep,
    activeVersionId,
    activeCanvasVersion,
  };
}
