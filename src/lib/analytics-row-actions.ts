interface AnalyticsRowActionsInput {
  annotationId: string | null | undefined;
  sessionId: string | null | undefined;
  wpPostId: number | null | undefined;
  wpPostStatus: string | null | undefined;
  hasUnreadSuggestion: boolean;
}

interface AnalyticsRowActions {
  canPublishToWordPress: boolean;
  /** 未読の改善提案がある行は、ベル付きの「詳細」を「…」の外に出して気づけるようにする */
  detailPlacement: 'row' | 'menu' | null;
}

export function getAnalyticsRowActions({
  annotationId,
  sessionId,
  wpPostId,
  wpPostStatus,
  hasUnreadSuggestion,
}: AnalyticsRowActionsInput): AnalyticsRowActions {
  const canPublishToWordPress =
    Boolean(annotationId && sessionId) &&
    (wpPostId == null || wpPostStatus === 'draft' || wpPostStatus === 'future');
  const detailPlacement = !annotationId ? null : hasUnreadSuggestion ? 'row' : 'menu';
  return { canPublishToWordPress, detailPlacement };
}
