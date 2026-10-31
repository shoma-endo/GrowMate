import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getMediaForThumbnail: vi.fn(),
  downloadCachedThumbnail: vi.fn(),
  cacheThumbnail: vi.fn(),
  getInstagramCredential: vi.fn(),
  updateInstagramCredential: vi.fn(),
  ensureValidInstagramToken: vi.fn(),
  fetchMediaUrl: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock('@/server/middleware/auth.middleware', () => ({ authMiddleware: mocks.authMiddleware }));

vi.mock('@/server/services/instagramMediaService', () => ({
  instagramMediaService: {
    getMediaForThumbnail: mocks.getMediaForThumbnail,
    downloadCachedThumbnail: mocks.downloadCachedThumbnail,
    cacheThumbnail: mocks.cacheThumbnail,
  },
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getInstagramCredential = mocks.getInstagramCredential;
    updateInstagramCredential = mocks.updateInstagramCredential;
  },
}));

vi.mock('@/server/services/instagramTokenService', () => ({
  createInstagramTokenDeps: vi.fn(),
  ensureValidInstagramToken: mocks.ensureValidInstagramToken,
}));

vi.mock('@/server/services/instagramService', () => ({
  InstagramService: class {
    fetchMediaUrl = mocks.fetchMediaUrl;
  },
}));

vi.mock('@/server/lib/fetch-with-timeout', () => ({ fetchWithTimeout: mocks.fetchWithTimeout }));

import { GET } from '../../../../app/api/instagram/media/[igMediaId]/thumbnail/route';

const STALE_DB_THUMBNAIL_URL = 'https://scontent.cdninstagram.com/stale-thumbnail.jpg';
const STALE_DB_MEDIA_URL = 'https://scontent.cdninstagram.com/stale-media.mp4';
const FRESH_THUMBNAIL_URL = 'https://scontent.cdninstagram.com/fresh-thumbnail.jpg';
const FRESH_MEDIA_URL = 'https://scontent.cdninstagram.com/fresh-media.jpg';

function requestThumbnail() {
  return GET(new NextRequest('http://localhost/api/instagram/media/ig-1/thumbnail'), {
    params: Promise.resolve({ igMediaId: 'ig-1' }),
  });
}

function imageResponse() {
  return new Response(new Blob(['image-bytes']), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
}

describe('GET /api/instagram/media/[igMediaId]/thumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.authMiddleware.mockResolvedValue({
      error: null,
      userId: 'user-1',
      userDetails: { role: 'paid' },
    });
    mocks.getMediaForThumbnail.mockResolvedValue({
      mediaProductType: 'REELS',
      mediaUrl: STALE_DB_MEDIA_URL,
      thumbnailUrl: STALE_DB_THUMBNAIL_URL,
      cachedThumbnailPath: null,
    });
    mocks.getInstagramCredential.mockResolvedValue({ userId: 'user-1' });
    mocks.ensureValidInstagramToken.mockResolvedValue({
      accessToken: 'token',
      needsReauth: false,
    });
    mocks.fetchMediaUrl.mockResolvedValue({
      data: { mediaUrl: FRESH_MEDIA_URL, thumbnailUrl: FRESH_THUMBNAIL_URL },
    });
    mocks.fetchWithTimeout.mockImplementation(async () => imageResponse());
    mocks.cacheThumbnail.mockResolvedValue('user-1/ig-1.jpg');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未キャッシュなら DB の URL を試さず Meta の URL だけを取得してキャッシュする', async () => {
    const response = await requestThumbnail();

    expect(response.status).toBe(200);
    expect(mocks.fetchMediaUrl).toHaveBeenCalledWith('token', 'ig-1');
    expect(mocks.fetchWithTimeout.mock.calls.map(([url]) => url)).toEqual([FRESH_THUMBNAIL_URL]);
    expect(mocks.cacheThumbnail).toHaveBeenCalledWith(
      'user-1',
      'ig-1',
      expect.any(Blob),
      'image/jpeg'
    );
  });

  it('キャッシュ保存に失敗しても取得した画像は返す', async () => {
    mocks.cacheThumbnail.mockResolvedValue(null);

    const response = await requestThumbnail();

    expect(response.status).toBe(200);
  });

  it('Storage の読取に失敗したら DB の URL を試さず Meta へフォールスルーする', async () => {
    mocks.getMediaForThumbnail.mockResolvedValue({
      mediaProductType: 'REELS',
      mediaUrl: STALE_DB_MEDIA_URL,
      thumbnailUrl: STALE_DB_THUMBNAIL_URL,
      cachedThumbnailPath: 'user-1/ig-1.jpg',
    });
    mocks.downloadCachedThumbnail.mockResolvedValue(null);

    const response = await requestThumbnail();

    expect(response.status).toBe(200);
    expect(mocks.fetchWithTimeout.mock.calls.map(([url]) => url)).toEqual([FRESH_THUMBNAIL_URL]);
    expect(mocks.cacheThumbnail).toHaveBeenCalledOnce();
  });

  it('キャッシュ済みなら Storage から返し Meta も CDN も呼ばない', async () => {
    mocks.getMediaForThumbnail.mockResolvedValue({
      mediaProductType: 'REELS',
      mediaUrl: STALE_DB_MEDIA_URL,
      thumbnailUrl: STALE_DB_THUMBNAIL_URL,
      cachedThumbnailPath: 'user-1/ig-1.jpg',
    });
    mocks.downloadCachedThumbnail.mockResolvedValue(new Blob(['cached'], { type: 'image/png' }));

    const response = await requestThumbnail();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(mocks.fetchMediaUrl).not.toHaveBeenCalled();
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    expect(mocks.cacheThumbnail).not.toHaveBeenCalled();
  });

  it('Meta の取得に失敗したら DB の URL へ戻らず 404 にする', async () => {
    mocks.fetchMediaUrl.mockRejectedValue(new Error('Graph API error'));

    const response = await requestThumbnail();

    expect(response.status).toBe(404);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    expect(mocks.cacheThumbnail).not.toHaveBeenCalled();
  });

  it('Meta の URL のダウンロードが 403 なら DB の URL へ戻らず 404 にする', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(new Response(null, { status: 403 }));

    const response = await requestThumbnail();

    expect(response.status).toBe(404);
    expect(mocks.fetchWithTimeout.mock.calls.map(([url]) => url)).toEqual([FRESH_THUMBNAIL_URL]);
    expect(mocks.cacheThumbnail).not.toHaveBeenCalled();
  });

  it('要再認証なら DB の URL へ戻らず 404 にする', async () => {
    mocks.ensureValidInstagramToken.mockResolvedValue({ needsReauth: true });

    const response = await requestThumbnail();

    expect(response.status).toBe(404);
    expect(mocks.fetchMediaUrl).not.toHaveBeenCalled();
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('連携情報が無ければ DB の URL へ戻らず 404 にする', async () => {
    mocks.getInstagramCredential.mockResolvedValue(null);

    const response = await requestThumbnail();

    expect(response.status).toBe(404);
    expect(mocks.fetchMediaUrl).not.toHaveBeenCalled();
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('Meta が REELS の thumbnail_url を返さなければ DB の URL で補わず 404 にする', async () => {
    mocks.fetchMediaUrl.mockResolvedValue({
      data: { mediaUrl: FRESH_MEDIA_URL, thumbnailUrl: null },
    });

    const response = await requestThumbnail();

    expect(response.status).toBe(404);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('REELS 以外は Meta の media_url をキャッシュ対象にする', async () => {
    mocks.getMediaForThumbnail.mockResolvedValue({
      mediaProductType: 'FEED',
      mediaUrl: STALE_DB_MEDIA_URL,
      thumbnailUrl: null,
      cachedThumbnailPath: null,
    });
    mocks.fetchMediaUrl.mockResolvedValue({
      data: { mediaUrl: FRESH_MEDIA_URL, thumbnailUrl: null },
    });

    const response = await requestThumbnail();

    expect(response.status).toBe(200);
    expect(mocks.fetchWithTimeout.mock.calls.map(([url]) => url)).toEqual([FRESH_MEDIA_URL]);
  });

  it('Meta の URL が許可外ホストならダウンロードせず 404 にする', async () => {
    mocks.fetchMediaUrl.mockResolvedValue({
      data: { mediaUrl: null, thumbnailUrl: 'https://attacker.example/thumbnail.jpg' },
    });

    const response = await requestThumbnail();

    expect(response.status).toBe(404);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });
});
