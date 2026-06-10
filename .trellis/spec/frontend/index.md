# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory documents EdgeTier frontend conventions for the React + Vite + Cloudflare Kumo read-only observer dashboard.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Dashboard/API client organization and shared DTO imports | Filled |
| [Component Guidelines](./component-guidelines.md) | Kumo component usage and observer-only UI boundaries | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Polling lifecycle and custom hook extraction rules | Filled |
| [State Management](./state-management.md) | Local polling state and server state boundaries | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Build/test/API contract quality checks | Filled |
| [Type Safety](./type-safety.md) | Shared observer DTOs and optional field handling | Filled |

---

## Pre-Development Checklist

Before frontend changes:

1. Read [Directory Structure](./directory-structure.md) for dashboard file ownership and API contract location.
2. Read [Component Guidelines](./component-guidelines.md) before adding UI components or Kumo usage.
3. Read [State Management](./state-management.md) and [Hook Guidelines](./hook-guidelines.md) before changing polling/data fetching.
4. Read [Type Safety](./type-safety.md) before adding/changing observer payload fields.
5. Read [Quality Guidelines](./quality-guidelines.md) before running final checks.

---

## Quality Check

After frontend changes run:

```text
npm run typecheck
npm run test
npm run build
```

---

**Language**: All documentation should be written in **English**.
