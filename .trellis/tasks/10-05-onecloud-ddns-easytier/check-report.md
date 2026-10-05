# Trellis implementation check

Date: 2026-10-05

Reviewed the host DTO, validation, authenticated adapter, ordered Durable Object state, command acknowledgement flow, dashboard host polling and presentation, profile-backed EasyTier generator and the OneCloud collector/DDNS status persistence.

## Issues found and fixed

1. Rejected host Durable Object fetch calls escaped the Worker API boundary. Added a shared safe fetch adapter returning controlled503 JSON without private exception text, covering ingest, host list, config profiles, detail and refresh. Added a regression exercising all five paths.
2. Collector URI sanitization discarded WS/WSS remote endpoints when their default ports were omitted. It now preserves WS80/WSS443 and rejects zero/missing ports for other protocols while stripping credentials, path, query and fragment. Added safe default-port regression coverage.

3. Live generated-client verification revealed verbose EasyTier 2.6.4 route IPv4 uses a protobuf object instead of the node-info string. Added exact network-order IPv4/IPv6 object decoding with integer/prefix/family validation and real-shape regression tests.

4. A real core restart exposed unnamed instance UUID churn. Added exclusive stable-name or legacy UUID selectors, corresponding envelope filtering and no-match/duplicate-match rejection. Regression tests cover CLI arguments, direct raw peer lists, multi-instance isolation and selector validation.

Updated backend host-management specification for these boundary rules.

## Verification

- TypeScript typecheck: passed.
- Focused host API/validation/state and dashboard config/freshness: five files,31tests passed.
- Python collector and DDNS:22tests passed after live-shape and stable-name corrections.
- git diff --check: passed.
- Full build/proto checks, browser review, live host synchronization and generated-client acceptance are owned by parent; this check agent made no live Cloudflare, SSH, credential or network-setting changes.

No remaining concrete implementation blockers found in reviewed paths. Production deployment and external IPv6 ingress remain separate acceptance evidence, not inferred from local tests.
