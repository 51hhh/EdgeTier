# Component Guidelines

> How components are built in this project.

---

## Overview

EdgeTier dashboard components are React components using Cloudflare Kumo for accessible UI primitives. The v0.1.1 dashboard is intentionally read-only and private-testing oriented.

Use Kumo components for common UI such as tables, badges, buttons, inputs, empty states, layer cards, status indicators, tabs/sidebar, and future charts. Do not build a custom component library unless Kumo does not provide the needed primitive.

---

## Scenario: Kumo-Based Read-Only Dashboard Components

### 1. Scope / Trigger

- Trigger: Dashboard component, table, metric card, status badge, room lookup, room selection, empty state, or traffic/topology visualization changes.
- Applies to `src/dashboard/app.tsx`, `src/dashboard/format.ts`, and future `src/dashboard/components/*`.

### 2. Signatures

Current component entry:

```typescript
export function App(): JSX.Element
```

Current helper signatures:

```typescript
Metric(props: { label: string; value: React.ReactNode }): JSX.Element
formatBytes(bytes: number): string
eventBadgeVariant(type: RelayEventType): 'primary' | 'secondary' | 'destructive' | 'outline'
```

Kumo imports should be explicit:

```typescript
import { Badge, Button, Empty, Input, LayerCard, Table, Text, cn } from '@cloudflare/kumo';
```

### 3. Contracts

- Dashboard is read-only in v0.1.x.
- Components must tolerate empty arrays and missing optional fields.
- Manual room lookup is allowed, but it only fetches observer state; it must not create or configure EasyTier nodes.
- Unknown peer IDs display as `unknown`.
- Missing last activity displays as `none`.
- Status text should be short and badge-friendly.
- Do not display full network secret digests.
- Room selection must be keyboard-accessible; use `Button` or a real `<button>`, not `onClick` on `<tr>`.
- Empty states should use Kumo `Empty` where practical.
- Dashboard panels and metrics should use Kumo `LayerCard` where practical.

### 4. Validation & Error Matrix

| Data condition | Component behavior |
|---|---|
| `rooms.length === 0` | Render `Empty` explaining that no rooms have been observed yet and manual lookup is available |
| `selected === null` | Render a notice asking the user to choose or look up a room |
| Selected room not in directory | Render a notice that the room is manually opened and may be unobserved or mistyped |
| `room === null` | Do not render peer/traffic/event sections |
| `room.peers.length === 0` | Render `Empty` for no peers |
| `room.recentEvents.length === 0` | Render `Empty` for no events |
| `peer.peerId` missing | Render `unknown` |
| API error | Render visible `role="alert"` error without clearing previous successful data |
| Lookup room name invalid | Render validation error and do not change selection |
| Event type is `decode_error` or `limit_exceeded` | Use destructive badge variant |
| Event type is `packet_unroutable` | Use outline badge variant |
| Room row selection needed | Use Kumo `Button` or real `<button>` inside table cells |

### 5. Good/Base/Bad Cases

- Good: use `<Table>` for Rooms, Peers, and Events with safe fallback text.
- Good: use `<Badge>` for room id, active/stale state, peer status, and event type.
- Good: use `<Button type="button">` inside table cells for room selection so keyboard focus and activation work.
- Good: use `<LayerCard>` for dashboard panels and metrics.
- Good: use `<Empty>` for no rooms/no peers/no events states.
- Base: small CSS classes are acceptable for page layout and selected-row styling.
- Bad: using raw `<table>` with divergent styling when Kumo `Table` is available.
- Bad: using clickable `<tr onClick={...}>` for selection; table rows are not keyboard buttons.
- Bad: adding mutation buttons such as restart/configure/delete peer; EdgeTier v0.1.x is observer-only.

### 6. Tests Required

- Test extracted presentation helpers such as `formatBytes` and `eventBadgeVariant`.
- Future component test: empty room snapshot renders without throwing.
- Future component test: peer without `peerId` renders `unknown`.
- Future accessibility check if adding dialogs, command palette, or forms.

### 7. Wrong vs Correct

#### Wrong

```tsx
<tr onClick={() => setSelected(roomId)}>
  <td>{roomId}</td>
</tr>
```

#### Correct

```tsx
<Table.Row variant={roomId === selected ? 'selected' : 'default'}>
  <Table.Cell>
    <Button type="button" variant="ghost" onClick={() => setSelected(roomId)} aria-pressed={roomId === selected}>
      <Badge variant="outline">{roomId}</Badge>
    </Button>
  </Table.Cell>
</Table.Row>
```

The dashboard observes EasyTier state; it does not manage child nodes. Interactive table controls must still be keyboard-accessible.

---

## Component Structure

For v0.1.x, keep the dashboard compact. Extract components only when a section grows or is reused.

When extracting, use:

```text
src/dashboard/components/<name>.tsx
```

Each extracted component should receive typed props from `src/observer/types.ts`.

---

## Props Conventions

- Prefer exact object props over broad `any`/index signatures.
- Use shared observer DTOs for API-backed props.
- Keep presentation helpers pure, e.g. `formatBytes(bytes: number)` and `eventBadgeVariant(type)`.

---

## Styling Patterns

- Import Kumo styles globally in dashboard CSS.
- Place CSS `@import` lines before `@source` or other at-rules.
- Use Kumo semantic components first.
- `styles.css` should provide layout glue, selected state, and small responsive rules only.

---

## Accessibility

Kumo components handle much of the table/badge primitive behavior. When adding interactive components, prefer Kumo/Base UI wrappers so keyboard/focus behavior is included.

Required accessibility patterns:

- Error banners use `role="alert"`.
- Room selection buttons use `aria-pressed` for selected state.
- Manual lookup uses a labeled `Input`.

---

## Common Mistakes

### Common Mistake: Turning observer views into management UI

**Symptom**: Dashboard grows buttons for restart, config push, or remote command execution.

**Cause**: Treating EdgeTier as an EasyTier cloud manager instead of a read-only observer.

**Fix**: Remove mutation UI; only display observed relay/network state.

**Prevention**: Any dashboard control that changes child-node state is out of scope unless a future PRD explicitly changes the product boundary.

### Common Mistake: Table rows as buttons

**Symptom**: Mouse users can select a room, but keyboard users cannot.

**Cause**: Putting `onClick` on `<tr>`.

**Fix**: Put a Kumo `Button` or real `<button>` inside a table cell.

**Prevention**: Any interactive dashboard control must be keyboard-focusable by default.
