import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { slugify } from '../../utils/slug.js';
import { Account } from '../accounts/account.model.js';
import { RecordModel } from '../records/record.model.js';
import { workspaceAccess } from '../workspaces/access.js';
import { Dataform, FieldDefinition } from './dataform.model.js';
import { TYPES, ValueError, parseValue } from './fieldTypes.js';

export const MAX_FIELDS = 100;
const UNIQUE_TYPES = new Set(['text', 'email', 'url', 'phone', 'integer', 'decimal', 'date']);
const NUMBER_TYPES = new Set(['integer', 'decimal']);

export async function loadDataform(req, minLevel = 'viewer') {
  const dataform = await Dataform.findOne({ _id: req.params.id, account: req.auth.accountId });
  if (!dataform) throw notFound('Dataform not found');
  const access = await workspaceAccess(req.auth, dataform.workspace, minLevel);
  return { dataform, access };
}

export async function uniqueDataformSlug(accountId, workspaceId, base) {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  while (await Dataform.exists({ account: accountId, workspace: workspaceId, slug })) slug = `${root}-${++n}`;
  return slug;
}

// Validates a field definition and returns the document-ready shape.
export async function normalizeField(dataform, input, { existing } = {}) {
  const f = { ...(existing ? existing.toObject() : {}), ...input };
  const errors = [];
  const bad = (path, message) => errors.push({ path, message });

  f.options = f.options || [];
  f.visibility = { create: true, edit: true, list: true, ...(f.visibility || {}) };

  if (['dropdown', 'multiselect'].includes(f.type)) {
    if (f.options.length === 0) bad('options', 'Add at least one option');
    if (new Set(f.options.map((o) => o.value)).size !== f.options.length) bad('options', 'Option values must be unique');
  } else f.options = [];

  if (f.type === 'relationship') {
    const target = f.config?.targetDataform && await Dataform.findOne({
      _id: f.config.targetDataform, account: dataform.account, workspace: dataform.workspace,
    });
    if (!target) bad('config.targetDataform', 'Choose a dataform in this workspace to link to');
  } else f.config = { targetDataform: null };

  if (f.unique && !UNIQUE_TYPES.has(f.type)) bad('unique', `${f.type} fields cannot be unique`);
  if (!NUMBER_TYPES.has(f.type)) { f.min = null; f.max = null; }
  if (f.min != null && f.max != null && f.min > f.max) bad('min', 'Minimum cannot exceed maximum');

  if (f.defaultValue != null && f.defaultValue !== '') {
    if (f.type === 'relationship') bad('defaultValue', 'Relationship fields cannot have a default');
    else {
      try { f.defaultValue = parseValue(f, f.defaultValue); } catch (e) {
        if (!(e instanceof ValueError)) throw e;
        bad('defaultValue', e.message);
      }
    }
  } else f.defaultValue = null;

  if (f.required && !f.visibility.create && f.defaultValue == null) bad('required', 'A required field hidden on create needs a default value');
  if (f.readOnly && f.required && f.defaultValue == null) bad('readOnly', 'A required read-only field needs a default value');

  if (errors.length) throw badRequest('Validation failed', errors);
  return f;
}

export async function assertUniqueSafe(dataform, key) {
  const dupes = await RecordModel.aggregate([
    { $match: { account: dataform.account, dataform: dataform._id, [`data.${key}`]: { $ne: null } } },
    { $group: { _id: `$data.${key}`, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 1 },
  ]);
  if (dupes.length) throw conflict('Existing records already contain duplicate values for this field');
}

export async function addField(dataform, input) {
  if (!TYPES[input.type]) throw badRequest('Unknown field type');
  const count = await FieldDefinition.countDocuments({ dataform: dataform._id });
  if (count >= MAX_FIELDS) throw conflict(`A dataform can have at most ${MAX_FIELDS} fields`);
  if (await FieldDefinition.exists({ dataform: dataform._id, key: input.key })) throw conflict('A field with this key already exists');
  if (input.type === 'location') {
    const account = await Account.findById(dataform.account).lean();
    if (!account?.entitlements?.locationFields) throw forbidden('Location fields are not included in your plan');
  }

  const f = await normalizeField(dataform, input);
  const last = await FieldDefinition.findOne({ dataform: dataform._id }).sort({ order: -1 }).lean();
  const field = await FieldDefinition.create({
    account: dataform.account, dataform: dataform._id, order: (last?.order ?? -1) + 1,
    key: f.key, label: f.label, type: f.type, description: f.description, section: f.section,
    required: f.required, unique: f.unique, readOnly: f.readOnly, defaultValue: f.defaultValue,
    min: f.min, max: f.max, options: f.options, config: f.config, visibility: f.visibility,
  });
  if (!dataform.primaryField && ['text', 'email'].includes(field.type)) {
    dataform.primaryField = field.key;
    await dataform.save();
  }
  return field;
}
