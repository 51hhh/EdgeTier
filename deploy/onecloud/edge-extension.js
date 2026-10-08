import legacy, { Directory, ConfigServerProbe } from './legacy.js';
import modern, { RelayRoom, HostState } from './modern.js';

export { RelayRoom, Directory, ConfigServerProbe, HostState };
export const RELEASE_VERSION = '0.2.3';
export const RELAY_IMPLEMENTATION = 'modern';

const REPORT_PATH = /^\/api\/hosts\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/report$/;

// Legacy owns Cloudflare Access, the management hostname gate, login cookies,
// official Web bridge and public relay admission. Its room/WS handlers address
// the existing namespace, whose same-named class export is now repaired modern code.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (REPORT_PATH.test(path)) return modern.fetch(request, env, ctx);
    if (path === '/api/hosts' || path.startsWith('/api/hosts/') || path === '/api/config-profiles') {
      // Use the authoritative retained management gate, including Access validation.
      // Do not recreate its hostname/auth policy or substitute a cookie-only check.
      const gateUrl = new URL(request.url);
      gateUrl.pathname = '/api/auth/me';
      gateUrl.search = '';
      const gate = await legacy.fetch(new Request(gateUrl, { method: 'GET', headers: request.headers }), env, ctx);
      if (!gate.ok) return gate;
      return modern.fetch(request, env, ctx);
    }

    let response;
    try {
      response = await legacy.fetch(request, env, ctx);
    } catch (error) {
      if (error instanceof URIError && path.startsWith('/api/rooms/')) {
        return Response.json({ error: 'invalid room name' }, { status: 400 });
      }
      throw error;
    }
    if (path !== '/api/health' || !response.ok || request.method === 'HEAD') return response;
    const data = await response.json();
    // The selected class owns these mode labels, even if old health metadata is stale.
    const inheritedCapabilities = (Array.isArray(data.capabilities) ? data.capabilities : [])
      .filter((capability) => capability !== 'relay-lifecycle' && capability !== 'legacy-relay-recovery');
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ...data, version: RELEASE_VERSION, relayImplementation: RELAY_IMPLEMENTATION,
      capabilities: [...new Set([...inheritedCapabilities, 'host-status', 'ddns-management', 'config-profiles', ...(RELAY_IMPLEMENTATION === 'modern' ? ['relay-lifecycle'] : ['legacy-relay-recovery'])])],
    }), { status: response.status, headers });
  },
};
