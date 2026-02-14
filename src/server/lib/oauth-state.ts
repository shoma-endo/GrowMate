import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface OAuthStatePayload {
  nonce: string;
  userId: string;
  returnTo?: string;
  issuedAt: number;
  version: 'v1';
}

const STATE_VERSION: OAuthStatePayload['version'] = 'v1';
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

const encode = (payload: OAuthStatePayload) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decode = (input: string): OAuthStatePayload | null => {
  try {
    const json = Buffer.from(input, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      parsed.version === STATE_VERSION &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.userId === 'string' &&
      typeof parsed.issuedAt === 'number'
    ) {
      return parsed as OAuthStatePayload;
    }
    return null;
  } catch {
    return null;
  }
};

const sign = (payloadEncoded: string, secret: string) =>
  createHmac('sha256', secret).update(payloadEncoded).digest('base64url');

export function generateOAuthState(
  userId: string,
  secret: string,
  returnTo?: string
): { state: string; payload: OAuthStatePayload } {
  const payload: OAuthStatePayload = {
    nonce: randomBytes(16).toString('hex'),
    userId,
    ...(returnTo ? { returnTo } : {}),
    issuedAt: Date.now(),
    version: STATE_VERSION,
  };
  const encoded = encode(payload);
  const signature = sign(encoded, secret);
  return {
    state: `${encoded}.${signature}`,
    payload,
  };
}

export function verifyOAuthState(
  state: string,
  secret: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): { valid: true; payload: OAuthStatePayload } | { valid: false; reason: string } {
  const [rawPayload, signature] = state.split('.', 2);
  if (!rawPayload || !signature) {
    return { valid: false, reason: 'invalid_state_format' };
  }

  const expectedSignature = sign(rawPayload, secret);
  if (!constantTimeEquals(signature, expectedSignature)) {
    return { valid: false, reason: 'invalid_state_signature' };
  }

  const payload = decode(rawPayload);
  if (!payload) {
    return { valid: false, reason: 'invalid_state_payload' };
  }

  if (Date.now() - payload.issuedAt > maxAgeMs) {
    return { valid: false, reason: 'state_expired' };
  }

  return { valid: true, payload };
}

function constantTimeEquals(a: string, b: string) {
  const bufA: Buffer = Buffer.from(a, 'utf8');
  const bufB: Buffer = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
