import { MODEL_CONFIGS } from '@/lib/constants';
import { GSC_EVALUATION_OUTCOME_CONFIG } from '@/types/gsc';
import type { GscEvaluationHistoryItem } from '../../types';

const TEMPLATE_ORDER = [
  'gsc_insight_ctr_boost',
  'gsc_insight_intro_refresh',
  'gsc_insight_body_rewrite',
  'gsc_insight_persona_rebuild',
] as const;

type SuggestionTemplateName = (typeof TEMPLATE_ORDER)[number];

const TEMPLATE_LABEL_MAP: Record<string, SuggestionTemplateName> = {
  [MODEL_CONFIGS.gsc_insight_ctr_boost?.label ?? 'タイトル・説明文の提案']: 'gsc_insight_ctr_boost',
  [MODEL_CONFIGS.gsc_insight_intro_refresh?.label ?? '書き出し案の提案']:
    'gsc_insight_intro_refresh',
  [MODEL_CONFIGS.gsc_insight_body_rewrite?.label ?? '本文の提案']: 'gsc_insight_body_rewrite',
  [MODEL_CONFIGS.gsc_insight_persona_rebuild?.label ?? 'ペルソナから全て変更']:
    'gsc_insight_persona_rebuild',
};

export interface ParsedSuggestionSection {
  templateName: SuggestionTemplateName;
  label: string;
  content: string;
}

export interface EvaluationHistoryViewState {
  isNoMetrics: boolean;
  isError: boolean;
  showUnreadBadge: boolean;
  canMarkAsRead: boolean;
  statusLabel: string;
  statusClassName: string;
}

export function getEvaluationHistoryState(
  item: GscEvaluationHistoryItem
): EvaluationHistoryViewState {
  const isNoMetrics = item.outcomeType === 'error' && item.errorCode === 'no_metrics';
  const isError = item.outcomeType === 'error' && !isNoMetrics;
  const canMarkAsRead =
    item.outcomeType !== 'error' && item.outcome !== null && item.outcome !== 'improved';

  if (isError) {
    return {
      isNoMetrics,
      isError,
      showUnreadBadge: false,
      canMarkAsRead: false,
      statusLabel: '評価失敗',
      statusClassName:
        'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset bg-red-50 text-red-700 ring-red-600/20',
    };
  }

  if (isNoMetrics) {
    return {
      isNoMetrics,
      isError,
      showUnreadBadge: false,
      canMarkAsRead: false,
      statusLabel: 'データ未取得',
      statusClassName:
        'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset bg-gray-50 text-gray-700 ring-gray-500/10',
    };
  }

  const outcomeConfig =
    item.outcome !== null ? GSC_EVALUATION_OUTCOME_CONFIG[item.outcome] : null;

  if (!outcomeConfig) {
    return {
      isNoMetrics,
      isError,
      showUnreadBadge: false,
      canMarkAsRead,
      statusLabel: 'データなし',
      statusClassName:
        'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset bg-gray-50 text-gray-700 ring-gray-500/10',
    };
  }

  return {
    isNoMetrics,
    isError,
    showUnreadBadge: canMarkAsRead && !item.is_read,
    canMarkAsRead,
    statusLabel: outcomeConfig.label,
    statusClassName: `inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ring-gray-500/10 ${outcomeConfig.className ?? 'bg-gray-50 text-gray-700'}`,
  };
}

export function parseSuggestionSections(summary: string): ParsedSuggestionSection[] {
  const sections = summary.split('\n\n---\n\n');

  return sections
    .map(section => {
      const headingMatch = section.match(/^#\s+(.+)$/m);
      const heading = headingMatch?.[1]?.trim() ?? null;
      const templateName = heading ? TEMPLATE_LABEL_MAP[heading] : null;
      const content = heading ? section.replace(/^#\s+.+$/m, '').trim() : section.trim();

      if (!templateName || content.length === 0) {
        return null;
      }

      return {
        templateName,
        label: heading ?? MODEL_CONFIGS[templateName]?.label ?? templateName,
        content,
      };
    })
    .filter((section): section is ParsedSuggestionSection => section !== null)
    .sort(
      (a, b) => TEMPLATE_ORDER.indexOf(a.templateName) - TEMPLATE_ORDER.indexOf(b.templateName)
    );
}
