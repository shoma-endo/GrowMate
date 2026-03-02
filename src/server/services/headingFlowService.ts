import { SupabaseService, type SupabaseResult } from './supabaseService';
import {
  extractHeadingsFromMarkdown,
  generateHeadingKey,
} from '@/lib/heading-extractor';
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
      .upsert(sections, { onConflict: 'session_id,heading_key' });

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
   */
  async saveHeadingSection(
    sessionId: string,
    headingKey: string,
    content: string
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

    const sectionContents = confirmedSections
      .map(s => {
        const hashes = '#'.repeat(s.heading_level);
        return `${hashes} ${s.heading_text}\n\n${s.content}`;
      })
      .join('\n\n');

    // Step6 の書き出し案（リード）を取得して先頭に結合
    const step6Lead = await this.getStep6Lead(sessionId);
    const combinedContent = step6Lead ? `${step6Lead}\n\n${sectionContents}` : sectionContents;

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
   * 全文Canvas編集後の完成形を session_combined_contents に保存する。
   */
  async saveCombinedContentSnapshot(
    sessionId: string,
    content: string,
    userId: string
  ): Promise<SupabaseResult<void>> {
    if (!content.trim()) {
      return this.failure('完成形本文が空のため保存できません');
    }

    const { error: rpcError } = await this.supabase.rpc('save_atomic_combined_content', {
      p_session_id: sessionId,
      p_content: content,
      p_authenticated_user_id: userId,
    });

    if (rpcError) {
      return this.failure('完成形の保存（RPC）に失敗しました', { error: rpcError });
    }

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

  /**
   * 完成形の全バージョン一覧を取得する（version_no 降順）。
   * バージョン管理UI用。
   */
  async getCombinedContentVersions(
    sessionId: string
  ): Promise<
    SupabaseResult<Array<{ id: string; version_no: number; content: string; is_latest: boolean }>>
  > {
    const { data, error } = await this.supabase
      .from('session_combined_contents')
      .select('id, version_no, content, is_latest')
      .eq('session_id', sessionId)
      .order('version_no', { ascending: false });

    if (error) {
      return this.failure('完成形バージョン一覧の取得に失敗しました', { error });
    }
    return this.success(data ?? []);
  }
  /**
   * Step6 の最新書き出し案を取得する。
   */
  private async getStep6Lead(sessionId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('content')
      .eq('session_id', sessionId)
      .eq('role', 'assistant')
      .like('model', 'blog_creation_step6%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.content) return null;

    const candidate = data.content.trim();
    if (!candidate) return null;

    const firstLine = candidate.split('\n')[0]?.trim() ?? '';
    // 互換対応: 旧 step6 見出しフロー本文（###/#### 始まり）はリード文として結合しない。
    if (/^#{3,4}\s+.+$/.test(firstLine)) {
      return null;
    }

    return candidate;
  }

  /**
   * セッションに紐づく見出し構成データを初期化（全削除）する。
   */
  async resetHeadingSections(sessionId: string): Promise<SupabaseResult<void>> {
    // 見出しセクションを削除
    const { error: deleteSectionsError } = await this.supabase
      .from('session_heading_sections')
      .delete()
      .eq('session_id', sessionId);

    if (deleteSectionsError) {
      return this.failure('見出し構成の削除に失敗しました', { error: deleteSectionsError });
    }

    return this.success(undefined);
  }
}

export const headingFlowService = new HeadingFlowService();
