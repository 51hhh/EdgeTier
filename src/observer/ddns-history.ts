import type { DdnsAddressHistoryEntry, DdnsHistoryEntry, DdnsObservation } from './host-types';
import { validIpv6 } from './host-validation';

export const DDNS_HISTORY_LIMIT = 64;
export const DDNS_ADDRESS_LIMIT = 16;

export function successfulDdns(observation: DdnsObservation): boolean {
  return ['updated', 'unchanged', 'check_ok'].includes(observation.status);
}

function address(value: string | undefined): string | undefined {
  return value && validIpv6(value, true) ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : undefined;
}

function signature(observation: DdnsObservation): string {
  return JSON.stringify([observation.name.toLowerCase(), successfulDdns(observation) ? 'success' : observation.status,
    address(observation.ipv6), address(observation.currentIpv6), observation.ttl, observation.proxied,
    successfulDdns(observation) ? undefined : observation.errorCode]);
}

/** Keep state transitions, not one row per heartbeat; timestamps never form the grouping key. */
export function appendDdnsHistory(history: DdnsHistoryEntry[], observation: DdnsObservation,
  receivedAt: string, count = 1, firstReceivedAt = receivedAt, recovered = false): DdnsHistoryEntry[] {
  const previous = history.at(-1);
  if (previous && signature(previous.observation) === signature(observation)) {
    const { recovered: _recovered, ...retained } = previous;
    return [...history.slice(0, -1), { ...retained, observation, receivedAt,
      firstReceivedAt: previous.firstReceivedAt ?? previous.receivedAt,
      count: Math.min(Number.MAX_SAFE_INTEGER, (previous.count ?? 1) + count),
      ...(previous.recovered && recovered ? { recovered: true } : {}) }];
  }
  return [...history, { observation, receivedAt, firstReceivedAt, count, ...(recovered ? { recovered: true } : {}) }].slice(-DDNS_HISTORY_LIMIT);
}

/** Old raw heartbeat windows can retain a last-success checkpoint even after its row was evicted. */
export function restoreDdnsHistory(history: DdnsHistoryEntry[], current?: DdnsObservation): DdnsHistoryEntry[] {
  let rows = history.reduce<DdnsHistoryEntry[]>((result, row) => appendDdnsHistory(result, row.observation,
    row.receivedAt, row.count ?? 1, row.firstReceivedAt ?? row.receivedAt, row.recovered), []);
  if (current?.lastSuccessAt && address(current.ipv6) && current.proxied === false
    && !rows.some((row) => successfulDdns(row.observation) && address(row.observation.ipv6) === address(current.ipv6)
      && Date.parse(row.observation.lastSuccessAt ?? row.receivedAt) >= Date.parse(current.lastSuccessAt!))) {
    const { errorCode: _error, currentIpv6: _current, ...known } = current;
    const checkpoint: DdnsHistoryEntry = { receivedAt: current.lastSuccessAt, firstReceivedAt: current.lastSuccessAt,
      count: 1, recovered: true, observation: { ...known, status: 'check_ok', lastAttemptAt: current.lastSuccessAt } };
    rows = [...rows, checkpoint].sort((left, right) => Date.parse(left.firstReceivedAt ?? left.receivedAt) - Date.parse(right.firstReceivedAt ?? right.receivedAt));
  }
  return rows.slice(-DDNS_HISTORY_LIMIT);
}

/** A separate bounded address ledger survives arbitrarily many failure transitions. */
export function rememberDdnsAddress(history: DdnsAddressHistoryEntry[], observation: DdnsObservation): DdnsAddressHistoryEntry[] {
  const ipv6 = address(observation.ipv6);
  const at = observation.lastSuccessAt;
  if (!ipv6 || !at || !Number.isFinite(Date.parse(at)) || observation.proxied !== false) return history;
  const previous = history.find((entry) => entry.ipv6 === ipv6);
  const newer = !previous || Date.parse(at) > Date.parse(previous.lastSuccessAt);
  const entry: DdnsAddressHistoryEntry = { ipv6,
    firstSuccessAt: previous && Date.parse(previous.firstSuccessAt) < Date.parse(at) ? previous.firstSuccessAt : at,
    lastSuccessAt: previous && !newer ? previous.lastSuccessAt : at,
    successCount: previous ? Math.min(Number.MAX_SAFE_INTEGER, previous.successCount + (newer ? 1 : 0)) : 1 };
  return [...history.filter((item) => item.ipv6 !== ipv6), entry]
    .sort((left, right) => Date.parse(left.lastSuccessAt) - Date.parse(right.lastSuccessAt)).slice(-DDNS_ADDRESS_LIMIT);
}
