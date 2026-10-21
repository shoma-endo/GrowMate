import 'server-only';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
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

/**
 * 利用者が入力した URL へサーバーから接続してよいか（https で、名前解決の結果が公開アドレスだけか）を確かめる。
 * 確認後に DNS の応答が変わる DNS rebinding は防げない。防ぐには解決したアドレスへ直接接続する仕組みが要る。
 */
export async function checkPublicHttpsUrl(
  rawUrl: string
): Promise<{ ok: true; url: URL } | { ok: false; reason: PublicUrlRejectReason }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isBlockedAddress(host) ? { ok: false, reason: 'private_address' } : { ok: true, url };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'dns_failed' };
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    return { ok: false, reason: 'private_address' };
  }
  return { ok: true, url };
}

/**
 * {@link checkPublicHttpsUrl} を通った URL にだけ fetch する。リダイレクトは自分で追い、各ホップの宛先も検査する。
 * 別オリジンへのリダイレクトでは Authorization を送らない（fetch の自動追従と同じ扱い）。
 */
export async function fetchPublicUrl(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl = rawUrl;
  let currentInit = init;
  let originalOrigin: string | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = await checkPublicHttpsUrl(currentUrl);
    if (!check.ok) throw new PublicUrlBlockedError(check.reason);
    originalOrigin ??= check.url.origin;

    const response = await fetch(check.url.href, { ...currentInit, redirect: 'manual' });
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
    await response.body?.cancel();

    const nextUrl = new URL(location, check.url);
    if (nextUrl.origin !== originalOrigin && currentInit.headers) {
      const headers = new Headers(currentInit.headers);
      headers.delete('authorization');
      currentInit = { ...currentInit, headers };
    }
    currentUrl = nextUrl.toString();
  }
  throw new PublicUrlBlockedError('too_many_redirects');
}
