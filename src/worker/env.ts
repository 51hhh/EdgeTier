export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
  DIRECTORY: DurableObjectNamespace;
  ASSETS?: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  RELAY_TOKEN_SECRET?: string;
}
