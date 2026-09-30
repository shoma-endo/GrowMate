import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getBrief: vi.fn(),
  getValidatedBriefByUserId: vi.fn(),
  getChatSessionById: vi.fn(),
  getHeadingSections: vi.fn(),
}));

vi.mock('@/server/middleware/auth.middleware', () => ({ authMiddleware: mocks.authMiddleware }));
vi.mock('@/server/actions/brief.actions', () => ({ getBrief: mocks.getBrief }));
vi.mock('@/server/services/briefService', () => ({
  briefService: { getValidatedBriefByUserId: mocks.getValidatedBriefByUserId },
}));
vi.mock('@/server/services/headingFlowService', () => ({
  headingFlowService: { getHeadingSections: mocks.getHeadingSections },
}));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getSessionServiceId = vi.fn(async () => ({ success: true, data: null }));
    getChatSessionById = mocks.getChatSessionById;
  },
}));
vi.mock('@/server/services/promptService', () => ({
  PromptService: {
    getTemplateByName: vi.fn(async (name: string) => ({ content: `テンプレート:${name}` })),
    getCanonicalLinkEntriesByUserId: vi.fn(async () => []),
    getContentAnnotationBySession: vi.fn(async () => null),
    getLatestContentAnnotationByUserId: vi.fn(async () => null),
    buildContentVariables: vi.fn(() => ({})),
    buildProfileVariables: vi.fn((profile: { company?: string } | null) => ({ company: profile?.company ?? '' })),
    buildServiceVariables: vi.fn((service: { name?: string } | null) => (service ? { serviceName: service.name ?? '' } : {})),
    replaceVariables: vi.fn((template: string, variables: Record<string, string>) =>
      Object.entries(variables).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, value), template)
    ),
  },
}));

import { generateInstagramBlogKeywordPrompt, getSystemPrompt } from '@/lib/prompts';
import { PromptService } from '@/server/services/promptService';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';

describe('getSystemPrompt の userId 明示の口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getValidatedBriefByUserId.mockResolvedValue({ success: true, data: null });
    mocks.getChatSessionById.mockResolvedValue({ success: true, data: { id: SESSION_ID } });
    mocks.getHeadingSections.mockResolvedValue({
      success: true,
      data: [
        { heading_key: 'h0', heading_text: '見出しA', heading_level: 3 },
        { heading_key: 'h1', heading_text: '見出しB', heading_level: 3 },
      ],
    });
    mocks.authMiddleware.mockResolvedValue({ error: null, userId: 'cookie-user' });
  });

  it('userId を渡すと Cookie 経路（authMiddleware・getBrief）を読まず、事業者情報をその userId で取る', async () => {
    const prompt = await getSystemPrompt('blog_creation_step2', undefined, SESSION_ID, undefined, { userId: USER_ID });

    expect(prompt).toBe('テンプレート:blog_creation_step2');
    expect(mocks.authMiddleware).not.toHaveBeenCalled();
    expect(mocks.getBrief).not.toHaveBeenCalled();
    expect(mocks.getValidatedBriefByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('step7 の見出しモデルでは、userId を渡すと見出し単位のプロンプトを返す', async () => {
    const prompt = await getSystemPrompt('blog_creation_step7_h0', undefined, SESSION_ID, undefined, { userId: USER_ID });

    expect(prompt).toContain('このリクエストの対象見出しは「見出しA」です。');
    expect(prompt).toContain('次の生成対象は「見出しB」です。');
    expect(mocks.getChatSessionById).toHaveBeenCalledWith(SESSION_ID, USER_ID);
    expect(mocks.authMiddleware).not.toHaveBeenCalled();
  });

  it('userId を渡したとき見出しが解決できなければ、全体テンプレートへ落とさず例外にする', async () => {
    mocks.getHeadingSections.mockResolvedValue({ success: true, data: [] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      getSystemPrompt('blog_creation_step7_h0', undefined, SESSION_ID, undefined, { userId: USER_ID })
    ).rejects.toThrow('Step7 heading section could not be resolved');
  });

  it('userId を渡さなければ従来どおり Cookie の認証と事業者情報を使う', async () => {
    mocks.getBrief.mockResolvedValue({ success: true, data: null });

    await getSystemPrompt('blog_creation_step2', undefined, SESSION_ID);

    expect(mocks.authMiddleware).toHaveBeenCalled();
    expect(mocks.getBrief).toHaveBeenCalled();
    expect(mocks.getValidatedBriefByUserId).not.toHaveBeenCalled();
  });
});

describe('generateInstagramBlogKeywordPrompt', () => {
  const TEMPLATE = '投稿: {{instagramCaption}}\n会社名: {{company}}\nサービス名: {{serviceName}}\nターゲット: {{persona}}';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PromptService.getTemplateByName).mockResolvedValue({ content: TEMPLATE } as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it.each([
    ['登録済み', { profile: { company: '卵屋' }, services: [{ name: '卵の配達' }], persona: '主婦' }],
    ['未登録', null],
  ])('事業者情報が%sでも、置換しきれない {{変数}} を AI に渡さない', async (_label, brief) => {
    mocks.getValidatedBriefByUserId.mockResolvedValue({ success: true, data: brief });

    const prompt = await generateInstagramBlogKeywordPrompt(USER_ID, '割れた卵を交換しました');

    expect(prompt).toContain('投稿: 割れた卵を交換しました');
    expect(prompt).not.toContain('{{');
  });

  it('形式不正の事業者情報は手動フローと同じく未登録として扱い、読み取り失敗だけ例外にする', async () => {
    mocks.getValidatedBriefByUserId.mockResolvedValueOnce({ success: false, kind: 'invalid_format', error: 'format' });
    await expect(generateInstagramBlogKeywordPrompt(USER_ID, 'caption')).resolves.toContain('投稿: caption');

    mocks.getValidatedBriefByUserId.mockResolvedValueOnce({ success: false, kind: 'db_error', error: 'db' });
    await expect(generateInstagramBlogKeywordPrompt(USER_ID, 'caption')).rejects.toThrow('db');
  });
});
