import { SupabaseService } from '@/server/services/supabaseService';
import { PromptService } from '@/server/services/promptService';
import { llmChat } from '@/server/services/llmService';
import { MODEL_CONFIGS } from '@/lib/constants';
import type { GscEvaluationOutcome } from '@/types/gsc';
import { fetchWpPostContentWithCache } from '@/server/services/wordpressContentSync';

type SuggestionTemplate =
  | 'gsc_insight_ctr_boost'
  | 'gsc_insight_intro_refresh'
  | 'gsc_insight_body_rewrite'
  | 'gsc_insight_persona_rebuild';

interface GenerateParams {
  userId: string;
  contentAnnotationId: string;
  evaluationHistoryId: string;
  outcome: GscEvaluationOutcome;
  currentPosition: number | null;
  previousPosition: number | null;
  currentSuggestionStage: number; // 1-4
  jobToken: string;
  signal: AbortSignal;
}

class GscSuggestionService {
  private supabase = new SupabaseService();

  /**
   * 文字列が空白のみでないかチェック（UIと同じロジック）
   */
  private hasContent(value: string | null | undefined): boolean {
    return Boolean(value && value.trim().length > 0);
  }

  async generate(params: GenerateParams): Promise<void> {
    // outcome improved の場合は呼ばれない想定
    const annotation = await this.loadAnnotation(params.userId, params.contentAnnotationId);
    if (!annotation) {
      throw new Error('GSC改善提案の対象記事が見つかりません');
    }

    // ステージに応じた提案を決定（1→[1], 2→[1,2], 3→[1,2,3], 4→[1,2,3,4]）
    const stagesToRun = this.getStagesToRun(params.currentSuggestionStage);

    // 取得系（WordPress本文・タイトル・抜粋）
    const wpPost = await fetchWpPostContentWithCache({
      wpPostId: annotation.wp_post_id,
      cachedContent: annotation.wp_content_text,
      cachedExcerpt: annotation.wp_excerpt,
      userId: params.userId,
    });

    // 提案とスキップメッセージを格納（順序を維持）
    const orderedSuggestions: Array<{
      stage: number;
      templateName: SuggestionTemplate;
      label: string;
      task?: Promise<{ templateName: SuggestionTemplate; text: string } | null>;
      skipMessage?: string;
    }> = [];

    // ステージ1: スニペット改善（タイトル/説明文）
    if (stagesToRun.includes(1)) {
      const wpTitle = annotation.wp_post_title || wpPost?.title || null;
      const wpDescription = wpPost?.excerpt || null;

      if (this.hasContent(wpTitle) || this.hasContent(wpDescription)) {
        orderedSuggestions.push({
          stage: 1,
          templateName: 'gsc_insight_ctr_boost',
          label: MODEL_CONFIGS['gsc_insight_ctr_boost']?.label ?? 'gsc_insight_ctr_boost',
          task: this.runOne({
            templateName: 'gsc_insight_ctr_boost',
            variables: {
              // テンプレートの変数名は広告用だが、実体はWordPressのタイトル/説明を渡す
              adsHeadline: wpTitle || '',
              adsDescription: wpDescription || '',
              contentMainKw: annotation.main_kw || '',
              contentKw: annotation.kw || '',
              contentWpContentText: wpPost?.contentText || annotation.wp_content_text || '',
            },
            signal: params.signal,
          }),
        });
      } else {
        orderedSuggestions.push({
          stage: 1,
          templateName: 'gsc_insight_ctr_boost',
          label: MODEL_CONFIGS['gsc_insight_ctr_boost']?.label ?? 'gsc_insight_ctr_boost',
          skipMessage: 'WordPressタイトル・説明文の情報が存在しないためスキップされました',
        });
      }
    }

    // ステージ2: 導入文改善
    if (stagesToRun.includes(2)) {
      if (this.hasContent(annotation.opening_proposal)) {
        orderedSuggestions.push({
          stage: 2,
          templateName: 'gsc_insight_intro_refresh',
          label: MODEL_CONFIGS['gsc_insight_intro_refresh']?.label ?? 'gsc_insight_intro_refresh',
          task: this.runOne({
            templateName: 'gsc_insight_intro_refresh',
            variables: {
              openingProposal: annotation.opening_proposal || '',
            },
            signal: params.signal,
          }),
        });
      } else {
        orderedSuggestions.push({
          stage: 2,
          templateName: 'gsc_insight_intro_refresh',
          label: MODEL_CONFIGS['gsc_insight_intro_refresh']?.label ?? 'gsc_insight_intro_refresh',
          skipMessage: '書き出し案の情報が存在しないためスキップされました',
        });
      }
    }

    // ステージ3: 本文リライト
    if (stagesToRun.includes(3)) {
      if (this.hasContent(wpPost?.contentText)) {
        orderedSuggestions.push({
          stage: 3,
          templateName: 'gsc_insight_body_rewrite',
          label: MODEL_CONFIGS['gsc_insight_body_rewrite']?.label ?? 'gsc_insight_body_rewrite',
          task: this.runOne({
            templateName: 'gsc_insight_body_rewrite',
            variables: {
              wpContent: wpPost!.contentText!, // hasContent チェック済みなので null ではない
            },
            signal: params.signal,
          }),
        });
      } else {
        orderedSuggestions.push({
          stage: 3,
          templateName: 'gsc_insight_body_rewrite',
          label: MODEL_CONFIGS['gsc_insight_body_rewrite']?.label ?? 'gsc_insight_body_rewrite',
          skipMessage: '本文の情報が存在しないためスキップされました',
        });
      }
    }

    // ステージ4: ペルソナから全て変更
    if (stagesToRun.includes(4)) {
      if (this.hasContent(annotation.persona) || this.hasContent(annotation.needs)) {
        orderedSuggestions.push({
          stage: 4,
          templateName: 'gsc_insight_persona_rebuild',
          label:
            MODEL_CONFIGS['gsc_insight_persona_rebuild']?.label ?? 'gsc_insight_persona_rebuild',
          task: this.runOne({
            templateName: 'gsc_insight_persona_rebuild',
            variables: {
              persona: annotation.persona || '',
              contentNeeds: annotation.needs || '',
            },
            signal: params.signal,
          }),
        });
      } else {
        orderedSuggestions.push({
          stage: 4,
          templateName: 'gsc_insight_persona_rebuild',
          label:
            MODEL_CONFIGS['gsc_insight_persona_rebuild']?.label ?? 'gsc_insight_persona_rebuild',
          skipMessage: 'ペルソナまたはニーズ情報が存在しないためスキップされました',
        });
      }
    }

    // タスクを並列実行
    const tasksToRun = orderedSuggestions.filter(s => s.task).map(s => s.task!);
    const results = await Promise.allSettled(tasksToRun);
    const rejectedResult = results.find(result => result.status === 'rejected');
    if (rejectedResult?.status === 'rejected') {
      throw rejectedResult.reason;
    }

    // 結果をマージ（順序を維持）
    const sections: string[] = [];
    let resultIndex = 0;

    for (const suggestion of orderedSuggestions) {
      if (suggestion.task) {
        const result = results[resultIndex++];
        if (result && result.status === 'fulfilled' && result.value) {
          sections.push(`# ${suggestion.label}\n\n${result.value.text}`);
        }
      } else if (suggestion.skipMessage) {
        sections.push(`# ${suggestion.label}\n\n※ ${suggestion.skipMessage}`);
      }
    }

    if (sections.length === 0) {
      throw new Error('GSC改善提案を生成できませんでした');
    }

    const suggestionSummary = sections.join('\n\n---\n\n');
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('gsc_article_evaluation_history')
      .update({ suggestion_summary: suggestionSummary })
      .eq('id', params.evaluationHistoryId)
      .eq('user_id', params.userId)
      .eq('suggestion_status', 'processing')
      .eq('suggestion_job_token', params.jobToken)
      .select('id')
      .maybeSingle();
    if (error) {
      throw new Error(error.message || 'GSC改善提案の保存に失敗しました');
    }
    if (!data) {
      throw new Error('GSC改善提案ジョブが更新されたため、古い生成結果を破棄しました');
    }
  }

  /**
   * ステージに応じて実行する提案番号の配列を返す
   * @param currentStage 現在のステージ（1-4）
   * @returns 実行する提案番号の配列（例: stage=2 → [1, 2]）
   */
  private getStagesToRun(currentStage: number): number[] {
    return Array.from({ length: currentStage }, (_, i) => i + 1);
  }

  private async runOne({
    templateName,
    variables,
    signal,
  }: {
    templateName: SuggestionTemplate;
    variables: Record<string, string>;
    signal: AbortSignal;
  }): Promise<{ templateName: SuggestionTemplate; text: string } | null> {
    const template = await PromptService.getTemplateByName(templateName);
    if (!template) return null;

    const modelConfig = MODEL_CONFIGS[templateName];
    if (!modelConfig) return null;

    const filled = PromptService.replaceVariables(template.content, variables);
    const provider = modelConfig.provider;
    const model = modelConfig.actualModel;

    const fullText = await llmChat(provider, model, [{ role: 'user', content: filled }], {
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
      stream: modelConfig.stream,
      timeoutMs: 180000,
      signal,
    });

    return { templateName, text: fullText };
  }

  private async loadAnnotation(userId: string, annotationId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('content_annotations')
      .select(
        'id, wp_post_id, wp_post_title, opening_proposal, wp_content_text, wp_excerpt, persona, needs, main_kw, kw'
      )
      .eq('user_id', userId)
      .eq('id', annotationId)
      .maybeSingle();
    if (error) {
      console.error('[GscSuggestion] annotation fetch error', error);
      return null;
    }
    return data as {
      id: string;
      wp_post_id: number | null;
      wp_post_title: string | null;
      opening_proposal: string | null;
      wp_content_text: string | null;
      wp_excerpt: string | null;
      persona: string | null;
      needs: string | null;
      main_kw: string | null;
      kw: string | null;
    } | null;
  }
}

export const gscSuggestionService = new GscSuggestionService();
