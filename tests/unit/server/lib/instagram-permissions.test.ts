import { describe, expect, it } from 'vitest';

import { canAccessInstagram } from '@/server/lib/instagram-permissions';

describe('canAccessInstagram', () => {
  it('admin / paid は true', () => {
    expect(canAccessInstagram('admin')).toBe(true);
    expect(canAccessInstagram('paid')).toBe(true);
  });

  // Q4 の対象ロールは 2026-08-14 に admin / paid へ変更した（設計書 §9 Q4）。
  it('trial は false（他の有料機能と同じ扱い）', () => {
    expect(canAccessInstagram('trial')).toBe(false);
  });

  it('unavailable は false', () => {
    expect(canAccessInstagram('unavailable')).toBe(false);
  });

  it('ロール未解決（null）は false（フェイルクローズ）', () => {
    expect(canAccessInstagram(null)).toBe(false);
  });
});
