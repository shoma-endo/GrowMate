import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failNext, resetStore, rows } from './instagramBlogDraftFakeSupabase';

vi.mock('server-only', () => ({}));

vi.mock('@/server/services/supabaseService', async () => {
  const { FakeSupabaseService } = await import('./instagramBlogDraftFakeSupabase');
  return { SupabaseService: FakeSupabaseService };
});

vi.mock('@/server/services/instagramBlogDraftRunner', () => ({
  InstagramBlogDraftFailure: class extends Error {
    constructor(readonly code: string) { super(code); }
  },
  instagramBlogDraftRunner: { run: vi.fn() },
}));

vi.mock('@/server/services/emailService', () => ({
  emailService: { sendInstagramBlogDraftNotification: vi.fn() },
}));

import {
  instagramBlogDraftJobService,
  InstagramBlogDraftBatchActiveError,
} from '@/server/services/instagramBlogDraftJobService';
import { instagramBlogDraftRunner, InstagramBlogDraftFailure } from '@/server/services/instagramBlogDraftRunner';
import { emailService } from '@/server/services/emailService';

const USER_ID = 'user-1';
const MEDIA_NEW = 'media-new';
const MEDIA_RESUME = 'media-resume';
const BATCH = 'batch-1';
const T0 = Date.parse('2026-09-30T00:00:00Z');
const STALE = new Date(T0 - 21 * 60_000).toISOString();
const FRESH = new Date(T0 - 60_000).toISOString();

let uuidCounter = 0;

function job(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    user_id: USER_ID,
    session_id: null,
    batch_id: BATCH,
    status: 'queued',
    stage: 'keywords',
    heading_index: 0,
    heading_total: null,
    error_code: null,
    continuation_count: null,
    created_at: '2026-09-30T00:00:00Z',
    updated_at: FRESH,
    ...overrides,
  };
}

/** 最初の呼び出しだけ T0、以降は T0 + elapsedMs を返す（ワーカーの残り時間の判定用） */
function mockElapsed(elapsedMs: number): void {
  let first = true;
  vi.spyOn(Date, 'now').mockImplementation(() => {
    if (first) {
      first = false;
      return T0;
    }
    return T0 + elapsedMs;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(instagramBlogDraftRunner.run).mockReset();
  vi.mocked(emailService.sendInstagramBlogDraftNotification).mockResolvedValue({ success: true });
  resetStore();
  uuidCounter = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `batch-new-${++uuidCounter}` });
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://growmate.test');
  vi.stubEnv('CRON_SECRET', 'secret');
  vi.spyOn(Date, 'now').mockReturnValue(T0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('開始と再開（start）', () => {
  it('新規と止まった投稿を同じまとまりに入れ、止まった投稿は段階とセッションを保って再開する', async () => {
    rows('instagram_media').push(
      { id: MEDIA_NEW, user_id: USER_ID, caption: 'new caption' },
      { id: MEDIA_RESUME, user_id: USER_ID, caption: 'resume caption' },
      { id: 'media-empty', user_id: USER_ID, caption: '   ' }
    );
    rows('instagram_blog_draft_batches').push({ id: 'batch-old', user_id: USER_ID, notified_at: null });
    const stoppedJob = job({
      id: 'job-stopped',
      instagram_media_id: MEDIA_RESUME,
      session_id: 'session-existing',
      batch_id: 'batch-old',
      status: 'failed',
      stage: 'step4',
      error_code: 'AI_FAILED',
      continuation_count: 1,
    });
    rows('instagram_blog_draft_jobs').push(stoppedJob);

    const result = await instagramBlogDraftJobService.start(USER_ID, [
      MEDIA_NEW,
      MEDIA_RESUME,
      'media-missing',
      'media-empty',
    ]);

    expect(result).toEqual({
      batchId: 'batch-new-1',
      started: 1,
      resumed: 1,
      excluded: { created: 0, emptyCaption: 1, unavailable: 1 },
    });
    expect(stoppedJob).toMatchObject({
      batch_id: 'batch-new-1',
      status: 'queued',
      stage: 'step4',
      session_id: 'session-existing',
      error_code: null,
      continuation_count: 0,
    });
    expect(rows('instagram_blog_draft_jobs')).toHaveLength(2);
    expect(rows('instagram_blog_draft_jobs').find(row => row.instagram_media_id === MEDIA_NEW)).toMatchObject({
      batch_id: 'batch-new-1',
      status: 'queued',
      stage: 'keywords',
    });
  });

  it('途切れていない行を再開しても continuation_count は null のまま', async () => {
    rows('instagram_media').push({ id: MEDIA_RESUME, user_id: USER_ID, caption: 'caption' });
    const stoppedJob = job({ id: 'job-1', instagram_media_id: MEDIA_RESUME, status: 'failed', error_code: 'SAVE_FAILED' });
    rows('instagram_blog_draft_jobs').push(stoppedJob);

    await instagramBlogDraftJobService.start(USER_ID, [MEDIA_RESUME]);

    expect(stoppedJob.continuation_count).toBeNull();
  });

  it('作成中・待機中（20分以内）と完了の投稿は対象外、20分より古い作成中・待機中は再開する', async () => {
    rows('instagram_media').push(
      { id: 'media-completed', user_id: USER_ID, caption: 'c' },
      { id: 'media-stale-running', user_id: USER_ID, caption: 'c' },
      { id: 'media-stale-queued', user_id: USER_ID, caption: 'c' },
      { id: 'media-other-user', user_id: 'user-2', caption: 'c' }
    );
    rows('instagram_blog_draft_jobs').push(
      job({ id: 'job-completed', instagram_media_id: 'media-completed', batch_id: 'batch-old', status: 'completed' }),
      job({ id: 'job-stale-running', instagram_media_id: 'media-stale-running', batch_id: 'batch-old', status: 'running', updated_at: STALE }),
      job({ id: 'job-stale-queued', instagram_media_id: 'media-stale-queued', batch_id: 'batch-old', status: 'queued', updated_at: STALE })
    );

    const result = await instagramBlogDraftJobService.start(USER_ID, [
      'media-completed',
      'media-stale-running',
      'media-stale-queued',
      'media-other-user',
    ]);

    expect(result).toMatchObject({
      started: 0,
      resumed: 2,
      excluded: { created: 1, emptyCaption: 0, unavailable: 1 },
    });
  });

  it('作成中のまとまりがあれば始めない', async () => {
    rows('instagram_media').push({ id: MEDIA_NEW, user_id: USER_ID, caption: 'c' });
    rows('instagram_blog_draft_jobs').push(job({ id: 'job-active', instagram_media_id: 'media-active', status: 'running' }));

    await expect(instagramBlogDraftJobService.start(USER_ID, [MEDIA_NEW])).rejects.toBeInstanceOf(
      InstagramBlogDraftBatchActiveError
    );
    expect(rows('instagram_blog_draft_batches')).toHaveLength(0);
  });

  it('同じユーザーの開始要求が同時に届くと、片方だけが通り、もう片方は作成中のまとまりありで始めない', async () => {
    rows('instagram_media').push(
      { id: MEDIA_RESUME, user_id: USER_ID, caption: 'c' },
      { id: MEDIA_NEW, user_id: USER_ID, caption: 'c' }
    );
    rows('instagram_blog_draft_jobs').push(
      job({ id: 'job-1', instagram_media_id: MEDIA_RESUME, batch_id: 'batch-old', status: 'failed' })
    );

    const results = await Promise.allSettled([
      instagramBlogDraftJobService.start(USER_ID, [MEDIA_RESUME]),
      instagramBlogDraftJobService.start(USER_ID, [MEDIA_NEW]),
    ]);

    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { batchId: 'batch-new-1', resumed: 1 } });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: expect.any(InstagramBlogDraftBatchActiveError) });
    expect(rows('instagram_blog_draft_batches').map(batch => batch.id)).toEqual(['batch-new-1']);
    expect(rows('instagram_blog_draft_jobs')).toHaveLength(1);
  });

  it('開始の RPC で作れなかった投稿は作成ありで対象外に数え、1件も始まらなければまとまりを返さない', async () => {
    rows('instagram_media').push({ id: MEDIA_NEW, user_id: USER_ID, caption: 'c' });
    // 開始前の確認の後に別の要求が作った行の代わり（本人の行の取得には出ない）
    rows('instagram_blog_draft_jobs').push(
      job({ id: 'job-other', user_id: 'user-2', instagram_media_id: MEDIA_NEW, status: 'completed' })
    );

    await expect(instagramBlogDraftJobService.start(USER_ID, [MEDIA_NEW])).resolves.toEqual({
      batchId: null,
      started: 0,
      resumed: 0,
      excluded: { created: 1, emptyCaption: 0, unavailable: 0 },
    });
    expect(rows('instagram_blog_draft_batches')).toHaveLength(0);
  });

  it('開始の RPC が失敗したら例外にし、409 とは区別する', async () => {
    rows('instagram_media').push({ id: MEDIA_NEW, user_id: USER_ID, caption: 'c' });
    failNext('start_instagram_blog_draft_batch', 'rpc');

    const error = await instagramBlogDraftJobService.start(USER_ID, [MEDIA_NEW]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InstagramBlogDraftBatchActiveError);
  });

  it('行を移した元のまとまりが全部終われば、元のまとまりの結果メールを送る', async () => {
    rows('users').push({ id: USER_ID, email: 'user@example.com', role: 'paid' });
    rows('instagram_media').push(
      { id: MEDIA_RESUME, user_id: USER_ID, caption: 'c' },
      { id: 'media-done', user_id: USER_ID, caption: 'done caption' }
    );
    rows('instagram_blog_draft_batches').push({ id: 'batch-old', user_id: USER_ID, notified_at: null });
    rows('instagram_blog_draft_jobs').push(
      job({ id: 'job-failed', instagram_media_id: MEDIA_RESUME, batch_id: 'batch-old', status: 'failed' }),
      job({ id: 'job-done', instagram_media_id: 'media-done', batch_id: 'batch-old', status: 'completed', session_id: 's-1' })
    );

    await instagramBlogDraftJobService.start(USER_ID, [MEDIA_RESUME]);

    expect(emailService.sendInstagramBlogDraftNotification).toHaveBeenCalledOnce();
    expect(vi.mocked(emailService.sendInstagramBlogDraftNotification).mock.calls[0]?.[3]).toBe('batch-old');
  });

  it('元のまとまりの結果メールの判定に失敗しても、新しいまとまりは起動できる形で返す', async () => {
    rows('instagram_media').push({ id: MEDIA_RESUME, user_id: USER_ID, caption: 'c' });
    rows('instagram_blog_draft_batches').push({ id: 'batch-old', user_id: USER_ID, notified_at: null });
    rows('instagram_blog_draft_jobs').push(
      job({ id: 'job-failed', instagram_media_id: MEDIA_RESUME, batch_id: 'batch-old', status: 'failed' }),
      job({ id: 'job-done', instagram_media_id: 'media-done', batch_id: 'batch-old', status: 'completed' })
    );
    failNext('users', 'select');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(instagramBlogDraftJobService.start(USER_ID, [MEDIA_RESUME])).resolves.toMatchObject({
      batchId: 'batch-new-1',
      resumed: 1,
    });
    expect(logError).toHaveBeenCalledWith('[Instagram BlogDraft] original batch finalize failed', {
      batchId: 'batch-old',
      error: expect.any(Error),
    });
  });
});

describe('ワーカー（runBatch）', () => {
  it('待機中の行の時刻を更新し、同時に3件まで進め、1件終わるたびに次を取り出す', async () => {
    const jobs = Array.from({ length: 4 }, (_, index) => job({
      id: `job-${index + 1}`,
      instagram_media_id: `media-${index + 1}`,
      batch_id: 'batch-worker',
      created_at: `2026-09-30T00:00:0${index}Z`,
      updated_at: '2026-09-01T00:00:00Z',
    }));
    rows('instagram_blog_draft_jobs').push(...jobs);
    rows('instagram_blog_draft_batches').push({ id: 'batch-worker', user_id: USER_ID, chain_count: 0, notified_at: null });

    const releases = new Map<string, () => void>();
    const started: string[] = [];
    let notifyStarted: () => void = () => undefined;
    vi.mocked(instagramBlogDraftRunner.run).mockImplementation(async jobId => {
      started.push(jobId);
      notifyStarted();
      await new Promise<void>(resolve => releases.set(jobId, resolve));
      throw new Error(`stop ${jobId}`);
    });
    const waitForStarted = (count: number) => new Promise<void>(resolve => {
      notifyStarted = () => { if (started.length >= count) resolve(); };
      notifyStarted();
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const run = instagramBlogDraftJobService.runBatch('batch-worker', USER_ID, 'paid');
    await waitForStarted(3);
    expect(started).toEqual(['job-1', 'job-2', 'job-3']);
    expect(jobs.every(row => row.updated_at !== '2026-09-01T00:00:00Z')).toBe(true);

    releases.get('job-2')?.();
    await waitForStarted(4);
    expect(started).toEqual(['job-1', 'job-2', 'job-3', 'job-4']);
    expect(jobs[0]?.status).toBe('running');

    for (const id of ['job-1', 'job-3', 'job-4']) releases.get(id)?.();
    await run;
    expect(jobs.map(row => row.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect(jobs.map(row => row.error_code)).toEqual(['SAVE_FAILED', 'SAVE_FAILED', 'SAVE_FAILED', 'SAVE_FAILED']);
  });

  it('残り時間が 200 秒以下なら取り出さず、引き継ぎ回数を1増やして受け口を呼ぶ（29 → 30）', async () => {
    rows('instagram_blog_draft_jobs').push(job({ id: 'job-1', instagram_media_id: 'media-1' }));
    const batch = { id: BATCH, user_id: USER_ID, chain_count: 29, notified_at: null };
    rows('instagram_blog_draft_batches').push(batch);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    mockElapsed(540_000);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(instagramBlogDraftRunner.run).not.toHaveBeenCalled();
    expect(batch.chain_count).toBe(30);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://growmate.test/api/instagram/blog-drafts/continue');
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer secret' } });
    expect(JSON.parse(init.body)).toEqual({ batchId: BATCH });
    expect(emailService.sendInstagramBlogDraftNotification).not.toHaveBeenCalled();
  });

  it('残り時間が 200 秒を超えていれば取り出す', async () => {
    rows('instagram_blog_draft_jobs').push(job({ id: 'job-1', instagram_media_id: 'media-1' }));
    rows('instagram_blog_draft_batches').push({ id: BATCH, user_id: USER_ID, chain_count: 0, notified_at: null });
    vi.mocked(instagramBlogDraftRunner.run).mockResolvedValue('completed');
    rows('users').push({ id: USER_ID, email: null, role: 'paid' });
    mockElapsed(539_999);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(instagramBlogDraftRunner.run).toHaveBeenCalledOnce();
  });

  it('引き継ぎが30回に達していたら引き継がず、残りを CHAIN_LIMIT で止めて結果メールを送る', async () => {
    rows('users').push({ id: USER_ID, email: 'user@example.com', role: 'paid' });
    rows('instagram_media').push({ id: 'media-1', user_id: USER_ID, caption: 'caption' });
    const queued = job({ id: 'job-1', instagram_media_id: 'media-1' });
    rows('instagram_blog_draft_jobs').push(queued);
    const batch = { id: BATCH, user_id: USER_ID, chain_count: 30, notified_at: null };
    rows('instagram_blog_draft_batches').push(batch);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockElapsed(740_000);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(queued).toMatchObject({ status: 'failed', error_code: 'CHAIN_LIMIT' });
    expect(batch.chain_count).toBe(30);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(emailService.sendInstagramBlogDraftNotification).toHaveBeenCalledOnce();
  });

  it('行が消えて Runner が止まったら（更新0件）、ログを残してその投稿を終える', async () => {
    rows('instagram_blog_draft_jobs').push(job({ id: 'job-1', instagram_media_id: 'media-1' }));
    rows('instagram_blog_draft_batches').push({ id: BATCH, user_id: USER_ID, chain_count: 0, notified_at: null });
    vi.mocked(instagramBlogDraftRunner.run).mockResolvedValue('lost');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(logError).toHaveBeenCalledWith('[Instagram BlogDraft] job row lost', {
      jobId: 'job-1',
      batchId: BATCH,
      stage: 'keywords',
    });
  });

  it('Runner が失敗したら failed にし、ログには取り出した時点ではなく止まった段階を出す', async () => {
    const stored = job({ id: 'job-1', instagram_media_id: 'media-1' });
    rows('instagram_blog_draft_jobs').push(stored);
    rows('instagram_blog_draft_batches').push({ id: BATCH, user_id: USER_ID, chain_count: 0, notified_at: null });
    const cause = new InstagramBlogDraftFailure('AI_FAILED');
    vi.mocked(instagramBlogDraftRunner.run).mockImplementation(async () => {
      Object.assign(stored, { stage: 'heading', heading_index: 3 });
      throw cause;
    });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(stored).toMatchObject({ status: 'failed', error_code: 'AI_FAILED' });
    expect(logError).toHaveBeenCalledWith('[Instagram BlogDraft] job failed', {
      jobId: 'job-1',
      batchId: BATCH,
      stage: 'heading',
      headingIndex: 3,
      errorCode: 'AI_FAILED',
      cause,
    });
  });

  it('引き継ぎの fetch が失敗してもログだけ残して終える', async () => {
    rows('instagram_blog_draft_jobs').push(job({ id: 'job-1', instagram_media_id: 'media-1' }));
    rows('instagram_blog_draft_batches').push({ id: BATCH, user_id: USER_ID, chain_count: 0, notified_at: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockElapsed(740_000);

    await expect(instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid')).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith('[Instagram BlogDraft] continuation fetch failed', {
      batchId: BATCH,
      status: 503,
    });
  });
});

describe('結果メール（finalizeBatchIfDone）', () => {
  function seedFinishedBatch(email: string | null): { notified_at: string | null } {
    rows('users').push({ id: USER_ID, email, role: 'paid' });
    rows('instagram_media').push(
      { id: 'media-1', user_id: USER_ID, caption: 'caption 1', posted_at: '2022-09-08T23:27:45Z' },
      { id: 'media-2', user_id: USER_ID, caption: 'caption 2', posted_at: '2022-09-01T03:00:00Z' }
    );
    rows('content_annotations').push({ user_id: USER_ID, session_id: 'session-1', main_kw: '主キーワード' });
    rows('instagram_blog_draft_jobs').push(
      job({ id: 'job-1', instagram_media_id: 'media-1', status: 'completed', session_id: 'session-1' }),
      job({ id: 'job-2', instagram_media_id: 'media-2', status: 'failed', error_code: 'MAX_TOKENS' })
    );
    const batch = { id: BATCH, user_id: USER_ID, chain_count: 0, notified_at: null as string | null };
    rows('instagram_blog_draft_batches').push(batch);
    return batch;
  }

  it('複数のワーカーが同時に最後を迎えても1通だけ送り、冪等キーはまとまり ID', async () => {
    const batch = seedFinishedBatch('user@example.com');

    await Promise.all([
      instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid'),
      instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid'),
    ]);

    expect(emailService.sendInstagramBlogDraftNotification).toHaveBeenCalledOnce();
    const [to, subject, html, key] = vi.mocked(emailService.sendInstagramBlogDraftNotification).mock.calls[0] ?? [];
    expect(to).toBe('user@example.com');
    expect(subject).toBe('【GrowMate】ブログ記事生成完了');
    // 完了1件と MAX_TOKENS で止まった1件。記事名は主軸kw、チャットの無い記事はキャプションの先頭
    expect(html).toContain('完了 1件・失敗 1件');
    expect(html).toContain('>主キーワード</a>（2022/9/9 投稿）');
    expect(html).toContain('caption 2（2022/9/1 投稿）: 失敗');
    expect(key).toBe(BATCH);
    expect(batch.notified_at).not.toBeNull();
  });

  it('メールアドレスが無ければ送らず、notified_at だけ埋める', async () => {
    const batch = seedFinishedBatch(null);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(emailService.sendInstagramBlogDraftNotification).not.toHaveBeenCalled();
    expect(batch.notified_at).not.toBeNull();
  });

  it('送信に失敗しても作成の状態は変えず、ログだけ残す', async () => {
    seedFinishedBatch('user@example.com');
    vi.mocked(emailService.sendInstagramBlogDraftNotification).mockResolvedValue({ success: false, error: 'down' });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(rows('instagram_blog_draft_jobs').map(row => row.status)).toEqual(['completed', 'failed']);
    expect(logError).toHaveBeenCalledWith('[Instagram BlogDraft] completion email failed', { batchId: BATCH, error: 'down' });
  });

  it('まとまりの行が0件（連携解除で消えた）なら送らず notified_at だけ埋める', async () => {
    const batch = { id: BATCH, user_id: USER_ID, chain_count: 0, notified_at: null as string | null };
    rows('instagram_blog_draft_batches').push(batch);

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(emailService.sendInstagramBlogDraftNotification).not.toHaveBeenCalled();
    expect(batch.notified_at).not.toBeNull();
  });

  it('全件がチャットを作る前に止まっていても、結果メールを送る', async () => {
    rows('users').push({ id: USER_ID, email: 'user@example.com', role: 'paid' });
    rows('instagram_media').push({ id: 'media-1', user_id: USER_ID, caption: 'caption 1' });
    rows('instagram_blog_draft_jobs').push(
      job({ id: 'job-1', instagram_media_id: 'media-1', status: 'failed', error_code: 'KEYWORD_PARSE_FAILED' })
    );
    rows('instagram_blog_draft_batches').push({ id: BATCH, user_id: USER_ID, chain_count: 0, notified_at: null });

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(emailService.sendInstagramBlogDraftNotification).toHaveBeenCalledOnce();
  });

  it('待機中・作成中の行が残っていれば送らない', async () => {
    seedFinishedBatch('user@example.com');
    rows('instagram_blog_draft_jobs').push(job({ id: 'job-3', instagram_media_id: 'media-3', status: 'running' }));

    await instagramBlogDraftJobService.runBatch(BATCH, USER_ID, 'paid');

    expect(emailService.sendInstagramBlogDraftNotification).not.toHaveBeenCalled();
  });
});

describe('引き継ぎの受け口の権限確認（authorizeContinuation）', () => {
  it('権限があれば所有者とロールを返す', async () => {
    rows('users').push({ id: USER_ID, email: 'user@example.com', role: 'paid' });
    rows('instagram_blog_draft_batches').push({ id: BATCH, user_id: USER_ID, chain_count: 1, notified_at: null });

    await expect(instagramBlogDraftJobService.authorizeContinuation(BATCH)).resolves.toEqual({
      userId: USER_ID,
      userRole: 'paid',
    });
  });

  it('権限が外れていたら残りを ROLE_REVOKED で止め、メールは送らない', async () => {
    rows('users').push({ id: USER_ID, email: 'user@example.com', role: 'trial' });
    const batch = { id: BATCH, user_id: USER_ID, chain_count: 1, notified_at: null as string | null };
    rows('instagram_blog_draft_batches').push(batch);
    const queued = job({ id: 'job-1', instagram_media_id: 'media-1' });
    const done = job({ id: 'job-2', instagram_media_id: 'media-2', status: 'completed' });
    rows('instagram_blog_draft_jobs').push(queued, done);

    await expect(instagramBlogDraftJobService.authorizeContinuation(BATCH)).resolves.toBeNull();

    expect(queued).toMatchObject({ status: 'failed', error_code: 'ROLE_REVOKED' });
    expect(done.status).toBe('completed');
    expect(emailService.sendInstagramBlogDraftNotification).not.toHaveBeenCalled();
    expect(batch.notified_at).not.toBeNull();
  });

  it('まとまりが無ければ null', async () => {
    await expect(instagramBlogDraftJobService.authorizeContinuation('missing')).resolves.toBeNull();
  });
});
