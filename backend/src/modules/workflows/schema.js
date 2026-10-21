import { z } from 'zod';
import { objectId } from '../../middleware/validate.js';
import { badRequest } from '../../utils/errors.js';
import { assertPublicUrl } from '../../providers/http.js';
import { Dataform, FieldDefinition } from '../dataforms/dataform.model.js';
import { OPERATORS, TYPES, ValueError, parseValue } from '../dataforms/fieldTypes.js';
import { FormulaError, parse, referencedFields } from '../formulas/formula.js';
import { normalizeRecipient } from '../interactions/message.service.js';
import { usersWithAccess } from '../workspaces/access.js';
import { scheduleSchema } from './schedule.js';

export const MAX_ACTIONS = 10;
const RESERVED = new Set(['record', 'old', 'user', 'workflow']);
const PRE = new Set(['pre_save', 'pre_delete']);
const PRE_ACTIONS = { pre_save: new Set(['validation_error', 'set_field']), pre_delete: new Set(['validation_error']) };

// ---- triggers ----
const saveEvents = z.array(z.enum(['create', 'update'])).min(1).default(['create', 'update']);
const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pre_save'), events: saveEvents }),
  z.object({ type: z.literal('post_save'), events: saveEvents }),
  z.object({ type: z.literal('pre_delete') }),
  z.object({ type: z.literal('post_delete') }),
  z.object({ type: z.literal('manual'), label: z.string().trim().max(60).optional() }),
  z.object({ type: z.literal('schedule'), schedule: scheduleSchema }),
]);

// ---- conditions: a tree of field tests, formulas and "changed" checks ----
const fieldKey = z.string().min(1).max(60);
const fieldCond = z.object({ kind: z.literal('field'), field: fieldKey, operator: z.string().max(20), value: z.unknown().optional() });
const formulaCond = z.object({ kind: z.literal('formula'), expression: z.string().min(1).max(1000) });
const changedCond = z.object({ kind: z.literal('changed'), field: fieldKey });
const group = z.lazy(() => z.object({ kind: z.literal('group').default('group'), op: z.enum(['and', 'or']), conditions: z.array(z.union([fieldCond, formulaCond, changedCond, group])).max(30) }));

// ---- actions ----
const text = (max, min = 1) => z.string().trim().min(min).max(max);
const valueSpec = z.object({
  field: fieldKey, mode: z.enum(['value', 'formula']).default('value'), value: z.unknown().optional(), expression: z.string().max(1000).optional(),
}).refine((v) => v.mode !== 'formula' || !!v.expression?.trim(), { message: 'Enter a formula', path: ['expression'] });
const people = z.object({ mode: z.enum(['users', 'creator', 'followers']), users: z.array(objectId).max(20).default([]) });
const recipient = z.object({ mode: z.enum(['field', 'fixed']), field: fieldKey.optional(), address: z.string().max(320).optional() });

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify'), recipients: people, title: text(200), body: z.string().max(1000).default('') }),
  z.object({
    type: z.literal('create_task'), title: text(200), description: z.string().max(5000).default(''),
    assignees: z.object({ mode: z.enum(['users', 'creator']), users: z.array(objectId).max(10).default([]) }),
    dueInDays: z.number().int().min(0).max(365).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  }),
  z.object({ type: z.literal('validation_error'), message: text(300) }),
  z.object({ type: z.literal('set_field'), ...valueSpec.shape }),
  z.object({ type: z.literal('set_child_field'), childDataformId: objectId, relationField: fieldKey, ...valueSpec.shape }),
  z.object({ type: z.literal('create_record'), dataformId: objectId, values: z.array(valueSpec).max(30) }),
  z.object({ type: z.literal('clone_record') }),
  z.object({ type: z.literal('comment'), body: text(2000) }),
  z.object({ type: z.literal('webhook'), url: z.string().url().max(500), includeRecord: z.boolean().default(true) }),
  z.object({ type: z.literal('slack'), text: text(3000) }),
  z.object({ type: z.literal('send_email'), to: recipient, subject: text(300), body: text(10000) }),
  z.object({ type: z.literal('send_sms'), to: recipient, body: text(1600) }),
  z.object({ type: z.literal('send_whatsapp'), to: recipient, body: text(1600) }),
]);

export const workflowBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(''),
  dataformId: objectId,
  trigger: triggerSchema,
  conditions: group.nullable().default(null),
  actions: z.array(actionSchema).max(MAX_ACTIONS),
  onError: z.enum(['stop', 'continue']).default('stop'),
});

// ---- semantic validation against the dataform's real fields ----
export async function validateWorkflow(def, { account, workspace, dataform, fields }) {
  const problems = [];
  const bad = (path, message) => problems.push({ path, message });
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const type = def.trigger.type;

  const checkFormula = (expression, path) => {
    try {
      for (const ref of referencedFields(parse(expression))) {
        const base = ref.replace(/_label$/, '');
        if (!byKey.has(ref) && !byKey.has(base) && !RESERVED.has(ref)) bad(path, `Unknown field {${ref}} in the formula`);
      }
    } catch (e) { if (e instanceof FormulaError) bad(path, e.message); else throw e; }
  };

  let count = 0;
  const walk = (node, path, depth) => {
    if (depth > 3) return bad(path, 'Condition groups are nested too deeply');
    node.conditions.forEach((c, i) => {
      const p = `${path}.conditions.${i}`;
      if (++count > 30) return bad(p, 'Too many conditions');
      if (c.conditions) return walk(c, p, depth + 1);
      if (c.kind === 'formula') return checkFormula(c.expression, `${p}.expression`);
      const f = byKey.get(c.field);
      if (!f) return bad(`${p}.field`, `Unknown field: ${c.field}`);
      if (c.kind === 'changed') {
        if (!['pre_save', 'post_save'].includes(type)) bad(p, 'A "changed" condition needs a save trigger');
        return undefined;
      }
      if (!OPERATORS[TYPES[f.type].group].includes(c.operator)) return bad(`${p}.operator`, `"${c.operator}" does not apply to ${f.type} fields`);
      if (!['empty', 'notEmpty', 'isTrue', 'isFalse'].includes(c.operator) && !['inLastDays', 'inNextDays'].includes(c.operator)) {
        const values = Array.isArray(c.value) ? c.value : [c.value];
        // Multi-select conditions name single options, so each value is checked like a dropdown value.
        const probe = TYPES[f.type].group === 'multi' ? { ...f, type: 'dropdown' } : f;
        try { for (const v of values) if (parseValue({ ...probe, min: null, max: null }, v) === null) throw new ValueError('A value is required'); } catch (e) { if (e instanceof ValueError) bad(`${p}.value`, e.message); else throw e; }
      }
      return undefined;
    });
  };
  if (def.conditions) walk(def.conditions, 'conditions', 1);

  const checkSpec = (spec, target, path) => {
    if (!target) return;
    if (spec.mode === 'formula') return checkFormula(spec.expression, `${path}.expression`);
    try { parseValue({ ...target, min: null, max: null, required: false }, spec.value); } catch (e) { if (e instanceof ValueError) bad(`${path}.value`, e.message); else throw e; }
    return undefined;
  };
  const sameWorkspaceForm = async (id, path) => {
    const df = await Dataform.findOne({ _id: id, account, workspace: workspace._id });
    if (!df) bad(path, 'Choose a dataform in this workspace');
    return df;
  };
  const checkRecipient = (to, kind, path) => {
    if (to.mode === 'field') {
      const f = byKey.get(to.field);
      if (!f || f.type !== (kind === 'email' ? 'email' : 'phone')) bad(`${path}.field`, `Choose an ${kind === 'email' ? 'email' : 'phone'} field`);
    } else {
      try { normalizeRecipient(kind, to.address); } catch (e) { bad(`${path}.address`, e.message); }
    }
  };

  for (const [i, a] of def.actions.entries()) {
    const p = `actions.${i}`;
    if (PRE.has(type) && !PRE_ACTIONS[type].has(a.type)) bad(p, `${a.type} cannot run before a record is saved or deleted. Use a "after save" or "after delete" trigger`);
    if (!PRE.has(type) && a.type === 'validation_error') bad(p, 'A validation error can only block a save or delete: use a "before save" or "before delete" trigger');
    if (a.type === 'set_field') checkSpec(a, byKey.get(a.field) ?? (bad(`${p}.field`, `Unknown field: ${a.field}`), null), p);
    if (a.type === 'notify' && a.recipients.mode === 'users') {
      if (!a.recipients.users.length) bad(`${p}.recipients`, 'Choose at least one person');
      else if ((await usersWithAccess(workspace, a.recipients.users)).length !== new Set(a.recipients.users).size) bad(`${p}.recipients`, 'Every person must be able to open this workspace');
    }
    if (a.type === 'create_task' && a.assignees.mode === 'users' && (await usersWithAccess(workspace, a.assignees.users)).length !== new Set(a.assignees.users).size) bad(`${p}.assignees`, 'Every assignee must be able to open this workspace');
    if (a.type === 'set_child_field') {
      const child = await sameWorkspaceForm(a.childDataformId, `${p}.childDataformId`);
      if (child) {
        const cf = await FieldDefinition.find({ dataform: child._id }).lean();
        const rel = cf.find((f) => f.key === a.relationField);
        if (!rel || rel.type !== 'relationship' || String(rel.config?.targetDataform) !== String(dataform._id)) bad(`${p}.relationField`, `Choose a relationship field in ${child.name} that links to ${dataform.name}`);
        checkSpec(a, cf.find((f) => f.key === a.field) ?? (bad(`${p}.field`, `Unknown field in ${child.name}: ${a.field}`), null), p);
      }
    }
    if (a.type === 'create_record') {
      const target = await sameWorkspaceForm(a.dataformId, `${p}.dataformId`);
      if (target) {
        const tf = await FieldDefinition.find({ dataform: target._id }).lean();
        a.values.forEach((v, j) => checkSpec(v, tf.find((f) => f.key === v.field) ?? (bad(`${p}.values.${j}.field`, `Unknown field in ${target.name}: ${v.field}`), null), `${p}.values.${j}`));
      }
    }
    if (a.type === 'webhook') { try { await assertPublicUrl(a.url); } catch (e) { bad(`${p}.url`, e.message); } }
    if (a.type === 'send_email') checkRecipient(a.to, 'email', `${p}.to`);
    if (a.type === 'send_sms') checkRecipient(a.to, 'sms', `${p}.to`);
    if (a.type === 'send_whatsapp') checkRecipient(a.to, 'whatsapp', `${p}.to`);
  }
  if (def.trigger.type === 'schedule' && def.actions.some((a) => a.type === 'validation_error')) bad('actions', 'Scheduled workflows cannot block saves');
  if (problems.length) throw badRequest('This workflow has problems', problems);
  return def;
}
