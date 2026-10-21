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

## Phase 2: Dynamic data platform (DONE)
- [x] Models: Dataform, FieldDefinition (separate from data), Record (`data` keyed by immutable field key), RecordHistory
- [x] 13 field types (text, long text, email, URL, phone, integer, decimal, yes/no, date, date-time, dropdown, multi-select, relationship) with per-type validation, min/max, required, unique, read-only, defaults, per-field visibility for create / edit / table
- [x] Dataforms: create (blank or from a form pack), edit, clone structure, archive/restore, delete (blocked while another dataform links to it); field add/edit/delete/reorder
- [x] Records: CRUD, duplicate, bulk edit/delete (max 200), history with before/after values, created-by / updated-by
- [x] Relationships: validated to the same account and workspace; labels resolved server-side; dangling links cleared on delete
- [x] Server-side search, sort, pagination; filter engine with AND/OR, nested groups (depth 3), per-type operators, empty checks, between, relative dates, relationship filters
- [x] UI: dataform cards on workspace home, sidebar navigation, MUI X data grid (column resize/visibility), record drawer with dynamic form + history tab, filter builder, field builder, bulk bar
- [x] Seed: Acme gets Companies (12), Contacts (40, linked to companies), Deals (28), Tickets (18)
- [x] Tests: 29 backend integration tests (19 new). Verified in a real browser (Chrome via Playwright): login, grid, search, filter, validation, create, settings, field dialog

### Decisions
- Values are stored under `data.<key>` with typed coercion on write (dates as `YYYY-MM-DD`, date-times as `Date`, relationships as ObjectId), so indexes and `$group` work directly. Trade-off: renaming a key is not allowed; labels can change freely.
- Filter values are coerced per field type and regex input is escaped, so client input never reaches Mongo operators.
- Search is a bounded regex over up to 15 text-like fields. Fine for tens of thousands of rows; Atlas Search / text indexes are the upgrade path.

### Not done in Phase 2 (honest list)
- Formula fields, user references, file/image fields, pipeline-stage fields, location fields, conditional/dependent fields, relationship-derived values and aggregates (these need the formula engine, attachments or Kanban from later phases)
- Drag-and-drop field ordering (up/down buttons instead), column order persistence, field-level permissions beyond visibility flags, record-level authorization, CSV import/export, saved views/filters (Phase 3 / 6)
- Custom field indexes are not created automatically; add them when a dataform grows large
- No automated frontend component or e2e tests in the repo yet (the browser check was a one-off script)

## Next phases
3. Views (card/kanban/calendar/map), saved views, reports, grouped analyzer, dashboards.
4. Collaboration: comments, tasks, notifications, attachments, Socket.IO.
5. Workflows and communication adapters.
6. API docs (OpenAPI), webhooks, CSV import/export, public forms/shares.
7. AI provider abstraction, billing, onboarding.
8. Hardening: performance, accessibility audit, e2e (Playwright), deployment config.
