import type { UserRole } from '@/types/user';

/**
 * Instagram 機能を利用できるロール（`docs/plans/instagram-integration-design.md` §7）。
 * `unavailable` は `authMiddleware` / `proxy.ts` が先に弾くため、ここには含めない。
 *
 * App Review 期間中は環境変数 `INSTAGRAM_BETA_USER_IDS` による user_id allowlist を
 * 併用していたが、審査通過に伴い 2026-08-14 に撤去した（同 §4 Phase 2 item6）。
 * **露出を再び絞る手段はコードの revert とデプロイのみ**である点に注意
 * （Runbook `docs/runbooks/instagram-advanced-access-release-2026-08-14.md` §6）。
 */
const INSTAGRAM_ALLOWED_ROLES: UserRole[] = ['admin', 'paid', 'trial'];

export function canAccessInstagram(role: UserRole | null): boolean {
  return Boolean(role && INSTAGRAM_ALLOWED_ROLES.includes(role));
}
