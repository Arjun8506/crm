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

## Phase 3: Advanced views and analytics (DONE)
- [x] Views on every dataform: table (column visibility persisted in views), cards, Kanban board, calendar, map
- [x] Kanban: stages are the options of any dropdown field; drag and drop between and within columns with persisted fractional ranking, optimistic updates, and a keyboard-accessible "move to" menu
- [x] Saved views (personal and shared) holding layout, search, filter, sort and display options; editors can share, owners or workspace admins can curate
- [x] Location field type (lat/lng, validated) plotted on a Leaflet map. Gated by the plan entitlement `locationFields` (off for the free plan)
- [x] Reports: saved list reports (columns, filters, sort) and saved analyzer configurations, private or shared
- [x] Grouped Table Analyzer: up to 3 grouping levels; text, dropdown, boolean, date, date-time, relationship, whole-number and multi-select (one group per tag) groups; day/week/month/quarter/year buckets; count/sum/avg/min/max; group pagination; totals; drill-down to the exact source records
- [x] Dashboards: account-wide (admins edit) and personal; KPI, chart (bar, line, donut), record list and saved-report widgets; width/height presets and reordering; each widget computed server-side with the viewer's own access
- [x] CSV export of any filtered list (respects hidden columns, escapes spreadsheet formulas, streams up to 50,000 rows)
- [x] Seed: Acme gets company locations, 5 shared views, 3 reports and a "Sales overview" dashboard
- [x] Tests: 44 backend tests (15 new). Verified in Chrome via Playwright: dashboard charts (light and dark), Kanban drag and drop with persistence, cards, calendar, map, saved views, analyzer with drill-down, CSV download, with zero console errors

### Decisions
- Views, reports and dashboards are stored configurations. Nothing is cached, and every read goes through the same authorization and filter engine as the records API, so a shared report or dashboard can never show data the viewer cannot open (covered by tests, including a private workspace).
- Kanban uses a per-record fractional `rank` rather than an array on the dataform, so a card move is a single-document write. Existing databases need `npm run backfill` once.
- Analyzer date buckets use MongoDB `$dateTrunc` (UTC, weeks start Monday). The analyzer response carries a ready-made drill-down filter per row, so the client never reconstructs date ranges.
- Charts use the validated categorical palette in fixed slot order with a separately stepped dark set, one axis only, and a table/summary fallback in each chart's accessible label.

### Not done in Phase 3 (honest list)
- Scheduled report subscriptions and emailed reports (needs the job queue and email adapter, Phase 5/6)
- Dashboard widgets for My Tasks, My Discussions and Reminders (need Phase 4), activity summaries, drag-to-resize and drag-to-reorder widgets (size presets and move buttons instead)
- Conditional formatting, relationship-derived values, inline filter chips, subscriptions that notify on matching records, and global search across attachments
- Report grouping inside list reports (use the analyzer), pivot tables with column groups, stacked/multi-series charts (single-measure charts only, by design for the first version)
- Map: no clustering for very large sets (capped at 200 markers per view), tiles come from the public OpenStreetMap server
- Calendar: month view only, no create-by-click or drag to reschedule

## Phase 4: Collaboration (DONE)
- [x] Comments on records and tasks, one level of replies, edit/delete (author or workspace admin), @mentions that are re-validated server-side (a mention can never reveal a record to someone without access)
- [x] Following: manual follow/unfollow plus auto-follow when you create a record, comment, are mentioned or upload a file; followers are notified of comments, updates and files
- [x] Tasks and reminders: multiple assignees, due date, reminder time, priority, status, optional link to a record, activity history, task comments, My Tasks (overdue / today / upcoming / no date / done) and per-workspace task views
- [x] Scheduler: reminder, due-within-24h and overdue notifications, claimed atomically so each fires once even with several API instances
- [x] Notifications: in-app centre with unread badge, per-type in-app and email preferences, desktop (browser) notifications when the tab is in the background
- [x] Email via a provider adapter (nodemailer/SMTP). Sent only when configured and opted in; never faked
- [x] Attachments: upload (drag and drop), authenticated thumbnails and downloads, descriptions, delete, ZIP of all files, plan-based size limit, file-signature check before inline preview, dangerous types refused; bytes removed when a record, dataform or workspace is deleted
- [x] Real-time: Socket.IO with token auth and server-checked workspace rooms; live comments, tasks, files, record changes and notifications. If someone else saves the record you are editing, your unsaved edits are kept and a banner offers "Load latest"
- [x] Fixed a gap from earlier phases: deleting a workspace now deletes its dataforms, records, files, reports and tasks instead of orphaning them
- [x] Seed: demo comments (with a reply and mentions), follows, 6 tasks across overdue/today/upcoming/no date/done, and notifications
- [x] Tests: 69 backend tests (25 new). Verified in Chrome via Playwright with two simultaneous users: deep-linked notifications, mention highlighting, file upload/thumbnail/download/delete, tasks, live comment delivery, live bell update, saved preferences, with zero console errors

### Decisions
- Socket events carry ids only, and the client refetches through the REST API. Every read is therefore authorized by the same code as before, and nothing sensitive can leak through a room.
- Reminders run in an in-process scheduler with atomic claims. It becomes a BullMQ repeatable job in Phase 5 without changing the function.
- File bytes go through a small storage adapter (local disk now). An S3-compatible driver would implement the same three methods and add presigned URLs.
- Notification preferences are stored per type and channel on the user; in-app defaults on, email defaults off.

### Not done in Phase 4 (honest list)
- Audio comments (the spec's optional audio attachments), comment attachments, and a "My Discussions" feed or dashboard widget; My Tasks dashboard widget and reminders widget
- S3-compatible storage and presigned URLs (local disk only), per-field file/image field types, attachment history, virus scanning, per-account storage usage reporting
- Real mobile push (FCM/APNS) and Web Push (VAPID): device tokens can be registered but nothing is sent. Desktop notifications work only while the app is open in a browser tab
- Email digests and email reply-to-comment; email requires an administrator to set `SMTP_URL`
- Recurring tasks, subtasks, task boards, assigning tasks to roles or teams, @mentioning groups
- A socket stays authorized until it disconnects (a removed member keeps an open connection until they reconnect), though they can no longer read anything because data still flows through the REST API
- Comment editing history, rich text/markdown in comments, and read receipts

## Phase 5: Automation and communication (DONE)
- [x] Safe formula language (arithmetic, comparisons, logic, text, dates, lists, 30 functions) used by conditions and "set field" values, with a built-in tester
- [x] Workflow engine: triggers (before/after save, before/after delete, manual, recurring schedule), conditions (field tests, formulas, "field changed", nested AND/OR), 13 action types, definitions stored as validated JSON
- [x] Before-save rules can block a create, edit, Kanban move, copy, bulk edit or delete with the rule's own message, or compute values (including read-only fields). Applied to every write path so a rule cannot be sidestepped
- [x] After-save actions run in a background queue with retries and backoff; every run is recorded with per-action results, and a retry resumes at the failed step so finished work is never repeated. Final failures notify the workflow's owner
- [x] Loop protection: a workflow never re-triggers itself or a workflow already in its chain, and chains stop at 3 levels
- [x] Recurring schedules (hourly/daily/weekly/monthly) in an IANA time zone, correct across daylight-saving changes; claimed atomically so several servers never queue a run twice; pause, resume, cancel queued runs
- [x] Communication: email (account SMTP or server SMTP), SMS and WhatsApp (Twilio), Slack (incoming webhook), templates with record variables, call and note logging, one timeline per record. Inbound SMS/WhatsApp (signature-verified) and inbound email (shared secret) are filed on the matching record and notify followers
- [x] Integrations page (account admins): encrypted credentials, masked display, real "send a test", copyable webhook URLs
- [x] Visual workflow builder (trigger, conditions, actions as a connected flow), run history with details and retry, manual workflows as an Actions menu on records, message templates
- [x] Job queue on MongoDB (atomic claim, retries, dedupe keys), replacing the Redis/BullMQ assumption so there is no extra infrastructure
- [x] Seed: 5 example workflows (3 active), 3 templates and a communication history
- [x] Tests: 138 backend tests (60 new): formula engine and its safety limits, condition evaluator, schedules across DST, SSRF checks, secrets, integrations, messaging and webhooks, and every workflow behaviour above. Verified in Chrome via Playwright, including a real Twilio call that is honestly rejected for fake credentials

### Decisions
- A before-save rule that itself errors never blocks a user: the failure is recorded in its run history ("fail-open"), because blocking all edits over a typo is worse than a rule briefly not applying. A rule that evaluates and says "block" always blocks.
- Workflows act as their creator, like a service account, so editors can run a manual workflow without being able to do everything it does.
- Delivery status: "sent" = provider accepted it, "delivered" = provider callback, "failed" = error text kept. Nothing is ever recorded as sent when it was not.
- The Mongo-backed queue trades peak throughput for zero extra infrastructure. BullMQ would replace only queue.js.

### Not done in Phase 5 (honest list)
- PDF generation, voice call initiation, Python custom code, frontend custom code, and the AI action generator (each needs a separate isolated service or provider; custom code in particular needs a sandbox before it is safe to offer)
- Per-record scheduled instances ("run 7 days after this record's date"): schedules run for all records on a calendar schedule
- Per-user mailbox connections (OAuth to Gmail/Outlook) and provider-specific inbound email parsers: inbound email accepts a simple JSON payload with a shared secret
- WhatsApp groups and message templates required by WhatsApp outside the 24-hour window; Slack channel or direct-message targeting beyond the single incoming webhook
- Workflow versions/rollback, import/export of workflows, and a test mode that runs actions without side effects
- Twilio webhooks need the server reachable from the internet at `PUBLIC_API_URL`; they cannot work on plain localhost

## Phase 6: API, integrations and data operations (DONE)
- [x] REST API for records: list with filter/sort/search/field selection, query, create, update, delete, bulk, history. OpenAPI 3.1 document at `/api/v1/openapi.json` and an in-app API reference
- [x] API keys: hashed at rest, shown once, read or read/write scope, optional workspace restriction and expiry, per-key rate limit, revocation, last-used time. Limited to an endpoint allowlist and low roles; writes are attributed to the key in record history and still go through before-save rules
- [x] Outbound webhooks: record, task, comment and attachment events; HMAC-signed; SSRF-checked at save and at send; retries with backoff and a stable event id; auto-disable after 10 consecutive failures with a notification; delivery log, redelivery, real test ping, secret rotation
- [x] CSV import: RFC 4180 parser, delimiter detection, column mapping with suggestions, dry run, duplicate handling (skip, update, error) by a chosen field, date formats, relationships matched by name, per-row validation, before-save rules and webhooks per row, progress, cancel, resume after a crash, downloadable file of problem rows
- [x] CSV and ZIP (with attachments) export as background jobs; list-visibility rules and formula-injection protection apply; files expire after 3 days
- [x] Public web forms: chosen fields only, optional files, open/close window, response limit, honeypot, minimum-time token, rate limit, notification to chosen people, replaceable link
- [x] Public record links: chosen fields, read-only, expiring, withdrawable, hashed, uniform "not available" answer, `noindex`
- [x] Audit log (13-month retention) of credentials, access, automation, webhooks, forms, shares and data operations
- [x] Frontend: Developers page (keys, webhooks with deliveries, API reference, audit log), import wizard, background export dialog, public forms manager, record share dialog, and the public `/f/:token` and `/s/:token` pages (which never touch the sign-in session)
- [x] Tests: 215 backend tests (77 new). The OpenAPI test signs in and calls every documented operation to prove the route exists, and checks every operation an API key may call is documented. Verified in Chrome via Playwright, including an anonymous visitor submitting a form and opening, then losing, a shared link

### Decisions
- API keys deliberately cannot reach users, integrations, workflows, billing or other keys. Convenience is traded for a small blast radius if a key leaks.
- Webhook payloads contain only list-visible fields, so hiding a field in lists also keeps it out of external systems.
- Import re-uses the normal write path rather than bulk-inserting. It is slower than a bulk insert, but rules, uniqueness, history and webhooks cannot be bypassed.
- Public form links are stored readable (admins need to see them again); public record links are stored hashed (shown once), because they grant read access to existing data.
- Import jobs resume from a per-row checkpoint, so a restart never repeats finished rows.

### Not done in Phase 6 (honest list)
- Webhooks cannot yet be limited to certain dataforms in the UI (the API supports it), and there is no per-key usage history beyond last-used time
- OpenAPI covers the integration surface only (records, dataforms, tasks, comments, files, imports/exports, keys, webhooks, audit, public pages), not user, billing or workflow administration; there is no generated client SDK
- Import has no Excel (.xlsx) support, no saved mapping templates, no custom list separators, and files are limited to 20,000 rows / 10 MB; times without a zone are read as UTC
- Dry run checks values and duplicates but does not evaluate before-save rules (they could have side effects)
- Public forms: no CAPTCHA (honeypot, timing and rate limiting only), no conditional questions, no multi-page forms, no relationship questions, and the "value not available" message still lets someone probe whether a unique value exists by trial
- Public record links share fields only: not comments, files or related records, and there is no password option
- Export of a very large dataform is capped at 50,000 rows, and a ZIP at 1,000 files / 1 GB
- Rate limits are per server process (in memory); running several API instances would need a shared store

## Phase 7: AI, billing and business management (DONE)
- [x] Plan definitions (Free, Team, Business) with limits and feature flags, per-account overrides, and enforcement at creation time: workspaces, records, file size, location fields, API keys and webhooks, public forms and links, AI requests. Upgrade-aware errors (HTTP 402 `PLAN_LIMIT`)
- [x] Billing: payment-provider abstraction with a simulated test provider (development only) and a Stripe adapter (hosted checkout, signed webhooks, scheduled cancellation); checkout, scheduled downgrades with a preview of what would stop, cancel and resume, invoices, usage report, failed-payment handling; plan changes only on a verified provider event
- [x] AI assistance behind a provider abstraction (Anthropic adapter): rewrite, summarize a record / its discussion / its changes, ask about a record, draft an email, explain an analysis from aggregated rows, suggest a workflow or a single action. Off until an admin enables it, monthly allowance per plan, per-person rate limit, timeouts and provider errors mapped to clear messages, data minimisation and a "what was sent" notice. The app is fully functional with no provider configured
- [x] Onboarding: setup wizard (organisation, first workspace and starter dataforms) and a dismissible checklist computed from real data
- [x] Support and feedback: help centre, contact form (stored, optionally emailed), admin inbox with status, "What's new" with unread markers, organisation announcements, NPS survey, privacy-conscious usage insights with opt-outs and deletion
- [x] Frontend: Billing page and test checkout, AI actions (record menu, comment rewrite, email draft, analyzer explanation, workflow suggestion), onboarding wizard and checklist, Help, What's new, Feedback and insights, privacy controls on Profile, AI and analytics switches on Account
- [x] Tests: 282 backend tests (67 new): plan limits and downgrades, signed/forged/replayed billing events, the Stripe adapter with a fake network, every AI guard, provider error and minimisation rule, workflow-draft validation, onboarding, feedback, NPS and usage privacy. Verified in Chrome, with a clearly labelled stand-in server for the AI provider

### Decisions
- Limits only gate creation, so a downgrade is safe: nothing is removed, and over-limit data simply cannot grow.
- The simulated payment provider sends the same kind of signed event a real one does, so the real code path (verification, idempotency, activation) is what the tests and the browser exercise.
- AI is opt-in per organisation because it sends text to a third party. Unusable output is refused rather than repaired, and a draft never becomes a saved workflow without a person saving it.
- Usage analytics use a one-way pseudonym instead of user ids, so admins can see adoption without being able to see individuals.

### Not done in Phase 7 (honest list)
- The Stripe adapter was written from Stripe's documentation and tested with a fake network. It has not been run against a live Stripe account, there is no customer portal link, and moving between two paid plans is not supported with Stripe (cancel to Free, then upgrade). Annual billing, taxes, coupons, seats-based pricing and proration are not implemented
- The test provider has no automatic renewals; in production nothing renews unless Stripe does it. There is no dunning (retries and reminders) beyond marking a subscription past due and notifying admins
- AI: one provider adapter (Anthropic), no streaming, no per-user allowance, no conversation memory, no model choice in the UI, and no review of the provider's data-retention terms: that is for whoever deploys it
- Onboarding cannot invite teammates, because invitations do not exist yet
- Feedback goes to the organisation's admins (and an optional support email). There is no vendor-side console that collects feedback from many organisations, and announcements are per organisation
- NPS is shown as a card after 14 days in an organisation; there is no per-segment analysis. Usage insights are counts only: no funnels or retention
- Still missing from the original page list: password recovery, email verification, invitations and global search

## Next phases
8. Hardening: performance, accessibility audit, e2e (Playwright), deployment config.
