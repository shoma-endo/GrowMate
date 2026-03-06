import { BlogStepId, STEP7_ID } from '@/lib/constants';

export interface HeadingCanvasViewModeParams {
  step: BlogStepId | null;
  headingCount: number;
  viewingHeadingIndex: number | null;
  activeHeadingIndex: number | undefined;
}

export interface HeadingCanvasViewMode {
  isViewingHeading: boolean;
  isCombinedView: boolean;
  isHeadingUnit: boolean;
  headingIndex: number | null;
}

export const resolveHeadingCanvasViewMode = ({
  step,
  headingCount,
  viewingHeadingIndex,
  activeHeadingIndex,
}: HeadingCanvasViewModeParams): HeadingCanvasViewMode => {
  const hasHeadings = step === STEP7_ID && headingCount > 0;
  const isViewingHeading = hasHeadings && viewingHeadingIndex !== null;
  const hasActiveHeading = activeHeadingIndex !== undefined;
  const isCombinedView = hasHeadings && !isViewingHeading && !hasActiveHeading;
  const isHeadingUnit = hasHeadings && (isViewingHeading || hasActiveHeading);
  const headingIndex = isHeadingUnit ? (viewingHeadingIndex ?? activeHeadingIndex ?? null) : null;

  return {
    isViewingHeading,
    isCombinedView,
    isHeadingUnit,
    headingIndex,
  };
};
