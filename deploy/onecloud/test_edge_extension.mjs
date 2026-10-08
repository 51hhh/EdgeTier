import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let temporary, entry, recovery, modern, legacy;

// A fixture models only the retained gate/dispatch contracts verified in place.
// It is not exported production source and does not claim to verify Access JWT cryptography.
const legacyFixture = `
import modern from './modern.js';
export class RelayRoom {}
export class Directory {}
export class ConfigServerProbe {}
export const calls = [];
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    calls.push({path, hostname:url.hostname, method:request.method,
      cookie:request.headers.get('Cookie'), access:request.headers.get('CF-Access-Jwt-Assertion'),
      origin:request.headers.get('Origin'), env, ctx});
    if (path === '/ws') return modern.fetch(request, env, ctx);
    if (path === '/config-server/ws') return new Response('legacy config server', {headers:{'X-Fixture':'config-server'}});
    const expected = (env.ADMIN_HOSTNAME || '').trim().toLowerCase();
    if (!expected || url.hostname !== expected) return new Response('Not found', {status:404});
    if (!env.CF_ACCESS_AUD || !env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.RELAY_TOKEN_SECRET)
      return Response.json({error:'management auth is not configured'}, {status:503});
    if (request.headers.get('CF-Access-Jwt-Assertion') !== 'fixture-approved-access')
      return Response.json({error:'access denied'}, {status:403});
    if (path === '/api/auth/login') return new Response('legacy login', {headers:{'Set-Cookie':env.FIXTURE_LOGIN_COOKIE}});
    if (path === '/login') return new Response('legacy login page');
    const gateUrl = new URL(url); gateUrl.pathname='/api/auth/me'; gateUrl.search='';
    const session = await modern.fetch(new Request(gateUrl, {headers:request.headers}), env, ctx);
    if (!session.ok) return session;
    if (path === '/api/auth/me') return session;
    if (path === '/api/health') {
      if (request.method === 'HEAD') return new Response(null, {headers:{'X-Fixture':'legacy-head'}});
      return Response.json({ok:true, service:'edgetier', version:'fixture-old-version', capabilities:['official-web-bridge','private-auth','relay-lifecycle','legacy-relay-recovery']},
        {headers:{'Cache-Control':'no-store'}});
    }
    if (path === '/api/default-room') return Response.json({roomId:'home',networkName:'mesh',fixture:'legacy-default'});
    if (path === '/api/rooms') return env.DIRECTORY.get(env.DIRECTORY.idFromName('global')).fetch('https://directory/');
    const match = /^\\/api\\/rooms\\/([^/]+)$/.exec(path);
    if (match) {
      const room = decodeURIComponent(match[1]);
      return env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(room)).fetch('https://room/?room='+encodeURIComponent(room));
    }
    if (path === '/api/rooms/home/legacy-only') return new Response('legacy room extension');
    if (path === '/api/rooms/home/token') return modern.fetch(request, env, ctx);
    if (path === '/api/easytier-web/services') return new Response('legacy official bridge', {headers:{'X-Fixture':'bridge'}});
    if (path === '/api/fault') throw new URIError('fixture unrelated legacy error');
    return new Response('legacy fallback', {headers:{'X-Fixture':'fallback'}});
  }
};
`;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'edgetier-entry-test-'));
  await writeFile(join(temporary, 'package.json'), JSON.stringify({type:'module'}));
  const built = await build({ entryPoints: [join(repo, 'src/worker/index.ts')], bundle: true, write: false,
    format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:sockets'], logLevel: 'silent' });
  await writeFile(join(temporary, 'modern.js'), built.outputFiles[0].contents);
  await writeFile(join(temporary, 'legacy.js'), legacyFixture);
  await writeFile(join(temporary, 'index.js'), await readFile(join(repo, 'deploy/onecloud/edge-extension.js')));
  const recoverySource = execFileSync('python3', ['-B', '-c', `import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('rollout',Path('deploy/onecloud/rollout-edgetier.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print(module.recovery_entry(Path('deploy/onecloud/edge-extension.js').read_text()),end='')`], {cwd:repo,encoding:'utf8'});
  await writeFile(join(temporary, 'recovery.js'), recoverySource);
  recovery = await import(pathToFileURL(join(temporary, 'recovery.js')).href);
  modern = await import(pathToFileURL(join(temporary, 'modern.js')).href);
  legacy = await import(pathToFileURL(join(temporary, 'legacy.js')).href);
  entry = await import(pathToFileURL(join(temporary, 'index.js')).href);
});
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

function state(name, seed = {}) {
  const values = new Map(Object.entries(seed));
  const pending = [];
  let alarm = null;
  return { values, pending, id: { name }, storage: {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async getAlarm() { return alarm; }, async setAlarm(value) { alarm = value; },
  }, blockConcurrencyWhile(callback) { const result = callback(); pending.push(result); return result; },
  waitUntil(promise) { pending.push(promise); promise.catch(() => undefined); } };
}

async function environment() {
  legacy.calls.length = 0;
  const profile = {hostId:'fixture-host',displayName:'Fixture',roomId:'home',networkName:'mesh',directHostname:'v6.example.org',directPort:11010};
  const directoryData = {rooms:[{roomId:'home',peerCount:1,websocketCount:0,bytes:17}]};
  const relayState = state('home', { 'control-state:v1': {
    roomId:'home',routeVersion:7,routePeers:[{peerId:42,hostname:'preserved-node',lastSeen:new Date().toISOString(),proxyCidrs:[]}],
    rawRoutePeerInfos:[{peerId:42,version:3,hostname:'preserved-node',proxyCidrs:[]}],connBitmapPeerIds:[],connBitmapEdges:[],peerCenter:[],outboundRoomIds:[],
  }, 'fixture-sentinel': { retained:true } });
  const hostState = state('fixture-host');
  const relayCalls = [];
  let relayObject, hostObject;
  const relayBinding = Object.freeze({idFromName:name=>name, get:name=>({async fetch(input, init) {
    relayCalls.push({name,input});
    if (new URL(typeof input === 'string' ? input : input.url).pathname === '/connect') return new Response('existing relay binding');
    return relayObject.fetch(new Request(input, init));
  }})});
  const directoryBinding = Object.freeze({idFromName:name=>name,get:()=>({fetch:async()=>Response.json(directoryData)})});
  const hostBinding = Object.freeze({idFromName:name=>name,get:()=>({fetch:async(input,init)=>hostObject.fetch(new Request(input,init))})});
  const env = {ADMIN_HOSTNAME:' ADMIN.EXAMPLE.ORG ',CF_ACCESS_AUD:'fixture-access-audience',
    ADMIN_USERNAME:'fixture-admin',ADMIN_PASSWORD:'fixture-password',SESSION_SECRET:'fixture-session-key',RELAY_TOKEN_SECRET:'fixture-relay-key',
    RELAY_ROOM:relayBinding,DIRECTORY:directoryBinding,HOST_STATE:hostBinding,
    HOST_PROFILES:JSON.stringify([profile]),HOST_REPORT_TOKENS:JSON.stringify({'fixture-host':'fixture-host-scoped-token-at-least-32'}),
    EASYTIER_NETWORKS:JSON.stringify({home:{networkName:'mesh',secret:'fixture-mesh-secret'}})};
  relayObject = new entry.RelayRoom(relayState, env);
  hostObject = new entry.HostState(hostState, env);
  await Promise.all([...relayState.pending, ...hostState.pending]);
  const login = await modern.default.fetch(new Request('https://admin.example.org/api/auth/login', {method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD})}), env);
  env.FIXTURE_LOGIN_COOKIE = login.headers.get('Set-Cookie');
  return {env:Object.freeze(env),ctx:Object.freeze({fixture:true}),cookie:env.FIXTURE_LOGIN_COOKIE.split(';')[0],profile,relayState,hostState,directoryData,relayCalls};
}

function request(fixture, path, options = {}) {
  const {hostname='admin.example.org', access=true, cookie=true, headers={}, ...init} = options;
  return new Request('https://'+hostname+path, {...init, headers:{...(access?{'CF-Access-Jwt-Assertion':'fixture-approved-access'}:{}),
    ...(cookie?{Cookie:fixture.cookie}:{}),...headers}});
}

test('assembled exports replace only the relay implementation and retain the class names', async () => {
  assert.equal(entry.RelayRoom, modern.RelayRoom);
  assert.notEqual(entry.RelayRoom, legacy.RelayRoom);
  assert.equal(entry.Directory, legacy.Directory);
  assert.equal(entry.ConfigServerProbe, legacy.ConfigServerProbe);
  assert.equal(entry.HostState, modern.HostState);
  assert.deepEqual(['RelayRoom','Directory','ConfigServerProbe','HostState'].map(name=>entry[name].name),
    ['RelayRoom','Directory','ConfigServerProbe','HostState']);
});

test('legacy room dispatch uses the modern class in the same binding and preserves existing storage', async () => {
  const f = await environment();
  const binding = f.env.RELAY_ROOM;
  const response = await entry.default.fetch(request(f, '/api/rooms/home'),f.env,f.ctx);
  assert.equal(response.status,200);
  const snapshot = await response.json();
  assert.equal(snapshot.roomId,'home');
  assert.ok(snapshot.peers.some(peer=>peer.hostname==='preserved-node'));
  assert.equal(f.env.RELAY_ROOM,binding);
  assert.equal(f.relayCalls[0].name,'home');
  assert.deepEqual(f.relayState.values.get('fixture-sentinel'),{retained:true});
  assert.equal(f.relayState.values.get('control-state:v1').rawRoutePeerInfos[0].version,3);
  assert.equal(legacy.calls[0].path,'/api/rooms/home');
});

test('host reads delegate hostname, Access and session decisions to retained legacy auth', async () => {
  const f = await environment();
  for (const [path, options, status] of [
    ['/api/hosts',{hostname:'wrong.example.org'},404],
    ['/api/config-profiles',{access:false},403],
    ['/api/hosts',{cookie:false},401],
  ]) assert.equal((await entry.default.fetch(request(f,path,options),f.env,f.ctx)).status,status);
  const response = await entry.default.fetch(request(f,'/api/hosts'),f.env,f.ctx);
  assert.equal(response.status,200);
  assert.equal((await response.json()).hosts[0].profile.hostId,'fixture-host');
  const gate = legacy.calls.at(-1);
  assert.equal(gate.path,'/api/auth/me');
  assert.equal(gate.cookie,f.cookie);
  assert.equal(gate.access,'fixture-approved-access');
  assert.equal(gate.env,f.env);
  assert.equal(gate.ctx,f.ctx);
});

test('empty/comma hostname and missing Access configuration cannot broaden admin access', async () => {
  const f = await environment();
  for (const hostname of ['', 'admin.example.org,other.example.org']) {
    const env = {...f.env,ADMIN_HOSTNAME:hostname};
    assert.equal((await entry.default.fetch(request(f,'/api/config-profiles'),env,f.ctx)).status,404);
  }
  assert.equal((await entry.default.fetch(request(f,'/api/hosts'),{...f.env,CF_ACCESS_AUD:''},f.ctx)).status,503);
});

test('legacy login cookie survives unchanged and authenticates modern protected host operations', async () => {
  const f = await environment();
  const login = await entry.default.fetch(request(f,'/api/auth/login',{method:'POST',cookie:false}),f.env,f.ctx);
  assert.equal(login.headers.get('Set-Cookie'),f.env.FIXTURE_LOGIN_COOKIE);
  assert.equal(await login.text(),'legacy login');
  const response = await entry.default.fetch(request(f,'/api/hosts/fixture-host/ddns-refresh',{method:'POST',headers:{Origin:'https://admin.example.org'}}),f.env,f.ctx);
  assert.equal(response.status,200);
  assert.equal((await response.json()).command.kind,'ddns-refresh');
  assert.equal(legacy.calls.at(-1).origin,'https://admin.example.org');
  assert.equal(legacy.calls.at(-1).method,'GET');
});

test('bearer reporting stays independent of management hostname and Access without granting admin reads', async () => {
  const f = await environment();
  const report = {schemaVersion:1,hostId:'fixture-host',reportId:'fixture-report',bootId:'fixture-boot',sequence:1,
    capturedAt:new Date().toISOString(),collectorVersion:'fixture',ddns:{name:'v6.example.org',status:'unknown'},services:[],easytier:{status:'error',peers:[]}};
  const incoming = request(f,'/api/hosts/fixture-host/report',{hostname:'relay.example.org',access:false,cookie:false,method:'POST',
    headers:{Authorization:'Bearer fixture-host-scoped-token-at-least-32','Content-Type':'application/json'},body:JSON.stringify(report)});
  const response = await entry.default.fetch(incoming,f.env,f.ctx);
  assert.equal(response.status,200);
  assert.equal((await response.json()).accepted,true);
  assert.equal(legacy.calls.length,0);
  assert.equal((await entry.default.fetch(request(f,'/api/hosts',{hostname:'relay.example.org',access:false,cookie:false,
    headers:{Authorization:'Bearer fixture-host-scoped-token-at-least-32'}}),f.env,f.ctx)).status,404);
});

test('legacy WS/config-server exemptions and namespace/token admission are retained', async () => {
  const f = await environment();
  const tokenResponse = await modern.default.fetch(request(f,'/api/rooms/home/token',{method:'POST'}),f.env);
  const token = await tokenResponse.json();
  const joined = await entry.default.fetch(request(f,token.uriPath,{hostname:'relay.example.org',access:false,cookie:false,
    headers:{Upgrade:'websocket'}}),f.env,f.ctx);
  assert.equal(joined.status,200); // The socket boundary is stubbed; no actual upgrade/network is performed.
  assert.equal(await joined.text(),'existing relay binding');
  assert.equal(f.relayCalls.at(-1).name,'home');
  assert.equal(legacy.calls.at(-1).path,'/ws');
  const config = await entry.default.fetch(request(f,'/config-server/ws',{hostname:'relay.example.org',access:false,cookie:false}),f.env,f.ctx);
  assert.equal(await config.text(),'legacy config server');
});

test('official bridge, unknown/extended routes and default room retain legacy behavior', async () => {
  const f = await environment();
  for (const [path, expected] of [['/api/easytier-web/services','legacy official bridge'],
    ['/api/rooms/home/legacy-only','legacy room extension'],['/api/unknown','legacy fallback'],['/login','legacy login page']]) {
    assert.equal(await (await entry.default.fetch(request(f,path),f.env,f.ctx)).text(),expected);
  }
  const room = await entry.default.fetch(request(f,'/api/default-room'),f.env,f.ctx);
  assert.equal((await room.json()).fixture,'legacy-default');
  const directory = await entry.default.fetch(request(f,'/api/rooms'),f.env,f.ctx);
  assert.deepEqual(await directory.json(),f.directoryData);
});

test('legacy room URI errors become controlled 400 while unrelated errors remain visible to the runtime', async () => {
  const f = await environment();
  const response = await entry.default.fetch(request(f,'/api/rooms/%E0%A4%A'),f.env,f.ctx);
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:'invalid room name'});
  await assert.rejects(()=>entry.default.fetch(request(f,'/api/fault'),f.env,f.ctx),URIError);
});

test('health has release version and combined capabilities while retaining legacy denial/headers/HEAD behavior', async () => {
  const f = await environment();
  const response = await entry.default.fetch(request(f,'/api/health'),f.env,f.ctx);
  const health = await response.json();
  assert.equal(health.version,'0.2.2');
  assert.equal(health.relayImplementation,'modern');
  assert.equal(entry.RELEASE_VERSION,'0.2.2');
  assert.ok(health.capabilities.includes('official-web-bridge'));
  assert.ok(health.capabilities.includes('relay-lifecycle'));
  assert.ok(!health.capabilities.includes('legacy-relay-recovery'));
  assert.equal(new Set(health.capabilities).size,health.capabilities.length);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await entry.default.fetch(request(f,'/api/health',{access:false}),f.env,f.ctx)).status,403);
  const head = await entry.default.fetch(request(f,'/api/health',{method:'HEAD'}),f.env,f.ctx);
  assert.equal(head.headers.get('X-Fixture'),'legacy-head');
  assert.equal(await head.text(),'');
});


test('script-generated recovery changes only the core export and retains host/Access/bridge routing', async () => {
  const f = await environment();
  assert.equal(recovery.RelayRoom,legacy.RelayRoom);
  assert.equal(recovery.HostState,modern.HostState);
  assert.equal(recovery.Directory,legacy.Directory);
  assert.equal(recovery.ConfigServerProbe,legacy.ConfigServerProbe);
  assert.equal(recovery.RELAY_IMPLEMENTATION,'legacy-recovery');
  const hosts = await recovery.default.fetch(request(f,'/api/hosts'),f.env,f.ctx);
  assert.equal(hosts.status,200);
  assert.equal((await hosts.json()).hosts[0].profile.hostId,'fixture-host');
  assert.equal((await recovery.default.fetch(request(f,'/api/hosts',{access:false}),f.env,f.ctx)).status,403);
  const report = {schemaVersion:1,hostId:'fixture-host',reportId:'recovery-report',bootId:'recovery-boot',sequence:1,
    capturedAt:new Date().toISOString(),collectorVersion:'fixture',ddns:{name:'v6.example.org',status:'unknown'},services:[],easytier:{status:'error',peers:[]}};
  const incoming = request(f,'/api/hosts/fixture-host/report',{hostname:'relay.example.org',access:false,cookie:false,method:'POST',
    headers:{Authorization:'Bearer fixture-host-scoped-token-at-least-32','Content-Type':'application/json'},body:JSON.stringify(report)});
  assert.equal((await recovery.default.fetch(incoming,f.env,f.ctx)).status,200);
  const bridge = await recovery.default.fetch(request(f,'/api/easytier-web/services'),f.env,f.ctx);
  assert.equal(await bridge.text(),'legacy official bridge');
  const health = await (await recovery.default.fetch(request(f,'/api/health'),f.env,f.ctx)).json();
  assert.equal(health.relayImplementation,'legacy-recovery');
  assert.ok(health.capabilities.includes('legacy-relay-recovery'));
  assert.ok(!health.capabilities.includes('relay-lifecycle'));
});
