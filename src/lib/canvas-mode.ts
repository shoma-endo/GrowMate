import { BlogStepId, STEP7_ID } from '@/lib/constants';

interface HeadingCanvasViewModeParams {
  step: BlogStepId | null;
  headingCount: number;
  viewingHeadingIndex: number | null;
  activeHeadingIndex: number | undefined;
  ignoreActiveHeadingIndex?: boolean;
}

interface HeadingCanvasViewMode {
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
  ignoreActiveHeadingIndex = false,
}: HeadingCanvasViewModeParams): HeadingCanvasViewMode => {
  const hasHeadings = step === STEP7_ID && headingCount > 0;
  const isViewingHeading = hasHeadings && viewingHeadingIndex !== null;
  const hasActiveHeading = !ignoreActiveHeadingIndex && activeHeadingIndex !== undefined;
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
