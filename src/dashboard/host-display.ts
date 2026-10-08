import type { ConfigProfile, HostCommand, HostSnapshot } from '../observer/host-types';

/** Keep last known data but never leave it labelled fresh after a failed poll. */
export function observedFreshness(host: HostSnapshot, now = Date.now()): HostSnapshot['freshness'] {
  if (!host.report || !host.receivedAt) return 'never';
  if (host.readErrorCode) return 'stale';
  const age = now - Date.parse(host.receivedAt);
  return host.freshness === 'fresh' && Number.isFinite(age) && age >= -300_000 && age <= 300_000 ? 'fresh' : 'stale';
}

export function commandPending(command: HostCommand | undefined, now = Date.now()): boolean {
  return Boolean(command?.status === 'pending' && Date.parse(command.expiresAt) > now);
}

export function reportAgeSeconds(host: HostSnapshot, now = Date.now()): number | undefined {
  if (!host.receivedAt) return undefined;
  const age = now - Date.parse(host.receivedAt);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age / 1000)) : undefined;
}

/** A per-host failed read keeps only observations belonging to the same profile. */
export function mergeHostSnapshots(previous: HostSnapshot[], incoming: HostSnapshot[]): HostSnapshot[] {
  const priorById = new Map(previous.map((host) => [host.profile.hostId, host]));
  return incoming.map((host) => {
    const prior = priorById.get(host.profile.hostId);
    if (!host.readErrorCode || !prior || !sameProfileIdentity(prior, host)) return host;
    return { ...prior, profile: host.profile, freshness: prior.report ? 'stale' : 'never', readErrorCode: host.readErrorCode };
  });
}

export function unavailableHostSnapshots(hosts: HostSnapshot[]): HostSnapshot[] {
  return hosts.map((host) => ({ ...host, freshness: host.report ? 'stale' : 'never', readErrorCode: 'host_state_unavailable' }));
}

export function unavailableConfigProfiles(profiles: ConfigProfile[]): ConfigProfile[] {
  return profiles.map((profile) => ({ ...profile, freshness: 'stale', ddnsStatus: 'unknown',
    directVerification: 'unknown', confirmedIpv6: undefined, verifiedAt: undefined, readErrorCode: 'host_state_unavailable' }));
}

function sameProfileIdentity(left: HostSnapshot, right: HostSnapshot): boolean {
  return left.profile.hostId === right.profile.hostId && left.profile.roomId === right.profile.roomId
    && left.profile.networkName === right.profile.networkName && left.profile.directHostname === right.profile.directHostname
    && left.profile.directPort === right.profile.directPort;
}
