# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend quality is verified through TypeScript, Vitest, Vite production build, and dashboard/API contract consistency. The dashboard is read-only and must remain aligned with observer API DTOs.

---

## Scenario: Dashboard Build and API Contract Quality

### 1. Scope / Trigger

- Trigger: Dashboard UI, fetch helpers, shared DTOs, Kumo dependency, formatting helpers, or build configuration changes.
- Applies to `src/dashboard/*`, `src/observer/types.ts`, `vite.config.ts`, and `package.json` scripts.

### 2. Signatures

Required scripts:

```text
npm run typecheck
npm run test
npm run build
```

Build contract:

```text
npm run build = vite build && wrangler deploy --dry-run --outdir dist/worker
```

Presentation helper signatures:

```typescript
formatBytes(bytes: number): string
eventBadgeVariant(type: RelayEventType): 'primary' | 'secondary' | 'destructive' | 'outline'
```

### 3. Contracts

- Dashboard must compile with `tsc --noEmit`.
- Dashboard helper behavior must be covered by Vitest when extracted.
- Dashboard must build through Vite.
- Wrangler dry-run must pass so static assets and Worker bindings stay compatible.
- Vitest must not discover tests in `research/github/*`; project tests are scoped to local source.
- Kumo components should be used for common UI primitives.
- Kumo/Tailwind CSS at-rule warnings from Lightning CSS are acceptable only when `npm run build` exits successfully and Wrangler dry-run passes.

### 4. Validation & Error Matrix

| Condition | Required response |
|---|---|
| DTO changed | Run `npm run typecheck` and update dashboard usage |
| Dashboard fetch endpoint changed | Update `src/dashboard/api.ts` and API route together |
| Kumo import changed | Run Vite build to verify bundling |
| Extracted format helper changed | Update/add Vitest assertions |
| Test discovery includes research repos | Fix `vite.config.ts` test include/exclude |
| Build emits Kumo/Tailwind at-rule warnings but exits 0 | Note as non-fatal; do not claim warning-free build |
| Build output appears in git status | Ensure `.gitignore` excludes `dist/` |

### 5. Good/Base/Bad Cases

- Good: after dashboard changes, `npm run typecheck`, `npm run test`, and `npm run build` all pass.
- Good: `formatBytes(Number.NaN)` and negative values safely return `0 B`.
- Good: `eventBadgeVariant('decode_error')` maps to `destructive`.
- Base: small CSS classes are acceptable for layout and selected-row styling.
- Bad: tests run against cloned reference repos under `research/github`.
- Bad: committing `dist/`, `.wrangler/`, or `node_modules/`.
- Bad: ignoring a non-zero build exit because warnings looked similar to known Kumo CSS warnings.

### 6. Tests Required

- Packet parser tests keep protocol skeleton validation meaningful.
- Directory tests cover active/stale summary logic and validation.
- Room validation tests cover supported/unsafe room names.
- Dashboard format tests cover byte formatting and event badge variants.
- Add component/API client tests as dashboard complexity increases.
- Use fake timers for extracted polling hooks.

### 7. Wrong vs Correct

#### Wrong

```json
{"test": "vitest run"}
```

with default discovery that picks up `research/github/kumo` tests.

#### Correct

```typescript
// vite.config.ts
// Scope test discovery to EdgeTier source tests and exclude research clones.
```

---

## Forbidden Patterns

- Do not duplicate API DTOs in dashboard code.
- Do not add mutation UI for EasyTier child-node management in v0.1.x.
- Do not commit generated build/dependency artifacts.
- Do not introduce a global state library without a PRD-backed need.
- Do not use clickable table rows for room selection.

---

## Required Patterns

- Use shared types from `src/observer/types.ts`.
- Use Kumo components for tables/status/cards/empty states where practical.
- Keep dashboard data fetching in `src/dashboard/api.ts`.
- Keep dashboard formatting helpers pure and tested.
- Handle empty/missing optional fields safely.
- Run the full build after UI changes.

---

## Testing Requirements

Minimum commands after frontend changes:

```text
npm run typecheck
npm run test
npm run build
```

---

## Code Review Checklist

- [ ] Does the dashboard remain read-only?
- [ ] Are API contracts imported from `src/observer/types.ts`?
- [ ] Are empty rooms/unknown peers/no events handled?
- [ ] Is room selection keyboard-accessible?
- [ ] Are extracted helpers covered by tests?
- [ ] Does Vite build pass?
- [ ] Does Wrangler dry-run still pass via `npm run build`?
- [ ] Are generated artifacts ignored?
