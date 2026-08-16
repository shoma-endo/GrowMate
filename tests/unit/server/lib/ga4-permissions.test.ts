import { describe, expect, it } from 'vitest';

import { canAccessGa4, canWriteGa4 } from '@/server/lib/ga4-permissions';

describe.each([
  ['admin', true],
  ['paid', true],
  ['trial', false],
  ['unavailable', false],
  [null, false],
] as const)('GA4権限 (%s)', (role, expected) => {
  it('読み取り認可を判定する', () => {
    expect(canAccessGa4({ role })).toBe(expected);
  });

  it('書き込み認可を判定する', () => {
    expect(canWriteGa4({ role })).toBe(expected);
  });
});
