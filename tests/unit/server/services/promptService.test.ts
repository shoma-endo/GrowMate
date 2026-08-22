import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withServiceRoleClient: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    static withServiceRoleClient = mocks.withServiceRoleClient;
  },
}));

import { PromptService } from '@/server/services/promptService';

const TEMPLATE_ID = 'template-id';
const CURRENT_TEMPLATE = {
  id: TEMPLATE_ID,
  name: 'ga4-system',
  display_name: 'GA4 system',
  content: 'old content',
  variables: [],
  version: 5,
  created_by: 'creator-id',
  updated_by: 'previous-editor-id',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

const CURRENT_TEMPLATE_ROW = {
  ...CURRENT_TEMPLATE,
  variables: [],
};

function configureSupabase(currentRow: typeof CURRENT_TEMPLATE_ROW, updatedRow: typeof CURRENT_TEMPLATE_ROW) {
  const templateQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    single: vi.fn(),
  };
  const versionQuery = {
    insert: vi.fn(),
  };

  templateQuery.select.mockReturnValue(templateQuery);
  templateQuery.eq.mockReturnValue(templateQuery);
  templateQuery.update.mockReturnValue(templateQuery);
  templateQuery.single
    .mockResolvedValueOnce({ data: currentRow, error: null })
    .mockResolvedValueOnce({ data: updatedRow, error: null });
  versionQuery.insert.mockResolvedValue({ data: null, error: null });

  const client = {
    from: vi.fn((table: string) => table === 'prompt_versions' ? versionQuery : templateQuery),
  };
  mocks.withServiceRoleClient.mockImplementation(
    async (handler: (serviceClient: typeof client) => Promise<unknown>) => handler(client)
  );

  return { client, templateQuery, versionQuery };
}

describe('PromptService.updateTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('本文を変更したとき、新本文とcurrent versionの履歴を保存する', async () => {
    const updatedRow = {
      ...CURRENT_TEMPLATE_ROW,
      content: 'new content',
      version: 6,
      updated_by: 'editor-id',
    };
    const { templateQuery, versionQuery } = configureSupabase(CURRENT_TEMPLATE_ROW, updatedRow);

    const result = await PromptService.updateTemplate(TEMPLATE_ID, {
      content: 'new content',
      updated_by: 'editor-id',
    });

    expect(versionQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      template_id: TEMPLATE_ID,
      content: 'new content',
      version: 6,
      created_by: 'editor-id',
    }));
    expect(templateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      content: 'new content',
      version: 6,
      updated_by: 'editor-id',
    }));
    expect(result.content).toBe('new content');
    expect(result.version).toBe(6);
  });

  it('本文を変更しないとき、履歴を追加せずcurrent versionを維持する', async () => {
    const { templateQuery, versionQuery } = configureSupabase(CURRENT_TEMPLATE_ROW, CURRENT_TEMPLATE_ROW);

    const result = await PromptService.updateTemplate(TEMPLATE_ID, {
      display_name: '更新後の表示名',
      updated_by: 'editor-id',
    });

    expect(versionQuery.insert).not.toHaveBeenCalled();
    expect(templateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      version: 5,
      updated_by: 'editor-id',
    }));
    expect(result.version).toBe(5);
  });
});
