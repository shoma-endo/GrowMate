import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { checkPublicHttpsUrl, fetchPublicUrl, PublicUrlBlockedError } from '@/server/lib/public-url-guard';

const resolvesTo = (...addresses: string[]) =>
  lookupMock.mockResolvedValue(addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })));

describe('checkPublicHttpsUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('公開アドレスに解決される https の URL は通す', async () => {
    resolvesTo('93.184.216.34');
    await expect(checkPublicHttpsUrl('https://example.com/wp-json/')).resolves.toMatchObject({ ok: true });
  });

  it('http は拒否する', async () => {
    resolvesTo('93.184.216.34');
    await expect(checkPublicHttpsUrl('http://example.com')).resolves.toEqual({ ok: false, reason: 'not_https' });
  });

  it('URL として読めない文字列は拒否する', async () => {
    await expect(checkPublicHttpsUrl('not a url')).resolves.toEqual({ ok: false, reason: 'invalid_url' });
  });

  it.each([
    'https://127.0.0.1/',
    'https://10.0.0.5/',
    'https://172.16.3.4/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/',
    'https://0.0.0.0/',
    'https://[::1]/',
    'https://[fd00::1]/',
    'https://[fe80::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::7f00:1]/',
    'https://[64:ff9b::a9fe:a9fe]/',
    'https://[2002:a9fe:a9fe::1]/',
    'https://2130706433/',
    'https://169.254.169.254./',
  ])('内部向けの IP リテラル %s は拒否する', async url => {
    await expect(checkPublicHttpsUrl(url)).resolves.toEqual({ ok: false, reason: 'private_address' });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('名前解決の結果に内部アドレスが1つでも混ざれば拒否する', async () => {
    resolvesTo('93.184.216.34', '10.0.0.1');
    await expect(checkPublicHttpsUrl('https://rebind.example.com')).resolves.toEqual({
      ok: false,
      reason: 'private_address',
    });
  });

  it('IPv4 射影の IPv6 で内部アドレスに解決される名前は拒否する', async () => {
    resolvesTo('::ffff:169.254.169.254');
    await expect(checkPublicHttpsUrl('https://mapped.example.com')).resolves.toEqual({
      ok: false,
      reason: 'private_address',
    });
  });

  it('名前解決に失敗したら拒否する', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(checkPublicHttpsUrl('https://nowhere.example.com')).resolves.toEqual({
      ok: false,
      reason: 'dns_failed',
    });
  });
});

describe('fetchPublicUrl', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    lookupMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('リダイレクトを自動で追わせず、宛先を検査してから追う', async () => {
    lookupMock.mockImplementation(async (host: string) =>
      host === 'internal.example.com'
        ? [{ address: '169.254.169.254', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]
    );
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://internal.example.com/' } })
    );

    await expect(fetchPublicUrl('https://example.com/wp-json/')).rejects.toBeInstanceOf(PublicUrlBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('公開アドレスへのリダイレクトは追い、別オリジンには Authorization を送らない', async () => {
    resolvesTo('93.184.216.34');
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://www.example.org/wp-json/' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const response = await fetchPublicUrl('https://example.com/wp-json/', {
      headers: { Authorization: 'Basic secret', Accept: 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://www.example.org/wp-json/');
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get('authorization')).toBeNull();
    expect(secondHeaders.get('accept')).toBe('application/json');
  });

  it('http へのリダイレクトは追わない', async () => {
    resolvesTo('93.184.216.34');
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { location: 'http://example.com/wp-json/' } })
    );

    await expect(fetchPublicUrl('https://example.com/wp-json/')).rejects.toMatchObject({ reason: 'not_https' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('リダイレクトが続きすぎたら止める', async () => {
    resolvesTo('93.184.216.34');
    fetchMock.mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'https://example.com/loop' } })
    );

    await expect(fetchPublicUrl('https://example.com/')).rejects.toMatchObject({ reason: 'too_many_redirects' });
  });
});
