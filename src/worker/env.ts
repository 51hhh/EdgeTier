export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
  DIRECTORY: DurableObjectNamespace;
  ASSETS?: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  RELAY_TOKEN_SECRET?: string;
  EASYTIER_NETWORK_NAME?: string;
  EASYTIER_NETWORK_SECRET?: string;
  EASYTIER_NETWORK_SECRETS?: string;
}
