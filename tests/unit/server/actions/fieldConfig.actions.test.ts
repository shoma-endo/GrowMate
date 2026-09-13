import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * フィールド構成保存の Server Action。
 *
 * 見るのは2点。
 *  1. `userId` をクライアントから受け取らず、サーバーのセッションから解決していること
 *  2. 列カタログに無いIDを弾くこと（DB側は `text[]` なので中身を検証できない）
 */

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  cookies: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  getEmailLinkConflictMessage: () => undefined,
}));
vi.mock('@/server/services/userTableFieldConfigService', () => ({
  userTableFieldConfigService: { upsert: mocks.upsert },
}));

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { saveFieldConfig } from '@/server/actions/fieldConfig.actions';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

describe('saveFieldConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({});
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'trial' } });
    mocks.upsert.mockResolvedValue(true);
  });

  it('セッションの userId で保存する（入力の userId は受け付けない）', async () => {
    const result = await saveFieldConfig({
      tableKey: 'analytics',
      visibleIds: ['main_kw'],
      orderedIds: ['main_kw', 'kw'],
    });

    expect(result).toEqual({ success: true });
    expect(mocks.upsert).toHaveBeenCalledWith({
      userId: USER_ID,
      tableKey: 'analytics',
      visibleIds: ['main_kw'],
      orderedIds: ['main_kw', 'kw'],
    });
  });

  it('ロールで拒否しない（既存の localStorage 保存と同じく全ロールが使える）', async () => {
    mocks.authMiddleware.mockResolvedValue({
      userId: USER_ID,
      userDetails: { role: 'unavailable' },
    });

    await expect(
      saveFieldConfig({ tableKey: 'analytics', visibleIds: [], orderedIds: [] })
    ).resolves.toEqual({ success: true });
  });

  it('全解除（空配列）を保存できる', async () => {
    await saveFieldConfig({ tableKey: 'analytics', visibleIds: [], orderedIds: ['main_kw'] });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ visibleIds: [], orderedIds: ['main_kw'] })
    );
  });

  it('列カタログに無いIDを弾く', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await saveFieldConfig({
      tableKey: 'analytics',
      visibleIds: ['main_kw', 'not_a_column'],
      orderedIds: ['main_kw'],
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('別一覧の列IDを混ぜられない（analytics に Instagram の列）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await saveFieldConfig({
      tableKey: 'analytics',
      visibleIds: ['reach'],
      orderedIds: [],
    });

    expect(result.success).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('未知の tableKey を弾く', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await saveFieldConfig({
      tableKey: 'users' as 'analytics',
      visibleIds: [],
      orderedIds: [],
    });

    expect(result.success).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('重複した列IDを弾く', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await saveFieldConfig({
      tableKey: 'analytics',
      visibleIds: ['main_kw', 'main_kw'],
      orderedIds: [],
    });

    expect(result.success).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('未認証（withAuth が throw）でも Error を漏らさず失敗結果を返す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.authMiddleware.mockResolvedValue({ userId: '', error: '認証に失敗しました' });

    const result = await saveFieldConfig({
      tableKey: 'analytics',
      visibleIds: [],
      orderedIds: [],
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.FIELD_CONFIG.SAVE_FAILED });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('保存失敗はユーザー向け文言で返す', async () => {
    mocks.upsert.mockResolvedValue(false);

    const result = await saveFieldConfig({
      tableKey: 'instagram_media',
      visibleIds: ['reach'],
      orderedIds: ['reach'],
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.FIELD_CONFIG.SAVE_FAILED });
  });
});
