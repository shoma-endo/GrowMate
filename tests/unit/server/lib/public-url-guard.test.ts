import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

const httpsRequestMock = vi.hoisted(() => vi.fn());
vi.mock('node:https', () => ({ request: httpsRequestMock }));

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
    'https://[::ffff:7f00:1]/',
    'https://[0:0:0:0:0:ffff:a9fe:a9fe]/',
    'https://[::7f00:1]/',
    'https://[::ffff:0:7f00:1]/',
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

  it('IPv4 射影の16進表記で解決される名前も、埋め込まれた IPv4 で判定する', async () => {
    resolvesTo('::ffff:a9fe:a9fe');
    await expect(checkPublicHttpsUrl('https://mapped-hex.example.com')).resolves.toEqual({
      ok: false,
      reason: 'private_address',
    });
    resolvesTo('::ffff:808:808');
    await expect(checkPublicHttpsUrl('https://mapped-public.example.com')).resolves.toMatchObject({ ok: true });
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

type FakeReply = { status: number; headers?: Record<string, string>; body?: string | Buffer };
type LookupCallback = (error: Error | null) => void;

/**
 * node:https の request の代わり。本物と同じく、接続の直前に options.lookup で宛先を解決させ、
 * 解決に失敗（検査で拒否）したら error を出し、通れば replies の応答を返す。
 */
function serve(reply: (url: URL) => FakeReply) {
  httpsRequestMock.mockImplementation(
    (
      url: URL,
      options: { lookup: (host: string, opts: { all: boolean }, cb: LookupCallback) => void },
      onResponse: (incoming: Readable) => void
    ) => {
      const request = Object.assign(new EventEmitter(), {
        setTimeout: () => request,
        destroy: (error?: Error) => request.emit('error', error),
        end: () => {
          options.lookup(url.hostname, { all: true }, error => {
            if (error) {
              request.emit('error', error);
              return;
            }
            const { status, headers = {}, body } = reply(url);
            onResponse(
              Object.assign(Readable.from(body ? [Buffer.from(body)] : []), {
                statusCode: status,
                statusMessage: '',
                headers,
              })
            );
          });
        },
      });
      return request;
    }
  );
}

describe('fetchPublicUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    httpsRequestMock.mockReset();
  });

  it('名前解決は接続の中で1回だけ行い、その結果が内部アドレスなら接続しない（DNS rebinding 対策）', async () => {
    resolvesTo('127.0.0.1');
    serve(() => ({ status: 200, body: 'internal' }));

    await expect(fetchPublicUrl('https://rebind.example.com/wp-json/')).rejects.toMatchObject({
      reason: 'private_address',
    });
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock.mock.calls[0]?.[1]).toHaveProperty('lookup');
  });

  it('公開アドレスなら応答の状態・ヘッダー・本文をそのまま返す', async () => {
    resolvesTo('93.184.216.34');
    serve(() => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }));

    const response = await fetchPublicUrl('https://example.com/wp-json/');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('リダイレクト先が内部アドレスなら追わない', async () => {
    lookupMock.mockImplementation(async (host: string) =>
      host === 'internal.example.com'
        ? [{ address: '169.254.169.254', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]
    );
    serve(url =>
      url.hostname === 'example.com'
        ? { status: 302, headers: { location: 'https://internal.example.com/' } }
        : { status: 200, body: 'metadata' }
    );

    await expect(fetchPublicUrl('https://example.com/wp-json/')).rejects.toBeInstanceOf(PublicUrlBlockedError);
  });

  it('公開アドレスへのリダイレクトは追い、別オリジンには Authorization を送らない', async () => {
    resolvesTo('93.184.216.34');
    serve(url =>
      url.hostname === 'example.com'
        ? { status: 301, headers: { location: 'https://www.example.org/wp-json/' } }
        : { status: 200, body: '{}' }
    );

    const response = await fetchPublicUrl('https://example.com/wp-json/', {
      headers: { Authorization: 'Basic secret', Accept: 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(String(httpsRequestMock.mock.calls[1]?.[0])).toBe('https://www.example.org/wp-json/');
    const secondHeaders = httpsRequestMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders.authorization).toBeUndefined();
    expect(secondHeaders.accept).toBe('application/json');
  });

  it('http へのリダイレクトは追わない', async () => {
    resolvesTo('93.184.216.34');
    serve(() => ({ status: 301, headers: { location: 'http://example.com/wp-json/' } }));

    await expect(fetchPublicUrl('https://example.com/wp-json/')).rejects.toMatchObject({ reason: 'not_https' });
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it('リダイレクトが続きすぎたら止める', async () => {
    resolvesTo('93.184.216.34');
    serve(() => ({ status: 302, headers: { location: 'https://example.com/loop' } }));

    await expect(fetchPublicUrl('https://example.com/')).rejects.toMatchObject({ reason: 'too_many_redirects' });
  });

  it('本文を持てないステータス（205）に本文が付いていても、本文なしの応答として返す', async () => {
    resolvesTo('93.184.216.34');
    serve(() => ({ status: 205, body: 'x' }));

    const response = await fetchPublicUrl('https://example.com/');

    expect(response.status).toBe(205);
    expect(response.body).toBeNull();
  });

  it('Response にできないステータス（999）は、例外で止まらず reject する', async () => {
    resolvesTo('93.184.216.34');
    serve(() => ({ status: 999, body: 'x' }));

    await expect(fetchPublicUrl('https://example.com/')).rejects.toThrow('Unsupported response status: 999');
  });

  it('identity を求めても gzip で返すサーバーの本文は展開して返す', async () => {
    resolvesTo('93.184.216.34');
    serve(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, body: gzipSync('{"ok":true}') }));

    const response = await fetchPublicUrl('https://example.com/wp-json/');

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(httpsRequestMock.mock.calls[0]?.[1]?.headers['accept-encoding']).toBe('identity');
  });

  it('圧縮した本文の受信が途中で中断されても、読み取りは止まらずに失敗する', async () => {
    resolvesTo('93.184.216.34');
    const partial = gzipSync('{"ok":true}'.repeat(100)).subarray(0, 20);
    httpsRequestMock.mockImplementation((url: URL, options, onResponse: (incoming: Readable) => void) => {
      const request = Object.assign(new EventEmitter(), {
        setTimeout: () => request,
        end: () => {
          options.lookup(url.hostname, { all: true }, () => {
            const incoming = new Readable({ read() {} });
            onResponse(
              Object.assign(incoming, { statusCode: 200, statusMessage: '', headers: { 'content-encoding': 'gzip' } })
            );
            incoming.push(partial);
            setTimeout(() => incoming.destroy(new Error('aborted')), 10);
          });
        },
      });
      return request;
    });

    const response = await fetchPublicUrl('https://example.com/wp-json/');

    await expect(response.text()).rejects.toBeInstanceOf(Error);
  }, 2000);

  it('101 で upgrade を返すサーバーにも、待ち続けずに reject する', async () => {
    resolvesTo('93.184.216.34');
    httpsRequestMock.mockImplementation((url: URL, options) => {
      const request = Object.assign(new EventEmitter(), {
        setTimeout: () => request,
        end: () => {
          options.lookup(url.hostname, { all: true }, () => {
            request.emit('upgrade', {}, { destroy: () => undefined });
          });
        },
      });
      return request;
    });

    await expect(fetchPublicUrl('https://example.com/')).rejects.toThrow('Unsupported response status: 101');
  }, 2000);

  it('応答の前に接続が閉じたら、待ち続けずに reject する', async () => {
    resolvesTo('93.184.216.34');
    httpsRequestMock.mockImplementation((url: URL, options) => {
      const request = Object.assign(new EventEmitter(), {
        setTimeout: () => request,
        end: () => {
          options.lookup(url.hostname, { all: true }, () => request.emit('close'));
        },
      });
      return request;
    });

    await expect(fetchPublicUrl('https://example.com/')).rejects.toThrow('Connection closed before a response');
  }, 2000);
});
