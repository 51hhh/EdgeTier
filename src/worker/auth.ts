const SESSION_COOKIE_NAME = '__Host-edgetier_session';
const SESSION_TOKEN_TYPE = 'edgetier-session';
const RELAY_TOKEN_TYPE = 'edgetier-ws';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const RELAY_TOKEN_TTL_SECONDS = 5 * 60;

const textEncoder = new TextEncoder();

export interface AuthEnv {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  RELAY_TOKEN_SECRET?: string;
}

export interface SessionClaims {
  sub: string;
  typ: typeof SESSION_TOKEN_TYPE;
  iat: number;
  exp: number;
  jti: string;
}

export interface RelayTokenClaims {
  sub: string;
  typ: typeof RELAY_TOKEN_TYPE;
  room: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface VerifiedSession {
  username: string;
  expiresAt: string;
}

export type RelayTokenVerification =
  | { ok: true; claims: RelayTokenClaims }
  | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'room_mismatch' | 'bad_signature' | 'unconfigured' };

export function authConfigured(env: AuthEnv): boolean {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD && env.SESSION_SECRET && env.RELAY_TOKEN_SECRET);
}

export function sessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export async function createSessionCookie(env: AuthEnv, username: string, now = currentUnixSeconds()): Promise<string> {
  const token = await signToken(env.SESSION_SECRET, {
    sub: username,
    typ: SESSION_TOKEN_TYPE,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: crypto.randomUUID(),
  } satisfies SessionClaims);
  return serializeCookie(SESSION_COOKIE_NAME, token, SESSION_TTL_SECONDS);
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function verifySessionRequest(request: Request, env: AuthEnv, now = currentUnixSeconds()): Promise<VerifiedSession | null> {
  const cookie = getCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (!cookie || !env.SESSION_SECRET) return null;
  const claims = await verifyToken<SessionClaims>(env.SESSION_SECRET, cookie);
  if (!claims || claims.typ !== SESSION_TOKEN_TYPE || typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
  if (claims.exp <= now) return null;
  return { username: claims.sub, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

export async function credentialsValid(env: AuthEnv, username: string, password: string): Promise<boolean> {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return false;
  return constantTimeStringEqual(username, env.ADMIN_USERNAME) && constantTimeStringEqual(password, env.ADMIN_PASSWORD);
}

export async function issueRelayToken(env: AuthEnv, roomId: string, username: string, now = currentUnixSeconds()): Promise<{ token: string; expiresAt: string }> {
  const exp = now + RELAY_TOKEN_TTL_SECONDS;
  const token = await signToken(env.RELAY_TOKEN_SECRET, {
    sub: username,
    typ: RELAY_TOKEN_TYPE,
    room: roomId,
    iat: now,
    exp,
    jti: crypto.randomUUID(),
  } satisfies RelayTokenClaims);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifyRelayToken(env: AuthEnv, token: string | null, roomId: string, now = currentUnixSeconds()): Promise<RelayTokenVerification> {
  if (!token) return { ok: false, reason: 'missing' };
  if (!env.RELAY_TOKEN_SECRET) return { ok: false, reason: 'unconfigured' };
  const claims = await verifyToken<RelayTokenClaims>(env.RELAY_TOKEN_SECRET, token);
  if (!claims) return { ok: false, reason: token.split('.').length === 3 ? 'bad_signature' : 'malformed' };
  if (claims.typ !== RELAY_TOKEN_TYPE || typeof claims.sub !== 'string' || typeof claims.room !== 'string' || typeof claims.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (claims.exp <= now) return { ok: false, reason: 'expired' };
  if (claims.room !== roomId) return { ok: false, reason: 'room_mismatch' };
  return { ok: true, claims };
}

export async function signRelayTokenForTest(env: AuthEnv, claims: RelayTokenClaims): Promise<string> {
  return signToken(env.RELAY_TOKEN_SECRET, claims);
}

async function signToken(secret: string | undefined, claims: object): Promise<string> {
  if (!secret) throw new Error('auth secret is not configured');
  const payload = base64UrlEncode(textEncoder.encode(JSON.stringify(claims)));
  const signed = `v1.${payload}`;
  const signature = await hmacSha256(secret, signed);
  return `${signed}.${base64UrlEncode(signature)}`;
}

async function verifyToken<T extends object>(secret: string, token: string): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const signed = `${parts[0]}.${parts[1]}`;
  const expected = await hmacSha256(secret, signed);
  const actual = base64UrlDecode(parts[2]);
  if (!actual || !constantTimeBytesEqual(actual, expected)) return null;
  const payload = base64UrlDecode(parts[1]);
  if (!payload) return null;
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as T;
  } catch {
    return null;
  }
}

async function hmacSha256(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return new Uint8Array(signature);
}

function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=') || null;
  }
  return null;
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  return constantTimeBytesEqual(textEncoder.encode(left), textEncoder.encode(right));
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
