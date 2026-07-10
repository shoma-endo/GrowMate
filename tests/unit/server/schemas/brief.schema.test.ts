import { describe, expect, it } from 'vitest';

import { briefInputSchema, paymentEnum } from '@/server/schemas/brief.schema';

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
