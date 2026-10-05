# Host status, DDNS refresh and client configuration

## 1. Scope / Trigger

Applies when changing host observation pages, the fixed DDNS refresh action, or EasyTier client exports. The room/Worker observer remains read-only. This task explicitly authorizes a single host mutation: request the existing DDNS updater. It does not authorize arbitrary shell commands or EasyTier child-node control.

## 2. Signatures

```typescript
getHosts(signal?: AbortSignal): Promise<HostSnapshot[]>
getConfigProfiles(signal?: AbortSignal): Promise<ConfigProfile[]>
refreshHostDdns(hostId: string): Promise<HostCommand>
buildEasyTierConfig(options: EasyTierConfigOptions, now?: number): string
observedFreshness(host: HostSnapshot, now?: number): 'fresh' | 'stale' | 'never'
mergeHostSnapshots(previous: HostSnapshot[], incoming: HostSnapshot[]): HostSnapshot[]
unavailableHostSnapshots(hosts: HostSnapshot[]): HostSnapshot[]
unavailableConfigProfiles(profiles: ConfigProfile[]): ConfigProfile[]
```

```text
GET /api/hosts
GET /api/config-profiles
POST /api/hosts/:hostId/ddns-refresh
```

## 3. Contracts

- Import host payloads from `src/observer/host-types.ts`; never duplicate Worker or collector DTOs.
- Admin endpoints use the existing private session. The browser never sends a network secret to these APIs.
- `HostSnapshot.report` is last known data. `receivedAt` is the server receipt timestamp; `capturedAt` is the host clock timestamp. Display both rather than presenting host capture time as server freshness.
- Poll host/profiles separately from room data, preserve each successful result across partial failures, avoid overlapping polls, abort/ignore requests on cleanup.
- Refresh returns a pending command, not successful DNS mutation. Disable duplicate pending requests; show acknowledgement or expiration. Only the host's later acknowledgement proves command completion.
- System service active/substate/persistent-enable status is separate from EasyTier RPC success, node presence and peers. Official local connection loss/bytes do not describe Worker relay counters.
- `HostSnapshot.readErrorCode` and `ConfigProfile.readErrorCode` may be `host_state_unavailable`. That marker takes precedence over fresh/never UI labels. Preserve a failed host's previous observation only when host/room/network/hostname/port identity still matches, force stale, disable DDNS controls and direct export, and continue updating successful hosts. A recovered response removes the marker. An endpoint-wide failure immediately marks cached results unavailable; profile failures clear cached direct peers.
- `HostReport.easytier.truncated` signals partial peer or connection detail; optional positive `omittedPeers` gives the exact number of wholly omitted peers. Show both truthfully. A truncated empty list must not say the mesh has no peers.
- `HostService.enabled` means persistent enabled state; render it as "持久启用" / "Persistently enabled" and also show optional raw `unitFileState`. An active/static/generated/runtime-enabled service does not imply permanent enablement or guaranteed startup.
- Profiles carry `roomId` separately from `networkName`. Use the configured room to request WSS admission.
- Direct peers come only from a successful fresh profile with provider verification no older than five minutes. No hardcoded hostname fallback. AAAA-only profiles require IPv6 underlay.
- Client config and secret stay in React memory. Do not persist to localStorage, send to analytics or log rendered TOML.
- EasyTier 2.6.4 TOML uses `listeners = []` for no listeners and `flags.enable_ipv6`; UI `disable_ipv6` is inverted on export. DHCP-off requires syntactically valid `ipv4` with prefix; actual mesh address uniqueness remains an operator choice. Joining clients do not inherit gateway LAN proxy or static gateway address.
- WSS admission tokens last five minutes. Profile/room changes invalidate them; expired tokens block export until renewed or removed. Revalidate at download, not only render time. Saved expired URIs cannot reconnect unattended.

## 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| No configured hosts/profiles | Explain how to connect a report agent; no invented healthy state |
| Configured host never reported | Waiting state; no node/service success claim |
| Receipt exceeds five minutes, even if API polling fails | Retain data and mark stale |
| One host read fails | Keep its same-identity last data marked unavailable/stale; block controls/direct peers, let other hosts update |
| Failed host read without cached data | Unavailable state takes precedence over "never reported" |
| Peer/connection data is truncated | Show partial-data notice and exact omitted peer count when supplied |
| RPC collection fails but service is active | Show both facts independently |
| Refresh pending | Display pending/expiry; disable duplicate request |
| Refresh completed/failed/expired | Display acknowledgement/error/expiry honestly |
| Current DDNS error, stale confirmation or empty directPeers | Block selected direct export; allow explicit WSS-only selection |
| IPv6 disabled while direct peers selected | Block IPv6-only direct export |
| DHCP disabled without valid IPv4 syntax | Block export and show address requirement |
| Token room/network mismatch or expired | Block export; renew/remove control |
| P2P-only and disable-P2P both enabled | Block contradictory config |
| String contains control characters | Reject; quote/backslash characters are safely TOML-escaped |

## 5. Good / Base / Bad Cases

- Good: show last reported `active` core plus stale heartbeat, rather than a fresh healthy badge.
- Good: show mesh peers and per-connection local metrics while retaining Worker topology in its existing tab.
- Base: DNS-only AAAA with a fresh confirmation produces TCP/UDP URIs from the selected profile.
- Bad: `createRoomRelayToken(options.networkName)` when the profile room differs.
- Bad: `no_listener = true` or `disable_ipv6 = false` in exported TOML; the core can silently ignore unknown fields.
- Bad: interpreting HTTP success from refresh request creation as a DNS update success.

## 6. Tests Required

- Config tests assert effective listener/IPv6 keys, actual profile endpoint selection and no invented fallback.
- Expiry tests use fixed `now` and assert both stale DDNS and expired/mismatched WSS credentials reject.
- Static IPv4 tests reject network/broadcast addresses, invalid octets/prefixes and missing CIDR; DHCP emits no static IPv4.
- `host-availability.test.ts` covers independent host failure/recovery, identity changes/removals, endpoint failure and read-error precedence over direct export.
- Rendered `Hosts.test.tsx` verifies one failed control is disabled while another is usable, first unreadable state is not called never reported, raw unit state and persistent enablement are shown, and truncated empty/partial lists remain truthful.
- Freshness tests age preserved reports and preserve server-stale state; command tests assert expiry allows another request.
- Typecheck, Vite build and browser QA must exercise DDNS, services, bilingual text, missing/stale/error data and a downloaded real EasyTier 2.6.4 config.

## 7. Wrong vs Correct

```typescript
// Wrong: endpoint fallback ignores stale DNS; networkName is not necessarily the room.
peers.push('udp://ip.example.org:11010');
await createRoomRelayToken(options.networkName);

// Correct: profile data is verified and token scope is explicit.
if (!directProfileAvailable(profile, Date.now())) throw new ConfigValidationError('directUnavailable');
const token = await createRoomRelayToken(profile.roomId);
```

```toml
# Wrong: ignored CLI spellings in a TOML file.
no_listener = true
[flags]
disable_ipv6 = false

# Correct: effective EasyTier 2.6.4 configuration fields.
listeners = []
[flags]
enable_ipv6 = true
```
