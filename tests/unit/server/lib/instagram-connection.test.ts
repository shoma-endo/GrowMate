/**
 * Instagram 連携状態と認可
 *
 * 連携状態の判定（`instagram-status`）、認可解除を検知した後の表現、
 * 機能の認可判定（`instagram-permissions`）。
 *
 * 元は1モジュール1ファイルに分かれていた。探すときの単位が
 * 「取込 / 連携状態」であってモジュール名ではないため、その単位でまとめている。
 * どのモジュールの検査かは外側の describe が示す。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { toInstagramConnectionStatus } from '@/server/lib/instagram-status';
import type { InstagramCredential } from '@/types/instagram';
import { resolveInstagramTokenAction } from '@/server/lib/instagram-token';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';

describe('@/server/lib/instagram-status', () => {
  const baseCredential: InstagramCredential = {
    igUserId: '17841400000000000',
    username: 'growmate_demo',
    accountType: 'BUSINESS',
    profilePictureUrl: null,
    accessToken: 'token',
    accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    accessTokenIssuedAt: '2026-01-01T00:00:00.000Z',
    scope: ['instagram_business_basic'],
    lastSyncedAt: null,
    backfillCursor: null,
    backfillCompletedAt: null,
  };

  describe('toInstagramConnectionStatus', () => {
    it('credential が null のとき未連携を返す', () => {
      expect(toInstagramConnectionStatus(null)).toEqual({ connected: false });
    });

    it('有効な credential のとき connected=true, needsReauth=false を返す', () => {
      expect(toInstagramConnectionStatus(baseCredential)).toEqual({
        connected: true,
        needsReauth: false,
        username: 'growmate_demo',
      });
    });

    it('期限切れ credential のとき needsReauth=true を返す', () => {
      const expiredCredential: InstagramCredential = {
        ...baseCredential,
        accessTokenExpiresAt: '2020-01-01T00:00:00.000Z',
      };

      // toInstagramConnectionStatus は now を引数に取らない（実時刻を見る）。
      // このケースは期限が 2020 年なので、いつ実行しても期限切れになる。
      expect(toInstagramConnectionStatus(expiredCredential)).toEqual({
        connected: true,
        needsReauth: true,
        username: 'growmate_demo',
      });
    });
  });
});

describe('認可解除の検知（instagram-status × instagram-token）', () => {
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
});

describe('@/server/lib/instagram-permissions', () => {
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
});
