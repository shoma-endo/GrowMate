import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  env: { RESEND_API_KEY: 'test-resend-key' as string | undefined },
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

vi.mock('@/env', () => ({ env: mocks.env }));

import { EmailService } from '@/server/services/emailService';

describe('EmailService.sendContentAnnotationSummaryCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.RESEND_API_KEY = 'test-resend-key';
    vi.stubEnv('EMAIL_FROM', '');
    mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ジョブ ID を Resend の冪等キーへ渡し、再送時も同じキーを使う', async () => {
    const service = new EmailService();

    await service.sendContentAnnotationSummaryCompletion(
      'a@b.test',
      '件名',
      '<p>x</p>',
      'job-uuid-1'
    );
    await service.sendContentAnnotationSummaryCompletion(
      'a@b.test',
      '件名',
      '<p>x</p>',
      'job-uuid-1'
    );

    const payload = { from: 'GrowMate <noreply@mail.growmate.tokyo>', to: 'a@b.test', subject: '件名', html: '<p>x</p>' };
    expect(mocks.send).toHaveBeenNthCalledWith(1, payload, { idempotencyKey: 'job-uuid-1' });
    expect(mocks.send).toHaveBeenNthCalledWith(2, payload, { idempotencyKey: 'job-uuid-1' });
  });

  it('Resend API キーが無いときは送信せずエラーを返す', async () => {
    mocks.env.RESEND_API_KEY = undefined;
    const service = new EmailService();

    const result = await service.sendContentAnnotationSummaryCompletion(
      'a@b.test',
      '件名',
      '<p>x</p>',
      'job-uuid-1'
    );

    expect(result).toEqual({
      success: false,
      error: 'RESEND_API_KEY is not configured',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
