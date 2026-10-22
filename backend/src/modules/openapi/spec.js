import { keyAllows } from '../apikeys/policy.js';
import { EVENTS } from '../outbound/webhook.model.js';

// OpenAPI 3.1 description of the integration-facing REST API. A test calls every documented operation to prove it exists,
// and checks that every endpoint API keys are allowed to use is documented here.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const str = (extra = {}) => ({ type: 'string', ...extra });
const idStr = str({ pattern: '^[a-f0-9]{24}$', example: '665f1c2e8a1b2c3d4e5f6a7b' });
const list = (item, extra = {}) => obj({ data: { type: 'array', items: item }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' }, ...extra });

const params = (path) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
  name: m[1], in: 'path', required: true, schema: m[1] === 'token' ? str() : idStr,
}));
const q = (name, schema, description) => ({ name, in: 'query', schema, ...(description ? { description } : {}) });

const PAGING = [q('page', { type: 'integer', minimum: 1, default: 1 }), q('limit', { type: 'integer', minimum: 1, maximum: 200, default: 25 })];
const DATA = { type: 'object', additionalProperties: true, description: 'Field values keyed by the field\'s immutable `key`.' };

// [method, path, tag, summary, options]
//   auth: 'user' (default) | 'admin' (account admin, person only) | 'public' | 'refresh'
//   body: schema, query: [parameters], ok: [status, schema|description], note: extra text
const OPS = [
  ['post', '/auth/login', 'Authentication', 'Sign in with email and password', { auth: 'public', body: obj({ email: str({ format: 'email' }), password: str() }, ['email', 'password']), ok: [200, 'Returns an access token (15 min) and sets the httpOnly refresh cookie.'] }],
  ['post', '/auth/refresh', 'Authentication', 'Exchange the refresh cookie for a new access token', { auth: 'refresh' }],
  ['post', '/auth/logout', 'Authentication', 'End this session', { auth: 'refresh', ok: [204, 'Signed out'] }],
  ['get', '/auth/me', 'Authentication', 'The signed-in user, account and permissions'],

  ['get', '/workspaces', 'Workspaces', 'List workspaces you can open'],
  ['post', '/workspaces', 'Workspaces', 'Create a workspace', { body: obj({ name: str(), description: str() }, ['name']), ok: [201, 'Created'] }],
  ['get', '/workspaces/{id}', 'Workspaces', 'Get a workspace'],
  ['patch', '/workspaces/{id}', 'Workspaces', 'Update a workspace', { body: obj({ name: str(), description: str() }) }],
  ['post', '/workspaces/{id}/clone', 'Workspaces', 'Copy a workspace with its structure', { ok: [201, 'Created'] }],
  ['delete', '/workspaces/{id}', 'Workspaces', 'Delete a workspace and everything in it', { ok: [204, 'Deleted'] }],

  ['get', '/dataforms', 'Dataforms', 'List dataforms (tables of records)', { query: [q('workspaceId', idStr)] }],
  ['get', '/dataforms/types', 'Dataforms', 'Field types, their filter operators, and templates'],
  ['post', '/dataforms', 'Dataforms', 'Create a dataform, optionally from a template', { body: obj({ workspaceId: idStr, name: str(), templateId: str() }, ['workspaceId', 'name']), ok: [201, 'Created'] }],
  ['get', '/dataforms/{id}', 'Dataforms', 'Get a dataform with its field definitions'],
  ['patch', '/dataforms/{id}', 'Dataforms', 'Update a dataform'],
  ['post', '/dataforms/{id}/clone', 'Dataforms', 'Copy a dataform\'s structure', { ok: [201, 'Created'] }],
  ['delete', '/dataforms/{id}', 'Dataforms', 'Delete a dataform and its records', { ok: [204, 'Deleted'] }],
  ['post', '/dataforms/{id}/fields', 'Dataforms', 'Add a custom field', { body: ref('FieldInput'), ok: [201, 'Created'] }],
  ['patch', '/dataforms/{id}/fields/{fieldId}', 'Dataforms', 'Change a field (its key and type are immutable)'],
  ['delete', '/dataforms/{id}/fields/{fieldId}', 'Dataforms', 'Delete a field', { ok: [204, 'Deleted'] }],

  ['get', '/dataforms/{id}/records', 'Records', 'List records', { query: [...PAGING, q('sort', str(), 'field key, `:asc` or `:desc`'), q('q', str(), 'text search'), q('filter', str(), 'URL-encoded JSON filter tree'), q('fields', str(), 'comma-separated field keys to return')], ok: [200, list(ref('Record'), { refs: { type: 'object', description: 'Labels of linked records' } })] }],
  ['post', '/dataforms/{id}/records', 'Records', 'Create a record', { body: obj({ data: DATA }, ['data']), ok: [201, obj({ record: ref('Record') })] }],
  ['post', '/dataforms/{id}/records/query', 'Records', 'Query records with a filter tree', { body: ref('RecordQuery'), ok: [200, list(ref('Record'))] }],
  ['post', '/dataforms/{id}/records/export', 'Records', 'Download matching records as CSV (immediate)', { body: obj({ q: str(), sort: str(), filter: ref('FilterTree'), columns: { type: 'array', items: str() } }), ok: [200, 'text/csv'] }],
  ['post', '/dataforms/{id}/records/bulk', 'Records', 'Update or delete up to 200 records', { body: obj({ action: str({ enum: ['update', 'delete'] }), ids: { type: 'array', items: idStr }, data: DATA }, ['action', 'ids']) }],
  ['get', '/dataforms/{id}/records/{recordId}', 'Records', 'Get one record', { query: [q('fields', str())] }],
  ['patch', '/dataforms/{id}/records/{recordId}', 'Records', 'Update fields of a record', { body: obj({ data: DATA }, ['data']) }],
  ['delete', '/dataforms/{id}/records/{recordId}', 'Records', 'Delete a record', { ok: [204, 'Deleted'] }],
  ['post', '/dataforms/{id}/records/{recordId}/copy', 'Records', 'Duplicate a record', { ok: [201, 'Created'] }],
  ['post', '/dataforms/{id}/records/{recordId}/move', 'Records', 'Move a card between dropdown stages', { body: obj({ field: str(), value: str() }, ['field', 'value']) }],
  ['get', '/dataforms/{id}/records/{recordId}/history', 'Records', 'Change history; actors are people or `API key: <name>`'],
  ['post', '/dataforms/{id}/analyze', 'Records', 'Aggregate (count, sum, average, group by, date buckets)'],

  ['get', '/dataforms/{id}/records/{recordId}/comments', 'Collaboration', 'Discussion on a record'],
  ['post', '/dataforms/{id}/records/{recordId}/comments', 'Collaboration', 'Comment on a record', { body: obj({ body: str(), mentions: { type: 'array', items: idStr } }, ['body']), ok: [201, 'Created'] }],
  ['get', '/dataforms/{id}/records/{recordId}/attachments', 'Collaboration', 'Files attached to a record'],
  ['post', '/dataforms/{id}/records/{recordId}/attachments', 'Collaboration', 'Upload a file (multipart, field `file`)', { ok: [201, 'Created'], multipart: true }],
  ['get', '/attachments/{id}/download', 'Collaboration', 'Download a file', { ok: [200, 'File bytes'] }],
  ['delete', '/attachments/{id}', 'Collaboration', 'Delete a file', { ok: [204, 'Deleted'] }],
  ['get', '/tasks', 'Collaboration', 'List tasks', { query: [...PAGING, q('scope', str({ enum: ['mine', 'workspace'] })), q('workspaceId', idStr), q('status', str({ enum: ['open', 'done', 'all'] }))] }],
  ['post', '/tasks', 'Collaboration', 'Create a task', { body: obj({ workspaceId: idStr, recordId: idStr, title: str(), assignees: { type: 'array', items: idStr }, due: str({ format: 'date-time' }) }, ['workspaceId', 'title']), ok: [201, 'Created'] }],
  ['get', '/tasks/{id}', 'Collaboration', 'Get a task with its activity'],
  ['patch', '/tasks/{id}', 'Collaboration', 'Update a task'],
  ['delete', '/tasks/{id}', 'Collaboration', 'Delete a task', { ok: [204, 'Deleted'] }],

  ['get', '/dataforms/{id}/imports', 'Data operations', 'Recent CSV imports into a dataform'],
  ['post', '/dataforms/{id}/imports', 'Data operations', 'Upload a CSV: returns a preview and a suggested column mapping', { multipart: true, ok: [201, 'Created'] }],
  ['get', '/imports/{id}', 'Data operations', 'Import status, counts and the first row errors'],
  ['post', '/imports/{id}/start', 'Data operations', 'Start (or dry-run) an import with a column mapping', { body: ref('ImportStart'), ok: [202, 'Queued'] }],
  ['post', '/imports/{id}/cancel', 'Data operations', 'Stop a running import'],
  ['get', '/imports/{id}/errors', 'Data operations', 'Download the rows that failed, with the reason', { ok: [200, 'text/csv'] }],
  ['delete', '/imports/{id}', 'Data operations', 'Delete an import and its uploaded file', { ok: [204, 'Deleted'] }],
  ['get', '/exports', 'Data operations', 'Your recent exports of a dataform', { query: [q('dataformId', idStr)] }],
  ['post', '/exports', 'Data operations', 'Start a background CSV or ZIP (with attachments) export', { body: obj({ dataformId: idStr, format: str({ enum: ['csv', 'zip'] }), q: str(), sort: str(), filter: ref('FilterTree'), columns: { type: 'array', items: str() } }, ['dataformId']), ok: [202, 'Queued'] }],
  ['get', '/exports/{id}', 'Data operations', 'Export status'],
  ['get', '/exports/{id}/download', 'Data operations', 'Download a finished export (kept for 3 days)', { ok: [200, 'File bytes'] }],
  ['delete', '/exports/{id}', 'Data operations', 'Delete an export', { ok: [204, 'Deleted'] }],

  ['get', '/api-keys', 'Developers', 'List API keys (never the key itself)', { auth: 'admin' }],
  ['post', '/api-keys', 'Developers', 'Create an API key. The key is shown once.', { auth: 'admin', body: obj({ name: str(), scope: str({ enum: ['read', 'write'] }), workspaceIds: { type: 'array', items: idStr }, expiresInDays: { type: 'integer', minimum: 1, maximum: 730 } }, ['name', 'scope']), ok: [201, 'Created'] }],
  ['delete', '/api-keys/{id}', 'Developers', 'Revoke an API key', { auth: 'admin', ok: [204, 'Revoked'] }],
  ['get', '/outbound-webhooks', 'Developers', 'List outbound webhooks and the available events', { auth: 'admin' }],
  ['post', '/outbound-webhooks', 'Developers', 'Create an outbound webhook. The signing secret is shown once.', { auth: 'admin', body: obj({ name: str(), url: str({ format: 'uri' }), events: { type: 'array', items: str({ enum: EVENTS }) }, dataformIds: { type: 'array', items: idStr } }, ['name', 'url', 'events']), ok: [201, 'Created'] }],
  ['patch', '/outbound-webhooks/{id}', 'Developers', 'Change or re-enable a webhook', { auth: 'admin' }],
  ['delete', '/outbound-webhooks/{id}', 'Developers', 'Delete a webhook', { auth: 'admin', ok: [204, 'Deleted'] }],
  ['post', '/outbound-webhooks/{id}/rotate-secret', 'Developers', 'Issue a new signing secret', { auth: 'admin' }],
  ['post', '/outbound-webhooks/{id}/test', 'Developers', 'Send a real test event and report the receiver\'s answer', { auth: 'admin' }],
  ['get', '/outbound-webhooks/{id}/deliveries', 'Developers', 'Delivery attempts and their outcome', { auth: 'admin', query: [...PAGING, q('status', str({ enum: ['queued', 'succeeded', 'failed'] }))] }],
  ['post', '/outbound-webhooks/deliveries/{id}/redeliver', 'Developers', 'Send a past event again with the same event id', { auth: 'admin', ok: [202, 'Queued'] }],
  ['get', '/audit', 'Developers', 'Audit log of sensitive actions', { auth: 'admin', query: [...PAGING, q('action', str())] }],

  ['get', '/dataforms/{id}/forms', 'Public pages', 'Public web forms of a dataform', { auth: 'admin' }],
  ['post', '/dataforms/{id}/forms', 'Public pages', 'Create a public web form', { auth: 'admin', body: ref('PublicFormInput'), ok: [201, 'Created'] }],
  ['patch', '/dataforms/{id}/forms/{formId}', 'Public pages', 'Edit, pause or reopen a form', { auth: 'admin' }],
  ['post', '/dataforms/{id}/forms/{formId}/regenerate-link', 'Public pages', 'Replace the form\'s public link (the old one stops working)', { auth: 'admin' }],
  ['delete', '/dataforms/{id}/forms/{formId}', 'Public pages', 'Delete a form', { auth: 'admin', ok: [204, 'Deleted'] }],
  ['get', '/dataforms/{id}/records/{recordId}/shares', 'Public pages', 'Public links to a record'],
  ['post', '/dataforms/{id}/records/{recordId}/shares', 'Public pages', 'Create a read-only public link to chosen fields. The link is shown once.', { body: obj({ fields: { type: 'array', items: str() }, expiresInDays: { type: 'integer', minimum: 1, maximum: 90, default: 7 } }, ['fields']), ok: [201, 'Created'] }],
  ['delete', '/dataforms/{id}/records/{recordId}/shares/{shareId}', 'Public pages', 'Revoke a public link', { ok: [204, 'Revoked'] }],
  ['get', '/public/forms/{token}', 'Public pages', 'Form definition for a visitor (no authentication)', { auth: 'public' }],
  ['post', '/public/forms/{token}/submit', 'Public pages', 'Submit a form (no authentication)', { auth: 'public', body: obj({ data: DATA, _t: str({ description: '`formToken` from the GET response' }), _hp: str({ description: 'Hidden honeypot; must stay empty' }) }, ['data', '_t']), ok: [200, obj({ ok: { type: 'boolean' }, message: str() })] }],
  ['get', '/public/shares/{token}', 'Public pages', 'Read a shared record (no authentication)', { auth: 'public' }],
];

const SECURITY = { user: [{ bearerAuth: [] }, { apiKey: [] }], admin: [{ bearerAuth: [] }], public: [], refresh: [{ refreshCookie: [] }] };

function operation([method, path, tag, summary, o = {}]) {
  const [status, resp] = o.ok ?? [200];
  const auth = o.auth ?? 'user';
  const sample = path.replace(/\{\w+\}/g, 'a'.repeat(24));
  const scope = ['read', 'write'].find((s) => keyAllows(s, method.toUpperCase(), sample));
  const content = typeof resp === 'object' && resp ? json(resp) : undefined;
  return {
    tags: [tag], summary,
    ...(scope ? { 'x-api-key-scope': scope, description: `Allowed for API keys with the **${scope}** scope (or higher).` } : auth === 'user' || auth === 'public' ? {} : { description: 'Not available to API keys.' }),
    security: SECURITY[auth],
    parameters: [...params(path), ...(o.query ?? [])],
    ...(o.body ? { requestBody: { required: true, content: json(o.body) } } : {}),
    ...(o.multipart ? { requestBody: { required: true, content: { 'multipart/form-data': { schema: obj({ file: str({ format: 'binary' }) }) } } } } : {}),
    responses: {
      [status]: { description: typeof resp === 'string' ? resp : 'Success', ...(content ? { content } : {}) },
      ...(auth === 'public' ? {} : { 401: { description: 'Missing or invalid credentials', content: json(ref('Error')) } }),
      400: { description: 'Validation failed', content: json(ref('Error')) },
      404: { description: 'Not found (also returned for things in other accounts)', content: json(ref('Error')) },
    },
  };
}

const webhookPayload = (event) => ({
  post: {
    summary: `Delivered when: ${event}`,
    requestBody: { content: json(obj({ id: str({ description: 'Event id; identical on retries and redeliveries' }), event: str({ const: event }), createdAt: str({ format: 'date-time' }), data: { type: 'object', additionalProperties: true } }, ['id', 'event', 'data'])) },
    responses: { 200: { description: 'Any 2xx marks the delivery as succeeded. Anything else is retried (up to 6 attempts with growing delays).' } },
  },
});

export function buildSpec({ serverUrl = '/api/v1' } = {}) {
  const paths = {};
  for (const op of OPS) {
    const [method, path] = op;
    (paths[path] ??= {})[method] = operation(op);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'OrgCRM API',
      version: '1.0.0',
      description: [
        'REST API for records, dataforms, tasks and data operations.',
        '',
        '**Authentication.** Send `Authorization: Bearer <access token>` (people) or `Authorization: Bearer ocrm_…` / `X-API-Key: ocrm_…` (API keys). API keys can only call the operations marked with `x-api-key-scope`.',
        '',
        '**Webhooks.** Outbound webhook requests carry `X-OrgCRM-Event`, `X-OrgCRM-Delivery` (event id), `X-OrgCRM-Timestamp` and `X-OrgCRM-Signature: sha256=<hex>`, where the signature is `HMAC_SHA256(secret, timestamp + "." + rawBody)`. Reject requests with an old timestamp, and use the event id to ignore repeats.',
        '',
        '**Errors** always look like `{ "error": { "code", "message", "details?" } }`.',
        '',
        'This document covers the integration-facing surface; endpoints for users, billing, integrations credentials and workflows are managed in the app.',
      ].join('\n'),
    },
    servers: [{ url: serverUrl }],
    tags: [...new Set(OPS.map((o) => o[2]))].map((name) => ({ name })),
    paths,
    webhooks: Object.fromEntries(EVENTS.map((e) => [e, webhookPayload(e)])),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Short-lived access token from /auth/login.' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Or `Authorization: Bearer ocrm_…`.' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: 'refresh_token', description: 'httpOnly cookie; also send `X-Requested-With: orgcrm`.' },
      },
      schemas: {
        Error: obj({ error: obj({ code: str(), message: str(), details: { type: 'array', items: obj({ path: str(), message: str() }) } }, ['code', 'message']) }, ['error']),
        Record: obj({ _id: idStr, data: DATA, createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }), _label: str() }),
        FilterTree: { type: 'object', description: '`{ "op": "and"|"or", "conditions": [ { "field", "operator", "value" } | <group> ] }`. Operators depend on the field type (see GET /dataforms/types).', properties: { op: str({ enum: ['and', 'or'] }), conditions: { type: 'array', items: {} } }, required: ['op', 'conditions'] },
        RecordQuery: obj({ page: { type: 'integer' }, limit: { type: 'integer', maximum: 200 }, sort: str(), q: str(), filter: ref('FilterTree'), fields: { type: 'array', items: str() } }),
        FieldInput: obj({ key: str({ pattern: '^[a-z][a-z0-9_]{0,39}$' }), label: str(), type: str(), required: { type: 'boolean' }, unique: { type: 'boolean' }, options: { type: 'array', items: obj({ value: str(), label: str() }) } }, ['key', 'label', 'type']),
        ImportStart: obj({ mapping: { type: 'array', items: obj({ column: { type: 'integer' }, field: str() }, ['column', 'field']) }, duplicate: str({ enum: ['skip', 'update', 'error'] }), matchField: str(), dateFormat: str({ enum: ['iso', 'dmy', 'mdy'] }), dryRun: { type: 'boolean' } }, ['mapping']),
        PublicFormInput: obj({ name: str(), description: str(), successMessage: str(), fields: { type: 'array', items: obj({ key: str(), label: str(), helpText: str(), required: { type: 'boolean' } }, ['key']) }, allowFiles: { type: 'boolean' }, opensAt: str({ format: 'date-time' }), closesAt: str({ format: 'date-time' }), maxSubmissions: { type: 'integer' }, notifyUsers: { type: 'array', items: idStr } }, ['name', 'fields']),
      },
    },
  };
}

export const documentedOperations = () => OPS.map(([method, path]) => ({ method: method.toUpperCase(), path }));
