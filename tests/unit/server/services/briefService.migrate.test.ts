import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {},
}));

import { BriefDataFormatError, BriefService } from '@/server/services/briefService';

const USER_ID = '11111111-2222-3333-4444-555555555555';

function createStoredBrief(payments: string[]) {
  return {
    profile: {
      company: '株式会社サンプル',
      ceo: '山田太郎',
      payments,
    },
    persona: '30代〜50代の主婦・会社員。',
    services: [
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        name: 'エアコンクリーニング',
        price: '8,800円〜',
      },
    ],
  };
}

describe('BriefService.migrateOldBriefToNew', () => {
  it('半角括弧で保存された payments を全角へ正規化して読み込む', () => {
    const result = BriefService.migrateOldBriefToNew(
      createStoredBrief(['現金', 'クレジットカード(VISA)']),
      USER_ID
    );

    expect(result.profile.payments).toEqual(['現金', 'クレジットカード（VISA）']);
    expect(result.profile.company).toBe('株式会社サンプル');
    expect(result.services[0]?.name).toBe('エアコンクリーニング');
  });

  it('新形式が検証に失敗したら旧形式変換に落とさず失敗させる', () => {
    // 旧形式変換に回ると profile と services が空になり、正常系として返ってしまう
    expect(() =>
      BriefService.migrateOldBriefToNew(createStoredBrief(['暗号資産']), USER_ID)
    ).toThrow(BriefDataFormatError);
  });

  it('services が空でも旧形式変換に落とさず失敗させる', () => {
    const broken = { ...createStoredBrief(['現金']), services: [] };

    expect(() => BriefService.migrateOldBriefToNew(broken, USER_ID)).toThrow(BriefDataFormatError);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'not-an-object'],
  ])('%s を渡しても throw せず空の新形式を返す', (_label, input) => {
    const result = BriefService.migrateOldBriefToNew(input, USER_ID);

    expect(result.profile.company).toBeUndefined();
    expect(result.services).toHaveLength(1);
  });

  it('旧形式（トップレベルに旧キー）は従来どおり変換する', () => {
    const result = BriefService.migrateOldBriefToNew(
      {
        company: '旧形式カンパニー',
        service: 'ハウスクリーニング',
        payments: ['クレジットカード(JCB)'],
        persona: '共働き世帯',
      },
      USER_ID
    );

    expect(result.profile.company).toBe('旧形式カンパニー');
    expect(result.profile.payments).toEqual(['クレジットカード（JCB）']);
    expect(result.services[0]?.name).toBe('ハウスクリーニング');
    expect(result.persona).toBe('共働き世帯');
  });
});
