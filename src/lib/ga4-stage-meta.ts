import type { Ga4ConnectionStage } from '@/types/ga4';

export const GA4_STAGE_META: Record<Ga4ConnectionStage, { label: string; className: string }> = {
  unlinked: { label: '未連携', className: 'bg-gray-100 text-gray-800' },
  linked_unselected: { label: '連携済み未選択', className: 'bg-amber-100 text-amber-800' },
  configured: { label: '設定完了', className: 'bg-green-100 text-green-800 hover:bg-green-200' },
};
