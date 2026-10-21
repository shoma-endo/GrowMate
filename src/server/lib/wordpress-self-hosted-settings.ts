import 'server-only';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { normalizeWordPressSiteUrl } from '@/lib/wordpress-link';
import { checkPublicHttpsUrl, siteUrlRejectMessage } from '@/server/lib/public-url-guard';
import type { SupabaseService } from '@/server/services/supabaseService';

/**
 * セルフホスト WordPress の保存内容を決める。
 * パスワード欄は保存済みの値をブラウザへ返さないので、空欄なら保存済みを使う。
 * ただしサイトURLを変えたときは、保存済みのパスワードを新しい送り先へ渡さないよう再入力を求める。
 */
export async function resolveSelfHostedSettingsInput(
  supabaseService: SupabaseService,
  userId: string,
  input: { wpSiteUrl?: string | undefined; wpUsername?: string | undefined; wpApplicationPassword?: string | undefined }
): Promise<
  | { ok: true; siteUrl: string; username: string; applicationPassword: string }
  | { ok: false; error: string }
> {
  const siteUrl = input.wpSiteUrl ?? '';
  const username = input.wpUsername ?? '';
  if (!siteUrl || !username) {
    return { ok: false, error: ERROR_MESSAGES.WORDPRESS.SELF_HOSTED_REQUIRED_FIELDS };
  }

  const urlCheck = await checkPublicHttpsUrl(siteUrl);
  if (!urlCheck.ok) {
    return { ok: false, error: siteUrlRejectMessage(urlCheck.reason) };
  }

  if (input.wpApplicationPassword) {
    return { ok: true, siteUrl, username, applicationPassword: input.wpApplicationPassword };
  }

  const saved = await supabaseService.getWordPressSettingsByUserId(userId);
  if (saved?.wpType !== 'self_hosted' || !saved.wpApplicationPassword) {
    return { ok: false, error: ERROR_MESSAGES.WORDPRESS.SELF_HOSTED_REQUIRED_FIELDS };
  }
  if (normalizeWordPressSiteUrl(saved.wpSiteUrl ?? '') !== normalizeWordPressSiteUrl(siteUrl)) {
    return { ok: false, error: ERROR_MESSAGES.WORDPRESS.APPLICATION_PASSWORD_REQUIRED_FOR_NEW_SITE_URL };
  }
  return { ok: true, siteUrl, username, applicationPassword: saved.wpApplicationPassword };
}
