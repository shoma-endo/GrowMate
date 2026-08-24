import { SupabaseService } from '@/server/services/supabaseService';
import { asPendingClient, type Ga4ContentEvaluationCycleDatabase } from '@/types/database.types.pending';
import { ga4ContentEvaluationService } from '@/server/services/ga4ContentEvaluationService';
import { getGa4EvaluationDateRange } from '@/lib/ga4-evaluation-period';
import type {
  Ga4ContentEvaluationCycleRegisterInput,
  Ga4ContentEvaluationCycleUpdateInput,
} from '@/server/schemas/ga4ContentEvaluationCycle.schema';
import type { Ga4ContentEvaluationCycleView } from '@/types/ga4-evaluation-cycle';

type Ga4ContentEvaluationCycleRow =
  Ga4ContentEvaluationCycleDatabase['public']['Tables']['ga4_content_evaluation_cycles']['Row'];

function toView(row: Ga4ContentEvaluationCycleRow): Ga4ContentEvaluationCycleView {
  return {
    id: row.id,
    baseEvaluationDate: row.base_evaluation_date,
    cycleDays: row.cycle_days,
    evaluationHour: row.evaluation_hour,
    status: row.status,
    lastEvaluatedOn: row.last_evaluated_on,
    lastSeenContentScore: row.last_seen_content_score,
    nextEvaluationDate: row.next_evaluation_date,
    lastNotificationStatus: row.last_notification_status,
    lastNotifiedAt: row.last_notified_at,
  };
}

class ArticleNotFoundError extends Error {
  code = 'article_not_found';
}
class CycleAlreadyRegisteredError extends Error {
  code = 'cycle_already_registered';
}
class CycleNotFoundError extends Error {
  code = 'cycle_not_found';
}

class Ga4ContentEvaluationCycleService extends SupabaseService {
  private pendingClient() {
    return asPendingClient<Ga4ContentEvaluationCycleDatabase>(this.getClient());
  }

  async fetchCycle(userId: string, annotationId: string): Promise<Ga4ContentEvaluationCycleView | null> {
    const { data, error } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .select('*')
      .eq('user_id', userId)
      .eq('content_annotation_id', annotationId)
      .maybeSingle();
    if (error) throw error;
    return data ? toView(data) : null;
  }

  async registerCycle(
    userId: string,
    input: Ga4ContentEvaluationCycleRegisterInput
  ): Promise<Ga4ContentEvaluationCycleView> {
    await this.assertOwnedAnnotation(userId, input.annotationId);

    const existing = await this.fetchCycleRow(userId, input.annotationId);
    if (existing) throw new CycleAlreadyRegisteredError('cycle already registered');

    const { data: inserted, error: insertError } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .insert({
        user_id: userId,
        content_annotation_id: input.annotationId,
        base_evaluation_date: input.baseEvaluationDate,
        cycle_days: input.cycleDays,
        evaluation_hour: input.evaluationHour,
        status: 'active',
      })
      .select('*')
      .single();
    if (insertError) throw insertError;

    // D10: 登録時にベースラインを取得する。通常の評価実行(run())をそのまま呼び、
    // 履歴行も通常どおり作成する(§6.6.2 実装時訂正)。失敗しても登録自体は成立させる
    // (GA4未同期・needs_reauth等は外部要因であり、記事詳細から後で手動評価できる)。
    let baselineScore: number | null = null;
    try {
      const { startDate, endDate } = getGa4EvaluationDateRange();
      const baseline = await ga4ContentEvaluationService.run({
        userId,
        annotationId: input.annotationId,
        startDate,
        endDate,
      });
      baselineScore = baseline.history[0]?.contentScore ?? null;
    } catch (error) {
      console.error('[ga4ContentEvaluationCycleService] baseline evaluation failed', {
        annotationId: input.annotationId,
        code: error instanceof Error ? error.name : 'unknown',
      });
    }

    const { data: updated, error: updateError } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .update({ last_seen_content_score: baselineScore })
      .eq('id', inserted.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    return toView(updated);
  }

  async updateCycle(
    userId: string,
    input: Ga4ContentEvaluationCycleUpdateInput
  ): Promise<Ga4ContentEvaluationCycleView> {
    await this.assertOwnedAnnotation(userId, input.annotationId);

    const existing = await this.fetchCycleRow(userId, input.annotationId);
    if (!existing) throw new CycleNotFoundError('cycle not found');

    const { data: updated, error: updateError } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .update({
        base_evaluation_date: input.baseEvaluationDate,
        cycle_days: input.cycleDays,
        evaluation_hour: input.evaluationHour,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    return toView(updated);
  }

  private async fetchCycleRow(userId: string, annotationId: string) {
    const { data, error } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .select('id')
      .eq('user_id', userId)
      .eq('content_annotation_id', annotationId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  private async assertOwnedAnnotation(userId: string, annotationId: string): Promise<void> {
    const { data, error } = await this.getClient()
      .from('content_annotations')
      .select('id')
      .eq('id', annotationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ArticleNotFoundError('article not found');
  }
}

export const ga4ContentEvaluationCycleService = new Ga4ContentEvaluationCycleService();
