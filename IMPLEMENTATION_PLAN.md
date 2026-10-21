# Implementation Plan

## Repository findings (at start)
The workspace was empty (no git repo, no code). Environment: Node 24, npm 11; no MongoDB or Docker installed. This is a greenfield build.

## Architecture
Two independent projects: `frontend/` (Vite React SPA) and `backend/` (Express API), with `backend/scripts/dev-db.js` for a persistent local MongoDB.

- **Server**: feature modules under `backend/src/modules/<name>/` (`*.model.js`, `*.routes.js`, services where logic grows). Shared `config/`, `middleware/` (auth, validate, error), `utils/`. Express 5 handles async errors natively.
- **Client**: feature folders under `frontend/src/features/`, one RTK Query `api` slice with `injectEndpoints` per feature, Redux slices only for auth and UI state. MUI theme tokens in `app/theme`.
- **Tenancy**: every tenant-owned document has an `account` field and every query filters on the authenticated account. Authorization = account role (`Membership`) + workspace membership.

### Decisions and trade-offs
- **Dev database**: `mongodb-memory-server` runs a persistent real `mongod`, so there is no install step. Trade-off: standalone mongod has no transactions, so signup uses compensating cleanup instead.
- **Auth**: 15-minute JWT in memory + opaque single-use refresh token (httpOnly cookie, hashed in DB, TTL index). Trade-off: no reuse-detection/family revocation yet.
- **Roles**: fixed roles (owner/admin/member/viewer) mapped to permissions in code (`config/permissions.js`). Custom permission groups come with Phase 2 dataform permissions.
- **Record storage (decision for Phase 2)**: hybrid. One `records` collection per account scope with a `data` sub-document keyed by field id and typed per field definition. Indexes are driven by field metadata. Chosen over a typed value collection because it avoids joins in listing/filtering and keeps documents bounded; aggregation uses `$group` on `data.<fieldId>`. Large/derived arrays (history, comments, attachments) live in their own collections.
- **Formulas (Phase 2)**: a restricted expression parser, never `eval`/`new Function`.

## Phase 1: Foundation (DONE)
- [x] Monorepo, env validation, `.env.example`, ESLint
- [x] Models: Account, User, Membership, Workspace, Session
- [x] Signup (creates organization + owner), login, rotating refresh, logout, logout-all, `/me`
- [x] Account settings + usage; plan entitlements enforced for workspace quota
- [x] Workspaces: create, edit, clone (settings only), delete, visibility (account/private), per-workspace member roles
- [x] Team page: list members, change role/status (owner protected)
- [x] Responsive MUI shell: collapsible sidebar (Framer Motion), top bar, workspace selector, theme switcher (light/dark/system, persisted), toasts, confirm dialogs, skeletons, error + empty states, reduced-motion support
- [x] Seed data: two tenants, 7 users, 6 workspaces (one private)
- [x] Tests: 10 integration tests (auth, refresh rotation, tenant isolation, private workspaces, role enforcement, mass assignment, quota, injection)
- [x] Verified: server tests pass, lint clean, client builds, real login/list/refresh through the Vite proxy

### Not done in Phase 1 (honest list)
- Password reset, email verification, invitations (need an email provider adapter, planned with Phase 5)
- Notifications bell, global search, help are disabled/"coming later" placeholders in the top bar
- Workspace member management UI (API model exists; no endpoints to add/remove yet)
- Audit logs, CSRF is header-based only, no component or e2e tests yet, no OpenAPI doc yet
- The client bundle is one ~970 kB chunk; code-splitting by route is a Phase 8 item
- I could not run a browser in this session, so the UI was verified by build, lint and live API calls, not by visual inspection. Please click through it once.

## Next phases
2. **Dynamic data platform**: Dataform, FieldDefinition, Record, RecordHistory; field builder; record CRUD; relationships; table view with server-side filtering/sort/pagination; bulk actions; dataform-level and field-level permissions.
3. Views (card/kanban/calendar/map), saved views, reports, grouped analyzer, dashboards.
4. Collaboration: comments, tasks, notifications, attachments, Socket.IO.
5. Workflows and communication adapters.
6. API docs (OpenAPI), webhooks, CSV import/export, public forms/shares.
7. AI provider abstraction, billing, onboarding.
8. Hardening: performance, accessibility audit, e2e (Playwright), deployment config.
