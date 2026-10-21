import 'server-only';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { pipeline, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  // IPv4 互換（::a.b.c.d）・NAT64・6to4 は IPv4 の宛先を埋め込めるので、まとめて拒否する
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

const MAX_REDIRECTS = 3;
// fetch（undici）の既定の待ち時間上限と同じ。応答が止まったサーバーで関数の実行時間上限まで待たないため
const SOCKET_IDLE_TIMEOUT_MS = 300_000;
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type PublicUrlRejectReason = 'invalid_url' | 'not_https' | 'private_address' | 'dns_failed';

export class PublicUrlBlockedError extends Error {
  constructor(readonly reason: PublicUrlRejectReason | 'too_many_redirects') {
    super(`Outbound request blocked: ${reason}`);
    this.name = 'PublicUrlBlockedError';
  }
}

/** 名前解決の失敗やリダイレクトの回数超過は、URL の誤りではなく接続の問題として伝える */
export function siteUrlRejectMessage(reason: PublicUrlBlockedError['reason']): string {
  return reason === 'dns_failed' || reason === 'too_many_redirects'
    ? ERROR_MESSAGES.WORDPRESS.SITE_URL_UNREACHABLE
    : ERROR_MESSAGES.WORDPRESS.SITE_URL_NOT_PUBLIC;
}

function isBlockedAddress(address: string): boolean {
  const mappedV4 = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedV4) return blockedAddresses.check(mappedV4, 'ipv4');
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, 'ipv4');
  if (family === 6) return blockedAddresses.check(address, 'ipv6');
  return true;
}

type UrlShapeCheck = { ok: true; url: URL; ipLiteral: boolean } | { ok: false; reason: PublicUrlRejectReason };

function checkUrlShape(rawUrl: string): UrlShapeCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host)) return { ok: true, url, ipLiteral: false };
  return isBlockedAddress(host) ? { ok: false, reason: 'private_address' } : { ok: true, url, ipLiteral: true };
}

async function resolvePublicAddresses(hostname: string): Promise<{ address: string; family: number }[]> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new PublicUrlBlockedError('dns_failed');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new PublicUrlBlockedError('private_address');
  }
  return addresses;
}

/**
 * 利用者が入力した URL へサーバーから接続してよいか（https で、名前解決の結果が公開アドレスだけか）を確かめる。
 * 保存時の入力チェック用。実際の接続は {@link fetchPublicUrl} が接続の瞬間に同じ検査をする。
 */
export async function checkPublicHttpsUrl(
  rawUrl: string
): Promise<{ ok: true; url: URL } | { ok: false; reason: PublicUrlRejectReason }> {
  const shape = checkUrlShape(rawUrl);
  if (!shape.ok || shape.ipLiteral) return shape;
  try {
    await resolvePublicAddresses(shape.url.hostname);
  } catch (error) {
    if (error instanceof PublicUrlBlockedError && error.reason !== 'too_many_redirects') {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
  return { ok: true, url: shape.url };
}

/**
 * 接続に使うアドレスをこの lookup で解決させ、その場で検査する。検査とは別に名前解決すると、
 * その間に DNS の応答を内部アドレスへ切り替える DNS rebinding で検査をすり抜けられるため。
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  resolvePublicAddresses(hostname).then(
    addresses => {
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const [first] = addresses;
      callback(null, first!.address, first!.family);
    },
    (error: NodeJS.ErrnoException) => callback(error, '', 0)
  );
};

/** `cache` は WordPress.com 向けに global fetch へ渡すときだけ効き、自前の接続では使わない */
export type PublicRequestInit = Pick<RequestInit, 'method' | 'headers' | 'signal' | 'cache'> & { body?: string };

function decodedBody(incoming: IncomingMessage): Readable {
  const decoder = (() => {
    switch (incoming.headers['content-encoding']?.trim().toLowerCase()) {
      case 'gzip':
        return createGunzip();
      case 'deflate':
        return createInflate();
      case 'br':
        return createBrotliDecompress();
      default:
        return null;
    }
  })();
  if (!decoder) return incoming;
  // pipe() は元の stream の中断を展開側へ伝えないので、途中で切れたときも本文の読み取りが終わるよう pipeline でつなぐ
  pipeline(incoming, decoder, () => undefined);
  return decoder;
}

function requestPinned(url: URL, init: PublicRequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  // 圧縮しないよう求める。無視して圧縮してきたサーバーは decodedBody で展開する
  headers.set('accept-encoding', 'identity');
  const method = init.method ?? 'GET';

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method,
        headers: Object.fromEntries(headers),
        lookup: guardedLookup,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      incoming => {
        // 相手が返すステータスは任意なので、Response にできない値（200〜599 の外など）も reject で返す
        try {
          const status = incoming.statusCode ?? 0;
          if (status < 200 || status > 599) {
            throw new Error(`Unsupported response status: ${status}`);
          }
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
              responseHeaders.append(name, item);
            }
          }
          const hasBody = method !== 'HEAD' && !NULL_BODY_STATUSES.has(status);
          if (!hasBody) incoming.resume();
          resolve(
            new Response(
              hasBody ? (Readable.toWeb(decodedBody(incoming)) as ReadableStream<Uint8Array>) : null,
              { status, statusText: incoming.statusMessage ?? '', headers: responseHeaders }
            )
          );
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      }
    );
    request.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out after ${SOCKET_IDLE_TIMEOUT_MS}ms of inactivity`));
    });
    request.on('error', reject);
    // 101 は応答のコールバックに来ず upgrade イベントになる。応答前に閉じた場合も含め、待ち続けないよう reject する
    request.on('upgrade', (_incoming, socket) => {
      socket.destroy();
      reject(new Error('Unsupported response status: 101'));
    });
    request.on('close', () => reject(new Error('Connection closed before a response')));
    request.end(init.body);
  });
}

/**
 * 利用者が入力した URL へ、公開アドレスにだけ接続する。リダイレクトは自分で追い、各ホップの宛先も検査する。
 * 別オリジンへのリダイレクトでは Authorization を送らない（fetch の自動追従と同じ扱い）。
 */
export async function fetchPublicUrl(rawUrl: string, init: PublicRequestInit = {}): Promise<Response> {
  let currentUrl = rawUrl;
  let currentInit = init;
  let originalOrigin: string | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const shape = checkUrlShape(currentUrl);
    if (!shape.ok) throw new PublicUrlBlockedError(shape.reason);
    originalOrigin ??= shape.url.origin;

    const response = await requestPinned(shape.url, currentInit);
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
    await response.body?.cancel();

    const nextUrl = new URL(location, shape.url);
    if (nextUrl.origin !== originalOrigin && currentInit.headers) {
      const headers = new Headers(currentInit.headers);
      headers.delete('authorization');
      currentInit = { ...currentInit, headers };
    }
    currentUrl = nextUrl.toString();
  }
  throw new PublicUrlBlockedError('too_many_redirects');
}
