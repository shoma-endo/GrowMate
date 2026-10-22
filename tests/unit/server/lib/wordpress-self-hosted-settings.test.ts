import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

vi.mock('server-only', () => ({}));

const checkPublicHttpsUrlMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/lib/public-url-guard', async importOriginal => ({
  ...(await importOriginal<typeof import('@/server/lib/public-url-guard')>()),
  checkPublicHttpsUrl: checkPublicHttpsUrlMock,
}));

import { resolveSelfHostedSettingsInput } from '@/server/lib/wordpress-self-hosted-settings';
import type { SupabaseService } from '@/server/services/supabaseService';

const getWordPressSettingsByUserId = vi.fn();
const supabaseService = { getWordPressSettingsByUserId } as unknown as SupabaseService;

const savedSelfHosted = {
  wpType: 'self_hosted',
  wpSiteUrl: 'https://blog.example.com/',
  wpUsername: 'admin',
  wpApplicationPassword: 'saved-password',
};

describe('resolveSelfHostedSettingsInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPublicHttpsUrlMock.mockResolvedValue({ ok: true, url: new URL('https://blog.example.com') });
  });

  it('入力されたパスワードはそのまま使う', async () => {
    const result = await resolveSelfHostedSettingsInput(supabaseService, 'user-1', {
      wpSiteUrl: 'https://blog.example.com',
      wpUsername: 'admin',
      wpApplicationPassword: 'new-password',
    });
    expect(result).toEqual({
      ok: true,
      siteUrl: 'https://blog.example.com',
      username: 'admin',
      applicationPassword: 'new-password',
    });
    expect(getWordPressSettingsByUserId).not.toHaveBeenCalled();
  });

  it('パスワードが空なら、同じサイトURLの保存済みパスワードを使う', async () => {
    getWordPressSettingsByUserId.mockResolvedValue(savedSelfHosted);
    const result = await resolveSelfHostedSettingsInput(supabaseService, 'user-1', {
      wpSiteUrl: 'https://blog.example.com',
      wpUsername: 'editor',
      wpApplicationPassword: '',
    });
    expect(result).toEqual({
      ok: true,
      siteUrl: 'https://blog.example.com',
      username: 'editor',
      applicationPassword: 'saved-password',
    });
  });

  it('サイトURLを変えてパスワードが空なら、保存済みパスワードを新しい送り先に渡さない', async () => {
    getWordPressSettingsByUserId.mockResolvedValue(savedSelfHosted);
    const result = await resolveSelfHostedSettingsInput(supabaseService, 'user-1', {
      wpSiteUrl: 'https://attacker.example.net',
      wpUsername: 'admin',
    });
    expect(result).toEqual({
      ok: false,
      error: ERROR_MESSAGES.WORDPRESS.APPLICATION_PASSWORD_REQUIRED_FOR_NEW_SITE_URL,
    });
  });

  it('保存済みパスワードが無いのに空なら必須エラー', async () => {
    getWordPressSettingsByUserId.mockResolvedValue(null);
    const result = await resolveSelfHostedSettingsInput(supabaseService, 'user-1', {
      wpSiteUrl: 'https://blog.example.com',
      wpUsername: 'admin',
    });
    expect(result).toEqual({ ok: false, error: ERROR_MESSAGES.WORDPRESS.SELF_HOSTED_REQUIRED_FIELDS });
  });

  it('公開されていないサイトURLは保存させない', async () => {
    checkPublicHttpsUrlMock.mockResolvedValue({ ok: false, reason: 'private_address' });
    const result = await resolveSelfHostedSettingsInput(supabaseService, 'user-1', {
      wpSiteUrl: 'https://169.254.169.254',
      wpUsername: 'admin',
      wpApplicationPassword: 'x',
    });
    expect(result).toEqual({ ok: false, error: ERROR_MESSAGES.WORDPRESS.SITE_URL_NOT_PUBLIC });
  });

  it('名前解決に失敗したときは、URL の誤りではなく接続できないと伝える', async () => {
    checkPublicHttpsUrlMock.mockResolvedValue({ ok: false, reason: 'dns_failed' });
    const result = await resolveSelfHostedSettingsInput(supabaseService, 'user-1', {
      wpSiteUrl: 'https://blog.example.com',
      wpUsername: 'admin',
      wpApplicationPassword: 'x',
    });
    expect(result).toEqual({ ok: false, error: ERROR_MESSAGES.WORDPRESS.SITE_URL_UNREACHABLE });
  });

  it('保存するサイトURLは前後の空白を除いた値にする', async () => {
    getWordPressSettingsByUserId.mockResolvedValue({ ...savedSelfHosted, wpSiteUrl: 'https://blog.example.com' });
    const result = await resolveSelfHostedSettingsInput(supabaseService, 'user-1', {
      wpSiteUrl: ' https://blog.example.com ',
      wpUsername: 'admin',
    });
    expect(result).toMatchObject({ ok: true, siteUrl: 'https://blog.example.com' });
  });
});
