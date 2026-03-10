import { cache } from 'react';
import { z } from 'zod';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  PromptTemplate,
  CreatePromptTemplateInput,
  UpdatePromptTemplateInput,
  PromptTemplateWithVersions,
  PromptVariable,
  PromptVersion,
} from '@/types/prompt';
import type { AnnotationRecord } from '@/types/annotation';
import type { Database, Json } from '@/types/database.types';
import type { Profile, Service } from '@/server/schemas/brief.schema';

const PromptVariableSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const CreatePromptTemplateSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  content: z.string(),
  variables: z.array(PromptVariableSchema),
  created_by: z.string(),
});

/**
 * プロンプト管理サービス
 * React Cacheを活用した高速取得とバックグラウンド更新機能を提供
 */
export class PromptService extends SupabaseService {
  /**
   * 指定ユーザーの canonical_url 一覧を取得（重複排除・更新日時降順）
   */
  static async getCanonicalUrlsByUserId(userId: string): Promise<string[]> {
    const entries = await this.getCanonicalLinkEntriesByUserId(userId);
    return entries.map(entry => entry.canonical_url).filter(url => url.length > 0);
  }

  static async getCanonicalLinkEntriesByUserId(
    userId: string
  ): Promise<Array<{ canonical_url: string; wp_post_title: string }>> {
    return this.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('content_annotations')
          .select('canonical_url, wp_post_title')
          .eq('user_id', userId)
          .not('canonical_url', 'is', null)
          .order('updated_at', { ascending: false });

        if (error) {
          throw error;
        }

        const entries = (data || []).reduce<
          Array<{ canonical_url: string; wp_post_title: string }>
        >((acc, row: Pick<AnnotationRecord, 'canonical_url' | 'wp_post_title'>) => {
          const canonical = row.canonical_url ? row.canonical_url.trim() : '';
          if (!canonical) return acc;
          if (acc.some(entry => entry.canonical_url === canonical)) {
            return acc;
          }
          acc.push({
            canonical_url: canonical,
            wp_post_title: (row.wp_post_title || '').trim(),
          });
          return acc;
        }, []);

        return entries;
      },
      {
        logMessage: 'canonical_url 取得処理エラー:',
        onError: () => [],
      }
    );
  }

  /**
   * データベースから取得したJson型のvariablesをPromptVariable[]に変換
   */
  private static convertVariables(
    variables: Database['public']['Tables']['prompt_templates']['Row']['variables']
  ): PromptVariable[] {
    if (!variables) {
      return [];
    }
    if (!Array.isArray(variables)) {
      return [];
    }
    return (variables as unknown[])
      .map(v => {
        const result = PromptVariableSchema.safeParse(v);
        return result.success ? result.data : null;
      })
      .filter((v): v is PromptVariable => v !== null);
  }

  /**
   * データベースから取得したRow型をPromptTemplate型に変換
   */
  private static convertDbRowToPromptTemplate(
    row: Database['public']['Tables']['prompt_templates']['Row']
  ): PromptTemplate {
    return {
      id: row.id,
      name: row.name,
      display_name: row.display_name,
      content: row.content,
      variables: PromptService.convertVariables(row.variables),
      version: row.version ?? 1,
      created_by: row.created_by ?? '',
      updated_by: row.updated_by ?? undefined,
      created_at: row.created_at ?? '',
      updated_at: row.updated_at ?? '',
    };
  }

  /**
   * データベースから取得したPromptVersionのRow型をPromptVersion型に変換
   */
  private static convertDbRowToPromptVersion(
    row: Database['public']['Tables']['prompt_versions']['Row']
  ): PromptVersion {
    return {
      id: row.id,
      template_id: row.template_id ?? '',
      version: row.version,
      content: row.content,
      created_by: row.created_by ?? '',
      created_at: row.created_at ?? '',
    };
  }

  /**
   * ユーザー最新の content_annotations を1件取得
   */
  static async getLatestContentAnnotationByUserId(
    userId: string
  ): Promise<AnnotationRecord | null> {
    return this.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('content_annotations')
          .select(
            'canonical_url, wp_post_title, main_kw, kw, impressions, persona, needs, goal, prep, basic_structure, opening_proposal'
          )
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          throw error;
        }

        return data || null;
      },
      {
        logMessage: 'content_annotations 取得処理エラー:',
        onError: () => null,
      }
    );
  }

  /**
   * 指定ユーザー・セッションに紐づく content_annotations を1件取得
   * 2025-09 のマイグレーションで session_id が導入されたため、チャット中はこれを優先使用
   */
  static async getContentAnnotationBySession(
    userId: string,
    sessionId: string
  ): Promise<AnnotationRecord | null> {
    return this.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('content_annotations')
          .select(
            'canonical_url, wp_post_title, main_kw, kw, impressions, persona, needs, goal, prep, basic_structure, opening_proposal'
          )
          .eq('user_id', userId)
          .eq('session_id', sessionId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        return data || null;
      },
      {
        logMessage: 'content_annotations (by session) 取得処理エラー:',
        onError: () => null,
      }
    );
  }

  /**
   * 事業者プロフィールから置換用変数を作成
   */
  static buildProfileVariables(profile: Profile | null): Record<string, string> {
    if (!profile) return {};
    return {
      company: profile.company || '',
      address: profile.address || '',
      ceo: profile.ceo || '',
      hobby: profile.hobby || '',
      staff: profile.staff || '',
      staffHobby: profile.staffHobby || '',
      businessHours: profile.businessHours || '',
      holiday: profile.holiday || '',
      tel: profile.tel || '',
      license: profile.license || '',
      qualification: profile.qualification || '',
      capital: profile.capital || '',
      email: profile.email || '',
      payments: (profile.payments || []).join('、'),
      benchmarkUrl: profile.benchmarkUrl || '',
      competitorCopy: profile.competitorCopy || '',
    };
  }

  /**
   * 特定のサービス情報から置換用変数を作成（5W2H）
   */
  static buildServiceVariables(service: Service | null): Record<string, string> {
    if (!service) return {};
    return {
      serviceName: service.name || '',
      strength: service.strength || '',
      when: service.when || '',
      where: service.where || '',
      who: service.who || '',
      why: service.why || '',
      what: service.what || '',
      how: service.how || '',
      price: service.price || '',
    };
  }

  /**
   * content_annotations からテンプレ置換用の変数レコードを作成
   * テンプレ側は {{contentPersona}} / {{contentNeeds}} / {{contentGoal}}
   * {{contentMainKw}} / {{contentKw}} / {{contentImpressions}} を使用可能
   */
  static buildContentVariables(annotation: AnnotationRecord | null): Record<string, string> {
    if (!annotation) return {};
    return {
      contentPersona: annotation.persona || '',
      contentNeeds: annotation.needs || '',
      contentGoal: annotation.goal || '',
      contentMainKw: annotation.main_kw || '',
      contentKw: annotation.kw || '',
      contentImpressions: annotation.impressions || '',
      contentPrep: annotation.prep || '',
      contentBasicStructure: annotation.basic_structure || '',
      contentOpeningProposal: annotation.opening_proposal || '',
      wpPostTitle: annotation.wp_post_title || '',
      contentWpPostTitle: annotation.wp_post_title || '',
    };
  }
  /**
   * プロンプトテンプレートを名前で取得（キャッシュ付き）
   */
  static getTemplateByName = cache(async (name: string): Promise<PromptTemplate | null> => {
    return PromptService.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('prompt_templates')
          .select('*')
          .eq('name', name)
          .single();

        if (error && error.code !== 'PGRST116') {
          throw new Error(`プロンプト取得エラー: ${error.message}`);
        }

        return data ? PromptService.convertDbRowToPromptTemplate(data) : null;
      },
      {
        logMessage: 'プロンプト取得エラー:',
        onError: () => null,
      }
    );
  });

  /**
   * 全てのプロンプトテンプレートを取得
   */
  static async getAllTemplates(): Promise<PromptTemplate[]> {
    return this.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('prompt_templates')
          .select('*')
          .order('display_name', { ascending: true });

        if (error) {
          throw new Error(`プロンプト一覧取得エラー: ${error.message}`);
        }

        return (data || []).map(row => PromptService.convertDbRowToPromptTemplate(row));
      },
      {
        logMessage: 'プロンプト一覧取得エラー:',
        onError: () => [],
      }
    );
  }

  /**
   * プロンプトテンプレートをIDで取得
   */
  static async getTemplateById(id: string): Promise<PromptTemplate | null> {
    return this.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('prompt_templates')
          .select('*')
          .eq('id', id)
          .single();

        if (error && error.code !== 'PGRST116') {
          throw new Error(`プロンプト取得エラー: ${error.message}`);
        }

        return data ? PromptService.convertDbRowToPromptTemplate(data) : null;
      },
      {
        logMessage: 'プロンプトID取得エラー:',
        onError: () => null,
      }
    );
  }

  /**
   * プロンプトテンプレートとバージョン履歴を取得
   */
  static async getTemplateWithVersions(id: string): Promise<PromptTemplateWithVersions | null> {
    try {
      const template = await this.getTemplateById(id);
      if (!template) return null;

      const fallback = { ...template, versions: [] };

      return await this.withServiceRoleClient(
        async client => {
          const { data: versions, error } = await client
            .from('prompt_versions')
            .select('*')
            .eq('template_id', id)
            .order('version', { ascending: false });

          if (error) {
            throw error;
          }

          return {
            ...template,
            versions: (versions || []).map(row => PromptService.convertDbRowToPromptVersion(row)),
          };
        },
        {
          logLevel: 'warn',
          logMessage: 'バージョン履歴取得エラー:',
          onError: () => fallback,
        }
      );
    } catch (error) {
      console.error('プロンプト詳細取得エラー:', error);
      return null;
    }
  }

  /**
   * 新しいプロンプトテンプレートを作成
   */
  static async createTemplate(data: CreatePromptTemplateInput): Promise<PromptTemplate> {
    const now = new Date().toISOString();
    const validated = CreatePromptTemplateSchema.parse(data);

    const result = await this.withServiceRoleClient(
      async client => {
        // PromptVariable[] を Json 型に変換（型安全な変換）
        const variablesJson: Json = JSON.parse(JSON.stringify(validated.variables));

        const insertData: Database['public']['Tables']['prompt_templates']['Insert'] = {
          name: validated.name,
          display_name: validated.display_name,
          content: validated.content,
          variables: variablesJson,
          created_by: validated.created_by,
          created_at: now,
          updated_at: now,
        };
        const { data: inserted, error } = await client
          .from('prompt_templates')
          .insert(insertData)
          .select()
          .single();

        if (error) {
          throw new Error(`プロンプト作成エラー: ${error.message}`);
        }

        return PromptService.convertDbRowToPromptTemplate(inserted);
      },
      {
        logMessage: 'プロンプト作成エラー:',
      }
    );

    // 初期バージョンを履歴に保存
    await this.saveVersion(result.id, data.content, 1, data.created_by);

    return result;
  }

  /**
   * プロンプトテンプレートを更新
   */
  static async updateTemplate(
    id: string,
    data: UpdatePromptTemplateInput
  ): Promise<PromptTemplate> {
    // 現在のバージョンを取得
    const current = await this.getTemplateById(id);
    if (!current) {
      throw new Error('プロンプトが見つかりません');
    }

    // 内容に変更がある場合のみバージョンを上げる
    const hasContentChange = data.content && data.content !== current.content;
    const newVersion = hasContentChange ? current.version + 1 : current.version;

    // バージョン履歴を保存（内容が変更された場合のみ）
    if (hasContentChange && data.content) {
      await this.saveVersion(id, current.content, current.version, data.updated_by);
    }

    // メインテーブルを更新
    return this.withServiceRoleClient(
      async client => {
        // 更新データを明示的に構築（型安全）
        const updateData: Database['public']['Tables']['prompt_templates']['Update'] = {
          updated_by: data.updated_by,
          version: newVersion,
          updated_at: new Date().toISOString(),
        };

        // オプショナルフィールドを条件付きで追加
        if (data.name !== undefined) {
          updateData.name = data.name;
        }
        if (data.display_name !== undefined) {
          updateData.display_name = data.display_name;
        }
        if (data.content !== undefined) {
          updateData.content = data.content;
        }
        if (data.variables !== undefined) {
          // PromptVariable[] を Json 型に変換（型安全な変換）
          updateData.variables = JSON.parse(JSON.stringify(data.variables)) as Json;
        }

        const { data: result, error } = await client
          .from('prompt_templates')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          throw new Error(`プロンプト更新エラー: ${error.message}`);
        }

        return PromptService.convertDbRowToPromptTemplate(result);
      },
      {
        logMessage: 'プロンプト更新エラー:',
      }
    );
  }

  /**
   * バージョン履歴を保存
   */
  private static async saveVersion(
    templateId: string,
    content: string,
    version: number,
    createdBy: string
  ): Promise<void> {
    await this.withServiceRoleClient(
      async client => {
        const { error } = await client.from('prompt_versions').insert({
          template_id: templateId,
          version,
          content,
          created_by: createdBy,
          created_at: new Date().toISOString(),
        });

        if (error) {
          throw new Error(`バージョン履歴保存エラー: ${error.message}`);
        }
      },
      {
        logMessage: 'バージョン履歴保存エラー:',
      }
    );
  }

  /**
   * 全ユーザーのプロンプトキャッシュを無効化
   */
  static async invalidateAllCaches(): Promise<void> {
    // React Cacheは自動で無効化される（Next.js 15の機能）
    // 現時点ではサーバー側の明示的なキャッシュクリア処理は不要
  }

  /**
   * プロンプト変数を置換
   */
  static replaceVariables(template: string, variables: Record<string, string>): string {
    let result = template;

    // 置換状況を追跡
    const replacedKeys: string[] = [];

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      if (regex.test(result)) {
        replacedKeys.push(key);
      }
      result = result.replace(regex, value || '');
    }

    return result;
  }

  /**
   * プロンプトテンプレートの検証
   */
  static validateTemplate(template: PromptTemplate): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!template.name || template.name.trim().length === 0) {
      errors.push('プロンプト名は必須です');
    }

    if (!template.display_name || template.display_name.trim().length === 0) {
      errors.push('表示名は必須です');
    }

    if (!template.content || template.content.trim().length === 0) {
      errors.push('プロンプト内容は必須です');
    }

    // 変数の整合性チェック
    if (template.variables && template.variables.length > 0) {
      const contentVariables = template.content.match(/{{(\w+)}}/g) || [];
      const definedVariables = template.variables.map(v => `{{${v.name}}}`);

      const undefinedVariables = contentVariables.filter(v => !definedVariables.includes(v));
      if (undefinedVariables.length > 0) {
        errors.push(`未定義の変数があります: ${undefinedVariables.join(', ')}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
