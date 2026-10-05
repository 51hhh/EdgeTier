export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
  DIRECTORY: DurableObjectNamespace;
  HOST_STATE?: DurableObjectNamespace;
  HOST_PROFILES?: string;
  HOST_REPORT_TOKENS?: string;
  ASSETS?: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  RELAY_TOKEN_SECRET?: string;
  EASYTIER_NETWORK_NAME?: string;
  EASYTIER_NETWORK_SECRET?: string;
  EASYTIER_NETWORK_SECRETS?: string;
  EASYTIER_NETWORKS?: string;
  EASYTIER_PUBLIC_PEER_TCP?: string;
  EASYTIER_OUTBOUND_TCP_PEERS?: string;
}
