# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory documents EdgeTier backend conventions for the TypeScript Cloudflare Worker, Durable Objects, EasyTier protocol scaffolding, observer APIs, and storage boundaries.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Worker, Durable Object, EasyTier protocol, and observer API layout | Filled |
| [Database Guidelines](./database-guidelines.md) | Durable Object storage and future storage boundaries | Filled |
| [Error Handling](./error-handling.md) | API errors and relay packet error/event behavior | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Worker/protocol quality, tests, and proto drift rules | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Relay events and safe observability logging | Filled |

---

## Pre-Development Checklist

Before backend changes:

1. Read [Directory Structure](./directory-structure.md) for module ownership and route signatures.
2. Read [Error Handling](./error-handling.md) for API and WebSocket packet error behavior.
3. Read [Quality Guidelines](./quality-guidelines.md) before touching EasyTier protocol code or Worker bindings.
4. Read [Database Guidelines](./database-guidelines.md) before changing Durable Object storage or adding D1/KV/Analytics.
5. Read [Logging Guidelines](./logging-guidelines.md) before adding relay events or console logs.

---

## Quality Check

After backend changes run:

```text
npm run typecheck
npm run test
npm run build
npm run proto:check
```

---

**Language**: All documentation should be written in **English**.
