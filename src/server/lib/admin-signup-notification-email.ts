import { formatDateTimeWithSeconds } from '@/lib/date-utils';
import { sanitizeEmailHtml } from '@/server/lib/email-html';
import type { UserRole } from '@/types/user';

export interface AdminSignupNotificationUser {
  fullName: string;
  email: string;
  createdAt: string;
  role: UserRole;
}

export interface AdminSignupNotificationEmailContent {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 個々のアドレス形式は検証しない。不正な宛先は Resend のエラーとしてログに残す */
export function parseAdminSignupNotificationRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(address => address.trim())
    .filter(address => address.length > 0);
}

/** 登録日時は /admin/users の「登録日」と同じ表記にそろえる（送信時刻ではなく users.created_at） */
export function buildAdminSignupNotificationEmail(
  siteUrl: string,
  user: AdminSignupNotificationUser
): AdminSignupNotificationEmailContent {
  const usersHref = `${siteUrl}/admin/users`;
  const unavailableNote =
    user.role === 'unavailable'
      ? '<p>権限を変更するまで、このユーザーは GrowMate を利用できません。</p>'
      : '';
  const html = sanitizeEmailHtml(
    `<div><p>新しいユーザーが登録しました。</p><ul>` +
      `<li>名前: ${escapeHtml(user.fullName)}</li>` +
      `<li>メールアドレス: ${escapeHtml(user.email)}</li>` +
      `<li>登録日時: ${escapeHtml(formatDateTimeWithSeconds(user.createdAt))}</li>` +
      `</ul><p><a href="${escapeHtml(usersHref)}">ユーザー一覧を開く</a></p>${unavailableNote}</div>`
  );
  return { subject: `【GrowMate】新規ユーザー登録：${user.fullName}`, html };
}
