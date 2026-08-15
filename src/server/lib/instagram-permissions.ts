import type { UserRole } from '@/types/user';

/**
 * Instagram 機能を利用できるロール（`docs/plans/instagram-integration-design.md` §7）。
 * 他の有料機能（`/setup/*`・`/analytics`）と同じ paid / admin に揃える。
 * `trial` は 2026-08-14 に対象外とした（Q4 の決定変更。同 §9 Q4）。
 *
 * App Review 期間中は環境変数 `INSTAGRAM_BETA_USER_IDS` による user_id allowlist を
 * 併用していたが、審査通過に伴い 2026-08-14 に撤去した（同 §4 Phase 2 item6）。
 * **露出を再び絞る手段はコードの revert とデプロイのみ**である点に注意
 * （Runbook `docs/runbooks/instagram-advanced-access-release-2026-08-14.md` §6）。
 */
const INSTAGRAM_ALLOWED_ROLES: UserRole[] = ['admin', 'paid'];

export function canAccessInstagram(role: UserRole | null): boolean {
  return Boolean(role && INSTAGRAM_ALLOWED_ROLES.includes(role));
}
