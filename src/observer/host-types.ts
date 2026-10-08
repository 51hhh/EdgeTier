/** Credential-free contracts shared by host ingestion and the dashboard. */
export interface HostProfile {
  hostId: string;
  displayName: string;
  roomId: string;
  networkName: string;
  directHostname: string;
  directPort: number;
}

export interface DdnsObservation {
  name: string;
  status: 'updated' | 'unchanged' | 'check_ok' | 'error' | 'unknown';
  ipv6?: string;
  currentIpv6?: string;
  ttl?: number;
  proxied?: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  errorCode?: string;
}

export interface HostService {
  unit: string;
  activeState: string;
  subState: string;
  /** Persistently enabled in the unit file, not a guarantee of startup. */
  enabled: boolean;
  unitFileState?: string;
  result?: string;
  exitCode?: number;
}

export interface HostNode {
  peerId: number;
  hostname: string;
  version: string;
  virtualIpv4?: string;
  virtualIpv6?: string;
  listeners: string[];
  proxyCidrs: string[];
}

export interface HostPeerConnection {
  transport: string;
  remoteAddress?: string;
  latencyMs?: number;
  lossRate?: number;
  rxBytes: number;
  txBytes: number;
}

export interface HostPeer {
  peerId: number;
  hostname?: string;
  version?: string;
  virtualIpv4?: string;
  proxyCidrs: string[];
  nextHopPeerId?: number;
  cost?: number;
  connections: HostPeerConnection[];
}

export interface HostCommandAck {
  id: string;
  status: 'completed' | 'failed';
  completedAt: string;
  errorCode?: string;
}

export interface HostReport {
  schemaVersion: 1;
  hostId: string;
  reportId: string;
  bootId: string;
  sequence: number;
  capturedAt: string;
  collectorVersion: string;
  ddns: DdnsObservation;
  services: HostService[];
  easytier: {
    status: 'ok' | 'error'; node?: HostNode; peers: HostPeer[]; errorCode?: string;
    /** Optional topology was reduced to schema/serialized report limits. */
    truncated?: boolean;
    omittedPeers?: number;
  };
  commandAck?: HostCommandAck;
}

export interface HostCommand {
  id: string;
  kind: 'ddns-refresh';
  status: 'pending' | 'completed' | 'failed';
  requestedAt: string;
  expiresAt: string;
  completedAt?: string;
  errorCode?: string;
}

export interface DdnsHistoryEntry {
  receivedAt: string;
  observation: DdnsObservation;
  firstReceivedAt?: string;
  count?: number;
  recovered?: boolean;
}

export interface DdnsAddressHistoryEntry {
  ipv6: string;
  firstSuccessAt: string;
  lastSuccessAt: string;
  successCount: number;
}

export interface HostSnapshot {
  profile: HostProfile;
  report?: HostReport;
  receivedAt?: string;
  freshness: 'fresh' | 'stale' | 'never';
  ddnsHistory: DdnsHistoryEntry[];
  ddnsAddressHistory?: DdnsAddressHistoryEntry[];
  command?: HostCommand;
  readErrorCode?: 'host_state_unavailable';
}

export interface HostReportResponse {
  accepted: boolean;
  duplicate?: boolean;
  command?: Pick<HostCommand, 'id' | 'kind' | 'expiresAt'>;
}

export interface ConfigProfile extends HostProfile {
  freshness: HostSnapshot['freshness'];
  ddnsStatus: DdnsObservation['status'];
  confirmedIpv6?: string;
  verifiedAt?: string;
  directVerification?: 'verified' | 'failed' | 'stale' | 'mismatch' | 'unknown';
  directPeers: string[];
  ipv6Only: true;
  readErrorCode?: HostSnapshot['readErrorCode'];
}
