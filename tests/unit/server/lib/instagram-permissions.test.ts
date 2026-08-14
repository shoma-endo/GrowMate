import { describe, expect, it } from 'vitest';

import { canAccessInstagram } from '@/server/lib/instagram-permissions';

describe('canAccessInstagram', () => {
  it('admin / paid / trial は true', () => {
    expect(canAccessInstagram('admin')).toBe(true);
    expect(canAccessInstagram('paid')).toBe(true);
    expect(canAccessInstagram('trial')).toBe(true);
  });

  it('unavailable は false', () => {
    expect(canAccessInstagram('unavailable')).toBe(false);
  });

  it('ロール未解決（null）は false（フェイルクローズ）', () => {
    expect(canAccessInstagram(null)).toBe(false);
  });
});
