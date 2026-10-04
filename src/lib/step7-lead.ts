import type { ChatMessage } from '@/domain/interfaces/IChatService';
import { BASIC_STRUCTURE_PATTERN } from '@/lib/canvas-content';
import {
  MIN_LEAD_CONTENT_LENGTH,
  STEP6_MODEL_REGEX,
  STEP7_LEAD_MODEL,
  STRUCTURE_PATTERN_CHECK_LENGTH,
} from '@/lib/constants';

export function resolveStep6ToStep7Lead(msgs: ChatMessage[]) {
  let latestLead: { content: string; ts: number } | null = null;
  let latestStep6Lead: { content: string; ts: number } | null = null;
  let latestStep6Ts = 0;
  for (const m of msgs) {
    const ts = m?.timestamp?.getTime() ?? 0;
    if (m?.role === 'user' && m.model === STEP7_LEAD_MODEL) {
      const c = (m.content ?? '').trim();
      if (c && (!latestLead || ts >= latestLead.ts)) latestLead = { content: c, ts };
    } else if (m?.role === 'assistant' && m.model && STEP6_MODEL_REGEX.test(m.model)) {
      const content = (m.content ?? '').trim();
      if (
        content.length >= MIN_LEAD_CONTENT_LENGTH &&
        !BASIC_STRUCTURE_PATTERN.test(content.slice(0, STRUCTURE_PATTERN_CHECK_LENGTH))
      ) {
        if (!latestStep6Lead || ts >= latestStep6Lead.ts) {
          latestStep6Lead = { content, ts };
        }
      }
      if (content.length >= MIN_LEAD_CONTENT_LENGTH && ts >= latestStep6Ts)
        latestStep6Ts = ts;
    }
  }
  // step7_lead より新しい step6 がある場合は、古い保存済み書き出し案で誤遷移しないよう無効化する
  const isStep6LeadValid = (
    lead: { content: string; ts: number } | null
  ): lead is { content: string; ts: number } =>
    lead !== null && lead.ts === latestStep6Ts;

  const isLatestLeadValid =
    latestLead !== null &&
    (latestStep6Ts === 0 || latestLead.ts >= latestStep6Ts);

  const latestLeadTimestamp = latestLead?.ts ?? 0;

  if (isLatestLeadValid && latestLead) {
    return { saved: true, content: latestLead.content, latestLeadTimestamp };
  }
  if (isStep6LeadValid(latestStep6Lead)) {
    return { saved: true, content: latestStep6Lead.content, latestLeadTimestamp };
  }
  return { saved: false, content: null, latestLeadTimestamp };
}
