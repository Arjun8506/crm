# OrgCRM

A multi-tenant CRM platform on the MERN stack. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the roadmap, architecture decisions and what is and is not built.

**Status: Phases 1-5 complete.** Foundation (auth, accounts, workspaces, roles, MUI shell, themes), the dynamic data platform (dataforms, custom fields, records, relationships, search/sort/filter, bulk actions, history) and advanced views and analytics (table, cards, Kanban, calendar and map views, saved views, reports, grouped table analyzer, dashboards, CSV export). Phase 4 adds collaboration: comments with @mentions and following, tasks and reminders, notifications, file attachments and live updates. Phase 5 adds automation and communication: a workflow engine (rules, computed values, background actions, schedules), a safe formula language, and email / SMS / WhatsApp / Slack channels with a unified timeline on every record. Imports, public forms, AI, billing etc. are later phases.

## Layout
Two independent projects with their own `package.json` and `node_modules`. There is no root package.json.

- `backend/`: Node, Express 5, MongoDB + Mongoose, Socket.IO, JWT access token + rotating httpOnly refresh cookie, Zod validation, Helmet, rate limiting
- `frontend/`: React 19, Vite, MUI, Redux Toolkit + RTK Query, React Router, React Hook Form + Zod, Framer Motion, Day.js

## Run locally
Requires Node 20+ (tested on 24).

**Backend** (API on http://localhost:4000):
```bash
cd backend
npm install
cp .env.example .env     # then set JWT_ACCESS_SECRET (32+ random chars) and MONGO_URI
npm run dev              # bundled dev MongoDB (:27018) + API with auto-reload
npm run seed             # demo data, in a second terminal (local databases only, see below)
```

**Frontend** (app on http://localhost:5173, proxies `/api` to :4000):
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

### Database
- Default `MONGO_URI=mongodb://127.0.0.1:27018/orgcrm` uses the bundled dev MongoDB that `npm run dev` starts (data in `backend/.data/mongo`; the first run downloads a mongod binary).
- To use your own MongoDB or Atlas, set `MONGO_URI` (include a database name, e.g. `.../orgcrm`) and run `npm run dev:api` instead, since the bundled DB is not needed.
- **`npm run seed` deletes users, accounts, memberships, workspaces and sessions.** It refuses to run against a non-local `MONGO_URI` unless you pass `npm run seed -- --force`.

### Demo accounts (password for all: `Passw0rd!demo`)
| Tenant | Email | Role |
|---|---|---|
| Acme Industries (team plan) | owner@acme.test | owner |
| | admin@acme.test | admin |
| | member@acme.test | member |
| | viewer@acme.test | viewer |
| Globex Corporation (free plan, 2nd tenant for isolation checks) | owner@globex.test | owner |

## Other commands
- `backend`: `npm test` (integration tests on a throwaway in-memory DB, never your configured one), `npm run lint`, `npm start`
- `backend`: `npm run backfill` upgrades records created before Phase 3 (adds the Kanban ordering field). Safe to repeat. Only needed for a database you seeded earlier and want to keep.
- `frontend`: `npm run build`, `npm run lint`

## API (v1)
Base path `/api/v1`. Errors use `{ "error": { "code", "message", "details?" } }`.

| Method & path | Purpose |
|---|---|
| `POST /auth/signup`, `/auth/login` | Create organization + owner / sign in. Returns `accessToken` and sets the `rt` refresh cookie |
| `POST /auth/refresh`, `/auth/logout` | Rotate / revoke the refresh session (requires `X-Requested-With: orgcrm`) |
| `POST /auth/logout-all`, `GET /auth/me` | Revoke all sessions / current user |
| `GET, PATCH /accounts/current` | Account details, usage, settings |
| `GET /users`, `PATCH /users/:id`, `PATCH /users/me` | Members, role/status changes, own profile |
| `GET, POST /workspaces`; `GET, PATCH, DELETE /workspaces/:id`; `POST /workspaces/:id/clone` | Workspaces |
| `GET /dataforms/types` | Field types, their filter operators, and form-pack templates |
| `GET, POST /dataforms?workspaceId=`; `GET, PATCH, DELETE /dataforms/:id`; `POST /dataforms/:id/clone` | Dataforms (workspace admins build; archive via `status`) |
| `POST /dataforms/:id/fields`; `PATCH, DELETE /dataforms/:id/fields/:fieldId`; `PUT /dataforms/:id/fields/order` | Field builder |
| `POST /dataforms/:id/records/query` | Paginated records: `{ page, limit, sort: "key:asc", q, filter }` |
| `POST /dataforms/:id/records`; `GET, PATCH, DELETE /dataforms/:id/records/:recordId`; `POST .../:recordId/copy`; `GET .../:recordId/history` | Record CRUD, duplicate, audit history |
| `POST /dataforms/:id/records/bulk` | `{ action: "update"\|"delete", ids (max 200), data? }` |

| `POST /dataforms/:id/records/:recordId/move` | Kanban: `{ field, value, beforeId?, afterId? }` changes stage and persists the card's position |
| `POST /dataforms/:id/records/export` | CSV download of the filtered/sorted records (visible columns only, formula-injection safe, max 50,000 rows) |
| `GET, POST /dataforms/:id/views`; `PATCH, DELETE .../views/:viewId` | Saved personal or shared views (table, cards, board, calendar, map) |
| `POST /dataforms/:id/analyze` | Grouped table analyzer: `{ groupBy: [{field, interval?}] (max 3), metrics: [{op, field?}], filter, q, page, limit }`. Rows include a `drill` filter |
| `GET, POST /reports?workspaceId=`; `GET, PATCH, DELETE /reports/:id` | Saved list reports and analyzer configurations |
| `GET, POST /dashboards`; `GET, PUT, DELETE /dashboards/:id`; `POST /dashboards/:id/widgets/:widgetId/data` | Account and personal dashboards; widget data is computed per viewer |

| `GET, POST /dataforms/:id/records/:recordId/comments`; `PATCH, DELETE /comments/:id` | Threaded record comments (one level of replies) with `mentions: [userId]` |
| `PUT, DELETE /dataforms/:id/records/:recordId/follow` | Follow / unfollow a record's discussion |
| `GET, POST /tasks`; `GET, PATCH, DELETE /tasks/:id`; `GET, POST /tasks/:id/comments` | Tasks (`scope=mine` or `workspace`, due-date range, `status=open`, `done` or `all`), activity history and task comments |
| `GET /notifications`; `POST /notifications/:id/read`, `/read-all`; `DELETE /notifications/:id` | Notification centre |
| `GET, PUT /notifications/preferences`; `POST, DELETE /notifications/push/devices` | Per-type in-app / email preferences; push device registration (integration point only) |
| `GET, POST /workflows?workspaceId=`; `GET, PUT, DELETE /workflows/:id`; `PATCH .../:id/enabled`; `POST .../:id/run`, `/cancel-pending`, `/rotate-secret` | Workflows (admins build; editors run manual ones) |
| `GET /workflows/:id/executions`; `GET /workflows/executions/:id`; `POST .../executions/:id/retry` | Run history, per-action results, retry from the failed step |
| `POST /workflows/test-formula` | Evaluate a formula against a record or sample values |
| `GET, PUT, DELETE /integrations/:kind`; `POST .../test`, `/rotate-secret` | Slack / Twilio / SMTP credentials (account admins; secrets are write-only) |
| `GET /dataforms/:id/records/:recordId/interactions`; `POST .../messages`, `.../interactions` | Unified timeline; send email/SMS/WhatsApp; log a call or note |
| `GET /communications/channels`; `GET, POST /communications/templates`; `POST /communications/render` | Which channels work; message templates; preview with record variables |
| `POST /webhooks/twilio/status/:id`, `/twilio/inbound/:id`, `/inbound-email/:id` | Public provider callbacks (Twilio signature or shared secret required) |
| `GET, POST /dataforms/:id/records/:recordId/attachments`; `POST .../attachments/zip` | List, upload (multipart field `file`), bulk ZIP download |
| `GET /attachments/:id/download` (add `?inline=1` for images); `PATCH, DELETE /attachments/:id` | Authorized download (inline only for verified images), description, delete |

**Real-time (Socket.IO, same origin as the API).** Connect with `{ auth: { token: <access token> } }`, then `emit('subscribe', { workspaceId }, ack)` for each workspace; the server only joins rooms you may open. Events carry ids only (`record.changed`, `comment.changed`, `task.changed`, `attachment.changed`, `notification.new`): refetch through the REST API.

**Filter format** (validated and compiled server-side; unknown fields/operators are rejected):
```json
{ "op": "and", "conditions": [
  { "field": "status", "operator": "eq", "value": "customer" },
  { "op": "or", "conditions": [
    { "field": "name", "operator": "contains", "value": "grace" },
    { "field": "last_contacted", "operator": "inLastDays", "value": 30 } ] } ] }
```
Access levels per workspace: viewer (read), editor (records), admin (dataform structure). Account owners/admins are admins everywhere; account viewers are always read-only.

## Security notes
- Account ID and role come from the verified token plus a fresh `Membership` lookup on every request, never from the client.
- All tenant-owned queries are filtered by `account`. Cross-tenant IDs return 404. Covered by tests.
- Request bodies are Zod-validated and stripped of unknown keys (no mass assignment); non-string values are rejected (NoSQL operator injection).
- The access token is kept in memory only. The refresh token is an httpOnly, SameSite cookie, stored hashed server-side, single-use (rotated), and only accepted with a custom header.
- Uploaded files are stored outside the database under `STORAGE_DIR` with server-generated keys (there is no public URL). Downloads go through an authorized endpoint, are forced to `attachment` with `nosniff`, and only genuine png/jpeg/gif/webp (checked by file signature, not the declared type) can be shown inline. Executable file types are refused and the per-file limit comes from the plan (25 MB default).
- Socket rooms are joined only after a server-side access check, and events never contain record content.
- Email is sent only if `SMTP_URL` is configured **and** the user opted in. Otherwise nothing is sent and the UI says so; failures are logged and never block the request.
- Workflow formulas are parsed and interpreted by a small expression engine (no `eval` / `new Function`), with caps on length, nesting and tokens. Workflow definitions are validated against the dataform's real fields on every save.
- Outbound webhooks must be https, are checked against private / loopback / link-local / metadata addresses (at save and again at run time), never follow redirects, time out after 10 s, and are signed with `X-OrgCRM-Signature: sha256=HMAC(secret, timestamp + "." + body)`.
- Integration credentials are encrypted at rest (AES-256-GCM, key from `SECRETS_KEY`) and are never returned by the API. Twilio callbacks must carry a valid `X-Twilio-Signature`; inbound email needs the shared `X-Webhook-Secret`.
- Workflows run with the identity of the user who created them. Editors can trigger a manual workflow but cannot change what it does.
- A channel that is not configured never pretends to send: the API answers 409 `NOT_CONFIGURED`, workflow actions fail with a clear message, and a message only becomes "sent" when the provider accepts it ("delivered" only comes from a provider callback).
- `backend/.env` is git-ignored. Never commit database credentials.

## Known limitations
See the plan. Notably: password reset, email verification, invitations, search and notifications are not implemented yet. Their UI entry points are either absent or clearly disabled.
