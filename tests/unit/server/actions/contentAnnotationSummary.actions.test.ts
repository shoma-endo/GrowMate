import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  cookies: vi.fn(),
  generateSummary: vi.fn(),
  saveSummary: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  getEmailLinkConflictMessage: () => undefined,
}));

vi.mock('@/server/services/contentAnnotationSummaryService', () => ({
  contentAnnotationSummaryService: {
    generateSummary: mocks.generateSummary,
    saveSummary: mocks.saveSummary,
  },
  getContentAnnotationSummaryErrorMessage: () => 'error',
}));

import { summarizeContentAnnotation } from '@/server/actions/contentAnnotationSummary.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';
const ANNOTATION_ID = '00000001-0000-4000-8000-000000000000';

function authAs(role: string | null) {
  mocks.authMiddleware.mockResolvedValue({
    userId: USER_ID,
    userDetails: role === null ? null : { role },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  mocks.generateSummary.mockResolvedValue({
    success: true,
    fields: {},
    annotationId: ANNOTATION_ID,
    userId: USER_ID,
  });
  mocks.saveSummary.mockResolvedValue({ success: true, data: { id: ANNOTATION_ID } });
});

describe('認可（一時的に admin のみ）', () => {
  it.each([
    ['paid', 'paid'],
    ['trial', 'trial'],
    ['role なし', null],
  ])('%s はサーバー側で拒否し、要約を生成しない', async (_name, role) => {
    authAs(role);
    const result = await summarizeContentAnnotation({ annotationId: ANNOTATION_ID });
    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.WORDPRESS.SUMMARY_ADMIN_ONLY });
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });

  it('admin は要約を生成して保存する', async () => {
    authAs('admin');
    const result = await summarizeContentAnnotation({ annotationId: ANNOTATION_ID });
    expect(result.success).toBe(true);
    expect(mocks.generateSummary).toHaveBeenCalledTimes(1);
    expect(mocks.saveSummary).toHaveBeenCalledTimes(1);
  });
});
