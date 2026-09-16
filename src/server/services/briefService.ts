import { cache } from 'react';
import { createHash } from 'crypto';
import { z } from 'zod';
import { SupabaseService } from '@/server/services/supabaseService';
import { briefInputSchema, storedPaymentSchema } from '@/server/schemas/brief.schema';
import type { BriefInput, Payment } from '@/server/schemas/brief.schema';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

/**
 * 新形式として保存された事業者情報が検証に落ちたときに投げる。
 * 旧形式変換で握り潰すと中身が空になったまま正常系として返ってしまうため、明示的に失敗させる。
 */
export class BriefDataFormatError extends Error {
  constructor() {
    super(ERROR_MESSAGES.BRIEF.INVALID_DATA_FORMAT);
    this.name = 'BriefDataFormatError';
  }
}

interface Brief {
  id: string;
  user_id: string;
  data: BriefInput;
  created_at: string | null;
  updated_at: string | null;
}

export class BriefService extends SupabaseService {

  /**
   * 型安全な文字列変換ヘルパー
   */
  private static asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * 型安全なPayment配列変換ヘルパー
   */
  private static asPaymentArray(value: unknown): Payment[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const validPayments: Payment[] = [];
    for (const item of value) {
      const result = storedPaymentSchema.safeParse(item);
      if (result.success) {
        validPayments.push(result.data);
      }
    }
    return validPayments.length > 0 ? validPayments : undefined;
  }

  /**
   * 決定論的なUUIDを生成（userIdと固定文字列から）
   * マイグレーション時に同じuserIdから常に同じIDを生成するため
   */
  private static generateDeterministicUUID(userId: string, seed: string = 'brief-service-migration'): string {
    const input = `${userId}:${seed}`;
    const hash = createHash('sha256').update(input).digest();
    
    // ハッシュの最初の16バイトをUUID形式に変換
    const bytes = Array.from(hash.slice(0, 16));
    // SHA-256は常に32バイトを返すため、slice(0, 16)は常に16バイトを返す
    if (bytes.length < 16) {
      throw new Error('ハッシュ生成に失敗しました');
    }
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // Version 4 variant
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // Variant bits
    
    const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  /**
   * 旧形式のデータを新形式に変換
   * @public - brief.actions.ts から呼び出される
   */
  public static migrateOldBriefToNew(oldData: unknown, userId: string): BriefInput {
    // すでに新形式かどうかをスキーマで検証
    const parseResult = briefInputSchema.safeParse(oldData);
    if (parseResult.success) {
      return parseResult.data;
    }

    const data = (oldData && typeof oldData === 'object' ? oldData : {}) as Record<string, unknown>;

    // 新形式のキーを持つデータを旧形式として読むと、旧形式にしか無いトップレベルキー
    // （data.company / data.service など）を引きに行くので profile と services が丸ごと
    // undefined になる。その結果は briefInputSchema を通ってしまうため、画面もプロンプトも
    // 無言で空になる（2026-08-26 の paymentEnum 変更で実際に発生）。
    // 旧形式変換の対象は、新形式のキーを持たないデータだけに限る。
    if ('profile' in data || 'services' in data) {
      console.error(
        '[BriefService] Stored brief is in the current shape but failed validation:',
        z.prettifyError(parseResult.error)
      );
      throw new BriefDataFormatError();
    }

    return {
      profile: {
        company: this.asString(data.company),
        address: this.asString(data.address),
        ceo: this.asString(data.ceo),
        hobby: this.asString(data.hobby),
        staff: this.asString(data.staff),
        staffHobby: this.asString(data.staffHobby),
        businessHours: this.asString(data.businessHours),
        holiday: this.asString(data.holiday),
        tel: this.asString(data.tel),
        license: this.asString(data.license),
        qualification: this.asString(data.qualification),
        capital: this.asString(data.capital),
        email: this.asString(data.email),
        payments: this.asPaymentArray(data.payments),
        benchmarkUrl: this.asString(data.benchmarkUrl),
        competitorCopy: this.asString(data.competitorCopy),
      },
      persona: this.asString(data.persona),
      services: [
        {
          id: this.generateDeterministicUUID(userId),
          name: this.asString(data.service) || 'サービス1',
          strength: this.asString(data.strength),
          when: this.asString(data.when),
          where: this.asString(data.where),
          who: this.asString(data.who),
          why: this.asString(data.why),
          what: this.asString(data.what),
          how: this.asString(data.how),
          price: this.asString(data.price),
        },
      ],
    };
  }

  /**
   * ユーザーIDで事業者情報を取得
   */
  async getByUserId(userId: string): Promise<Brief | null> {
    try {
      const client = this.getClient();
      const { data, error } = await client
        .from('briefs')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // レコードが見つからない場合（正常ケース）
          return null;
        }
        console.error('Brief取得エラー:', error);
        return null;
      }

      // dataフィールドをJson型から新形式に変換（必要に応じてマイグレーション）
      const briefData = BriefService.migrateOldBriefToNew(data.data || {}, userId);

      return {
        id: data.id,
        user_id: data.user_id,
        data: briefData,
        created_at: data.created_at ?? null,
        updated_at: data.updated_at ?? null,
      };
    } catch (error) {
      console.error('Brief取得例外:', error);
      return null;
    }
  }

  /**
   * React Cacheでキャッシュ化された取得関数
   * 同一リクエスト中は1回のみDB参照
   */
  getCachedByUserId = cache(async (userId: string): Promise<Brief | null> => {
    return this.getByUserId(userId);
  });

  /**
   * 事業者情報のデータ部分のみを取得
   * テンプレート変数置換用
   */
  async getVariablesByUserId(userId: string): Promise<BriefInput | null> {
    const brief = await this.getCachedByUserId(userId);
    return brief?.data ?? null;
  }

  /**
   * 全てのキャッシュをクリア
   */
  invalidateAllCaches(): void {
    // React Cacheの制限により、実際のクリアは次回リクエスト時
  }
}

export const briefService = new BriefService();
