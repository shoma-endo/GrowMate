import { describe, expect, it } from 'vitest';

import { briefInputSchema, paymentEnum, storedPaymentSchema } from '@/server/schemas/brief.schema';

function createValidBrief() {
  return {
    profile: {},
    services: [
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        name: 'サービス',
      },
    ],
  };
}

describe('briefInputSchema', () => {
  it('serviceが1件あれば受理する', () => {
    expect(briefInputSchema.safeParse(createValidBrief()).success).toBe(true);
  });

  it('serviceが0件なら拒否する', () => {
    expect(
      briefInputSchema.safeParse({
        ...createValidBrief(),
        services: [],
      }).success
    ).toBe(false);
  });

  it('service IDがUUIDでなければ拒否する', () => {
    const input = createValidBrief();
    input.services[0]!.id = 'invalid-id';

    expect(briefInputSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ['不正URL', { benchmarkUrl: 'invalid-url' }],
    ['不正メール', { email: 'invalid-email' }],
    ['不正支払方法', { payments: ['暗号資産'] }],
  ])('%s を含むprofileを拒否する', (_label, profile) => {
    expect(
      briefInputSchema.safeParse({
        ...createValidBrief(),
        profile,
      }).success
    ).toBe(false);
  });
});

describe('paymentEnum', () => {
  it('定義済み支払方法を受理する', () => {
    expect(paymentEnum.safeParse('現金').success).toBe(true);
  });

  it('未定義の支払方法を拒否する', () => {
    expect(paymentEnum.safeParse('暗号資産').success).toBe(false);
  });
});

describe('storedPaymentSchema', () => {
  // 2026-08-26 に括弧を半角から全角へ変えたため、DB には半角括弧の値が残っている
  it('半角括弧で保存された値を全角へ正規化して受理する', () => {
    expect(storedPaymentSchema.parse('クレジットカード(VISA)')).toBe('クレジットカード（VISA）');
  });

  it('全角括弧の値はそのまま受理する', () => {
    expect(storedPaymentSchema.parse('クレジットカード（JCB）')).toBe('クレジットカード（JCB）');
  });

  it('未定義の支払方法は括弧を直しても拒否する', () => {
    expect(storedPaymentSchema.safeParse('クレジットカード(Discover)').success).toBe(false);
  });

  // 保存経路も briefInputSchema を通るので、開いて保存し直すと全角へ揃う（自己修復）
  it('旧表記の payments を含む profile を受理し、出力は全角へ揃う', () => {
    const result = briefInputSchema.safeParse({
      ...createValidBrief(),
      profile: { payments: ['現金', 'クレジットカード(Master)'] },
    });

    expect(result.success).toBe(true);
    expect(result.data?.profile.payments).toEqual(['現金', 'クレジットカード（Master）']);
  });

  it('paymentEnum.options は全角括弧の8件のまま（UI のチェックボックス描画元）', () => {
    expect(paymentEnum.options).toEqual([
      '現金',
      '銀行振込',
      'クレジットカード（VISA）',
      'クレジットカード（Master）',
      'クレジットカード（AMEX）',
      'クレジットカード（Diners）',
      'クレジットカード（JCB）',
      '分割払い',
    ]);
  });
});
