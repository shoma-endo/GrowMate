import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// instagramService は `import 'server-only'` を持つ。vitest の node 環境では
// 実体が throw するため、空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import { InstagramService } from '@/server/services/instagramService';
import { isInstagramProfessionalAccount } from '@/types/instagram';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// InstagramService は constructor で env を読むため、stubEnv 後に生成する。
const createService = () => {
  vi.stubEnv('INSTAGRAM_APP_ID', 'test-app-id');
  vi.stubEnv('INSTAGRAM_APP_SECRET', 'test-app-secret');
  vi.stubEnv('INSTAGRAM_REDIRECT_URI', 'https://example.com/api/instagram/oauth/callback');
  return new InstagramService();
};

describe('InstagramService.exchangeCodeForTokens', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // 本番で発生した回帰。公式レスポンスは data 配列でラップされ expires_in を含まない。
  it('data 配列でラップされたレスポンスから access_token と user_id を取り出す', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            access_token: 'IGAA-short-lived',
            user_id: 1020,
            permissions: 'instagram_business_basic,instagram_business_manage_insights',
          },
        ],
      })
    );

    await expect(createService().exchangeCodeForTokens('auth-code')).resolves.toEqual({
      accessToken: 'IGAA-short-lived',
      igUserId: '1020',
    });
  });

  it('data ラップが無いレスポンスでもトップレベルから取り出す', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'IGAA-short-lived', user_id: '1020' })
    );

    await expect(createService().exchangeCodeForTokens('auth-code')).resolves.toEqual({
      accessToken: 'IGAA-short-lived',
      igUserId: '1020',
    });
  });

  it('HTTP エラー時はステータス付きで throw する', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error_type: 'OAuthException', code: 400, error_message: 'Invalid code' }, 400)
    );

    await expect(createService().exchangeCodeForTokens('auth-code')).rejects.toThrow(
      /Instagram API error: HTTP 400/
    );
  });

  it('access_token / user_id が欠けている場合は空文字で成功させず throw する', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await expect(createService().exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Instagram token exchange response missing access_token or user_id'
    );
  });
});

describe('InstagramService.exchangeForLongLivedToken', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // 短命交換とは逆に、長命交換のレスポンスは expires_in を含む契約。
  it('expires_in を含むトップレベルのレスポンスを読む', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'IGAA-long-lived', token_type: 'bearer', expires_in: 5184000 })
    );

    await expect(
      createService().exchangeForLongLivedToken('IGAA-short-lived')
    ).resolves.toEqual({ accessToken: 'IGAA-long-lived', expiresIn: 5184000 });
  });

  it('expires_in が欠けている場合は throw する', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'IGAA-long-lived' }));

    await expect(createService().exchangeForLongLivedToken('IGAA-short-lived')).rejects.toThrow(
      'Instagram long-lived token exchange response missing or invalid expires_in'
    );
  });
});

describe('isInstagramProfessionalAccount', () => {
  // 公式ドキュメント表記は Business / Media_Creator、旧 API は全大文字。
  it.each(['Business', 'BUSINESS', 'Media_Creator', 'MEDIA_CREATOR'])(
    '%s をプロフェッショナルアカウントと判定する',
    accountType => {
      expect(isInstagramProfessionalAccount(accountType)).toBe(true);
    }
  );

  it.each(['PERSONAL', 'Personal', '', null, undefined])('%s を弾く', accountType => {
    expect(isInstagramProfessionalAccount(accountType)).toBe(false);
  });
});
