#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const envPath = '.env.validation';
const values = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
const domain = clean(values.EDGETIER_EDGE_DOMAIN);
const room = clean(values.EDGETIER_ROOM) || 'home-mesh';
const token = clean(values.EDGETIER_WSS_TOKEN);
const tokenValue = token ? encodeURIComponent(token) : '<short-lived-relay-token>';
const wssUri = clean(values.EDGETIER_WSS_URI) || (domain ? `wss://${domain}/ws?room=${encodeURIComponent(room)}&token=${tokenValue}` : 'wss://<edge-domain>/ws?room=<room>&token=<short-lived-relay-token>');

console.log('EdgeTier v0.1.2 validation helper');
console.log('');
console.log(`Env file: ${envPath}${existsSync(envPath) ? ' (found)' : ' (missing)'}`);
console.log(`Room: ${room}`);
console.log(`Edge domain: ${domain ? '<set>' : '<missing>'}`);
console.log('');

if (!domain) {
  console.log('Fill EDGETIER_EDGE_DOMAIN in .env.validation after private deployment.');
  console.log('Optional local placeholders: EDGETIER_ROOM=home-mesh and EDGETIER_WSS_TOKEN=<short-lived-relay-token-from-dashboard>.');
  console.log('Before deployment, configure Wrangler secrets: ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, RELAY_TOKEN_SECRET.');
  console.log('Do not put network_secret, auth secrets, relay tokens, or unredacted private logs in repo files.');
  process.exit(0);
}

console.log('Private endpoint checks:');
console.log(`curl -fsS -b '<session-cookie>' https://${domain}/api/health`);
console.log(`open https://${domain}/dashboard/`);
console.log('Issue a short-lived relay token from the authenticated dashboard before testing /ws.');
console.log('');
console.log('Add this peer to private EasyTier config only:');
console.log('[[peer]]');
console.log(`uri = "${wssUri}"`);
console.log('');
console.log('Then record sanitized results in:');
console.log('.trellis/tasks/06-09-03-edgetier-v0.1.2-real-node-validation/validation-report.md');

function parseEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }
  return result;
}

function clean(value) {
  if (!value || value.includes('<')) return '';
  return value;
}
