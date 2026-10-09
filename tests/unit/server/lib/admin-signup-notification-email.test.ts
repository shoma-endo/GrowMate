import { describe, expect, it } from 'vitest';
import {
  buildAdminSignupNotificationEmail,
  parseAdminSignupNotificationRecipients,
  type AdminSignupNotificationUser,
} from '@/server/lib/admin-signup-notification-email';

const user: AdminSignupNotificationUser = {
  fullName: '山田太郎',
  email: 'taro@example.com',
  // 日本時間では 2026/10/10 08:05:09（UTC のままだと 10/9 になる）
  createdAt: '2026-10-09T23:05:09.000Z',
  role: 'unavailable',
};

describe('buildAdminSignupNotificationEmail', () => {
  it('件名に名前、本文に名前・メールアドレス・日本時間の登録日時・ユーザー一覧へのリンクを載せる', () => {
    const email = buildAdminSignupNotificationEmail('https://example.com', user);

    expect(email.subject).toBe('【GrowMate】新規ユーザーが登録しました：山田太郎');
    expect(email.html).toContain('<h1>新規ユーザーが登録しました</h1>');
    expect(email.html).toContain('山田太郎');
    expect(email.html).toContain('taro@example.com');
    expect(email.html).toContain('2026/10/10 08:05:09');
    expect(email.html).toContain('<a href="https://example.com/admin/users">GrowMate でユーザー一覧を開く</a>');
  });

  it.each([
    ['unavailable', true],
    ['paid', false],
  ] as const)('ロールが %s のとき「利用できません」の一文を載せるか: %s', (role, expected) => {
    const email = buildAdminSignupNotificationEmail('https://example.com', { ...user, role });

    expect(email.html.includes('権限を変更するまで、このユーザーは GrowMate を利用できません。')).toBe(expected);
  });

  it('名前の HTML はエスケープして埋め込む', () => {
    const email = buildAdminSignupNotificationEmail('https://example.com', { ...user, fullName: '<b>太郎</b>' });

    expect(email.html).toContain('&lt;b&gt;太郎&lt;/b&gt;');
    expect(email.html).not.toContain('<b>');
  });
});

describe('parseAdminSignupNotificationRecipients', () => {
  it.each([
    ['未設定', undefined, []],
    ['空白と空要素だけ', ' , ,', []],
    ['カンマ区切り', 'a@x.com, b@y.com', ['a@x.com', 'b@y.com']],
    ['空要素と末尾空白を含む', 'a@x.com,,b@y.com ', ['a@x.com', 'b@y.com']],
  ])('%s', (_label, raw, expected) => {
    expect(parseAdminSignupNotificationRecipients(raw)).toEqual(expected);
  });
});
