import type { HostProfile, HostSnapshot } from './host-types';
import { configProfile, MAX_HOST_REPORT_BYTES, parseHostProfiles, validateHostReport } from './host-validation';
import type { Env } from '../worker/env';
import { json } from './api';

const HOST_PATH = /^\/api\/hosts\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:\/(report|ddns-refresh))?$/;

export function isHostReportPath(pathname: string): boolean { return HOST_PATH.exec(pathname)?.[2] === 'report'; }

function hostStub(env: Env, profile: HostProfile): DurableObjectStub | null {
  return env.HOST_STATE ? env.HOST_STATE.get(env.HOST_STATE.idFromName(profile.hostId)) : null;
}

async function fetchHost(stub: DurableObjectStub, url: string, init?: RequestInit): Promise<Response> {
  try { return await stub.fetch(url, init); }
  catch { return json({ error: 'host state unavailable' }, 503); }
}

async function readHost(env: Env, profile: HostProfile): Promise<HostSnapshot> {
  const unavailable = (): HostSnapshot => ({ profile, freshness: 'never', ddnsHistory: [], readErrorCode: 'host_state_unavailable' });
  try {
    const stub = hostStub(env, profile);
    if (!stub) return unavailable();
    const response = await fetchHost(stub, `https://host/?hostId=${encodeURIComponent(profile.hostId)}`);
    if (!response.ok) return unavailable();
    const snapshot = await response.json() as HostSnapshot;
    if (!snapshot || snapshot.profile?.hostId !== profile.hostId || !Array.isArray(snapshot.ddnsHistory)
      || !['fresh', 'stale', 'never'].includes(snapshot.freshness)) return unavailable();
    // Validate at the original receipt time so old, correctly stored reports stay visible.
    if (snapshot.report !== undefined && (!snapshot.receivedAt
      || !validateHostReport(snapshot.report, profile.hostId, Date.parse(snapshot.receivedAt)))) return unavailable();
    return { ...snapshot, profile };
  } catch { return unavailable(); }
}

function configuredProfiles(env: Env): HostProfile[] | Response {
  return parseHostProfiles(env.HOST_PROFILES) ?? json({ error: 'host profiles are not configured correctly' }, 503);
}

async function hostTokenValid(request: Request, env: Env, hostId: string): Promise<boolean> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  let tokens: unknown;
  try { tokens = JSON.parse(env.HOST_REPORT_TOKENS ?? '{}'); } catch { return false; }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return false;
  const expected = (tokens as Record<string, unknown>)[hostId];
  const supplied = authorization.slice(7);
  if (typeof expected !== 'string' || expected.length < 32 || expected.length > 256 || supplied.length > 256) return false;
  // Equal-length hashes avoid early comparison of secret bytes or timing by token length.
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([hash(expected), hash(supplied)]);
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function limitedJson(request: Request): Promise<{ value: unknown } | Response> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_HOST_REPORT_BYTES)) return json({ error: 'host report too large' }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'invalid host report' }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HOST_REPORT_BYTES) { await reader.cancel(); return json({ error: 'host report too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch { return json({ error: 'invalid host report' }, 400); }
}

/** Host bearer authentication is intentionally independent of dashboard cookies. */
export async function handleHostReport(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const match = HOST_PATH.exec(new URL(request.url).pathname);
  if (!match || match[2] !== 'report') return json({ error: 'host not found' }, 404);
  const profiles = configuredProfiles(env);
  if (profiles instanceof Response) return profiles;
  const profile = profiles.find((entry) => entry.hostId === match[1]);
  if (!profile || !await hostTokenValid(request, env, profile.hostId)) return json({ error: 'invalid host credentials' }, 401);
  const body = await limitedJson(request);
  if (body instanceof Response) return body;
  const report = validateHostReport(body.value, profile.hostId);
  if (!report) return json({ error: 'invalid host report' }, 400);
  const stub = hostStub(env, profile);
  if (!stub) return json({ error: 'host storage is not configured' }, 503);
  return fetchHost(stub, `https://host/report?hostId=${encodeURIComponent(profile.hostId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
}

/** Called only after the Worker verifies an administrator session. */
export async function handleHostApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = HOST_PATH.exec(url.pathname);
  if (url.pathname !== '/api/hosts' && url.pathname !== '/api/config-profiles' && !match) return null;
  if (match?.[2] === 'report') return json({ error: 'invalid host credentials' }, 401);
  const profiles = configuredProfiles(env);
  if (profiles instanceof Response) return profiles;
  if (!match) {
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    if (profiles.length && !env.HOST_STATE) return json({ error: 'host storage is not configured' }, 503);
    const snapshots = await Promise.all(profiles.map((profile) => readHost(env, profile)));
    return url.pathname === '/api/hosts' ? json({ hosts: snapshots }) : json({ profiles: snapshots.map((snapshot) => configProfile(snapshot)) });
  }
  const profile = profiles.find((entry) => entry.hostId === match[1]);
  if (!profile) return json({ error: 'host not found' }, 404);
  const action = match[2];
  if (action === 'ddns-refresh') {
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'same origin required' }, 403);
  } else if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const stub = hostStub(env, profile);
  if (!stub) return json({ error: 'host storage is not configured' }, 503);
  return fetchHost(stub, `https://host/${action ?? ''}?hostId=${encodeURIComponent(profile.hostId)}`, { method: action ? 'POST' : 'GET' });
}
