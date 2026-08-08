import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { toInstagramConnectionStatus } from '@/server/lib/instagram-status';
import { resolveInstagramTokenAction } from '@/server/lib/instagram-token';
import type { InstagramCredential } from '@/types/instagram';

/**
 * Instagram 側でアプリの認可を解除されたときの表現を固定するテスト。
 *
 * 解除されると保存済みトークンは即座に無効になるが `access_token_expires_at` は
 * 未来のままなので、`/setup`（DB の期限だけを見る）は「連携済み」、
 * `/setup/instagram`（実 API を叩く）は「要再認証」と食い違っていた。
 *
 * 修正では検知時点で期限を現在時刻へ落とす（instagramSetup.actions.ts の
 * markInstagramCredentialExpired）。ここではその「落とした後の状態」が
 * 両方の判定経路で要再認証になることを固定する。専用カラムを増やさず
 * 既存の「期限が過去 = 要再認証」表現に合わせた設計なので、
 * この前提が崩れると表示の食い違いが再発する。
 */

const NOW = new Date('2026-08-02T12:00:00.000Z');

const revokedCredential: InstagramCredential = {
  igUserId: '17841400105355861',
  username: 'manbou536',
  accountType: 'MEDIA_CREATOR',
  profilePictureUrl: null,
  accessToken: 'revoked-token',
  // markInstagramCredentialExpired が書き込む値＝検知した瞬間の現在時刻
  accessTokenExpiresAt: NOW.toISOString(),
  accessTokenIssuedAt: '2026-08-01T01:31:39.000Z',
  scope: ['instagram_business_basic', 'instagram_business_manage_insights'],
  lastSyncedAt: null,
  backfillCursor: null,
  backfillCompletedAt: null,
};

describe('認可解除を検知して期限を現在時刻へ落とした credential', () => {
  // toInstagramConnectionStatus は now を引数に取らず実時刻を見るため、
  // 「期限＝ちょうど今」を検証するには時計を固定する必要がある。
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('/setup 側の判定で needsReauth=true になる', () => {
    expect(toInstagramConnectionStatus(revokedCredential)).toEqual({
      connected: true,
      needsReauth: true,
      username: 'manbou536',
    });
  });

  it('連携済み扱いは維持する（未連携に落とさない）', () => {
    // 未連携に落とすと「再連携してください」の導線が消えるため、
    // connected は true のままであることを固定する。
    expect(toInstagramConnectionStatus(revokedCredential).connected).toBe(true);
  });

  it('トークンサービスがリフレッシュを試みず needs_reauth を返す', () => {
    // 無効化されたトークンのリフレッシュは必ず失敗するので、
    // 試行せずに再認証へ倒すこと。
    expect(resolveInstagramTokenAction(revokedCredential, NOW)).toBe('needs_reauth');
  });

  it('期限が未来のままだと食い違いが再発することを示す', () => {
    const stale: InstagramCredential = {
      ...revokedCredential,
      accessTokenExpiresAt: '2026-10-01T01:56:41.827Z',
    };

    // 修正前の状態。/setup は連携済みと表示し続けてしまう。
    expect(toInstagramConnectionStatus(stale).needsReauth).toBe(false);
    expect(resolveInstagramTokenAction(stale, NOW)).toBe('reuse');
  });
});
