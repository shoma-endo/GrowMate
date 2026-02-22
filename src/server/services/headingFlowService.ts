import { SupabaseService, type SupabaseResult } from './supabaseService';
import { extractHeadingsFromMarkdown, generateHeadingKey } from '@/lib/heading-extractor';
import type { DbHeadingSection, DbSessionHeadingSectionInsert } from '@/types/heading-flow';

export class HeadingFlowService extends SupabaseService {
  /**
   * Step 5のテキストから見出しを抽出し、session_heading_sections を初期化する。
   * 仕様: すでに存在する場合は何もしない。
   */
  async initializeHeadingSections(
    sessionId: string,
    step5Markdown: string
  ): Promise<SupabaseResult<void>> {
    // 1. Step 5 から現在の見出し一覧を抽出
    const currentHeadings = extractHeadingsFromMarkdown(step5Markdown);
    if (currentHeadings.length === 0) return this.success(undefined);

    // 2. 既存セクションがある場合は正本を優先し、自動再同期しない
    const { data: existingRows, error: existingRowsError } = await this.supabase
      .from('session_heading_sections')
      .select('id')
      .eq('session_id', sessionId)
      .limit(1);
    if (existingRowsError) {
      return this.failure('既存見出しの確認に失敗しました', { error: existingRowsError });
    }
    if ((existingRows ?? []).length > 0) {
      return this.success(undefined);
    }

    // 3. 初回のみ現在の見出しを投入
    const sections: DbSessionHeadingSectionInsert[] = currentHeadings.map(h => ({
      session_id: sessionId,
      heading_key: generateHeadingKey(h.orderIndex, h.text),
      heading_level: h.level,
      heading_text: h.text,
      order_index: h.orderIndex,
      content: '',
      is_confirmed: false,
    }));

    const { error: insertError } = await this.supabase
      .from('session_heading_sections')
      .upsert(sections, { onConflict: 'session_id,heading_key', ignoreDuplicates: true });

    if (insertError) {
      return this.failure('見出しの同期に失敗しました', {
        error: insertError,
        context: { sessionId, headingCount: sections.length },
      });
    }

    return this.success(undefined);
  }

  /**
   * セッションに紐づく全ての見出しセクションを取得する。
   */
  async getHeadingSections(sessionId: string): Promise<SupabaseResult<DbHeadingSection[]>> {
    const { data, error } = await this.supabase
      .from('session_heading_sections')
      .select('*')
      .eq('session_id', sessionId)
      .order('order_index', { ascending: true });

    if (error) return this.failure('見出しセクションの取得に失敗しました', { error });
    return this.success(data ?? []);
  }

  /**
   * 見出しセクションの本文を保存し、確定状態にする。
   * 保存後、自動的に完成形の再結合を行う。
   */
  async saveHeadingSection(
    sessionId: string,
    headingKey: string,
    content: string,
    userId: string
  ): Promise<SupabaseResult<void>> {
    const { error: updateError, count } = await this.supabase
      .from('session_heading_sections')
      .update(
        {
          content,
          is_confirmed: true,
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' }
      )
      .eq('session_id', sessionId)
      .eq('heading_key', headingKey);

    if (updateError) return this.failure('セクションの保存に失敗しました', { error: updateError });
    if (count === 0) {
      return this.failure(
        '保存対象の見出しが見つかりませんでした。構成が更新された可能性があります。'
      );
    }

    // 完成形の再結合（失敗時はセクションは保存済みのため、リカバリ可能である旨を伝える）
    const combineResult = await this.combineSections(sessionId, userId);
    if (!combineResult.success) {
      return this.failure(
        'セクションは保存されましたが、完成形の更新に失敗しました。次の見出しを保存すると自動的に反映されます。',
        { context: { combineError: combineResult.error } }
      );
    }
    return this.success(undefined);
  }

  /**
   * 全セクションを order_index 順に連結し、session_combined_contents に保存する。
   */
  async combineSections(sessionId: string, userId: string): Promise<SupabaseResult<void>> {
    const sectionsResult = await this.getHeadingSections(sessionId);
    if (!sectionsResult.success) return sectionsResult;

    const sections = sectionsResult.data;
    // 確定済みのセクションのみを結合（未確定セクションは空コンテンツのため除外）
    const confirmedSections = sections.filter(s => s.is_confirmed);
    if (confirmedSections.length === 0) {
      return this.success(undefined);
    }

    const combinedContent = confirmedSections
      .map(s => {
        const hashes = '#'.repeat(s.heading_level);
        return `${hashes} ${s.heading_text}\n\n${s.content}`;
      })
      .join('\n\n');

    // 原子性を確保するため RPC (Database Function) を使用
    const { error: rpcError } = await this.supabase.rpc('save_atomic_combined_content', {
      p_session_id: sessionId,
      p_content: combinedContent,
      p_authenticated_user_id: userId,
    });

    if (rpcError) return this.failure('完成形の保存（RPC）に失敗しました', { error: rpcError });

    return this.success(undefined);
  }

  /**
   * 最新の完成形を取得する。
   */
  async getLatestCombinedContent(sessionId: string): Promise<SupabaseResult<string | null>> {
    const { data, error } = await this.supabase
      .from('session_combined_contents')
      .select('content')
      .eq('session_id', sessionId)
      .eq('is_latest', true)
      .maybeSingle();

    if (error) return this.failure('最新完成形の取得に失敗しました', { error });
    const content = data?.content ?? null;
    return this.success(content);
  }
}

export const headingFlowService = new HeadingFlowService();
