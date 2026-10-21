import { Alert, Autocomplete, Box, Button, Card, Chip, IconButton, MenuItem, Stack, Switch, TextField, Tooltip, Typography, FormControlLabel } from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import ArrowDown from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUp from '@mui/icons-material/ArrowUpwardRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useListMembersQuery } from '../accounts/accountApi';
import { useGetDataformQuery, useListDataformsQuery } from '../dataforms/dataformsApi';
import FormulaField, { TemplateField } from './FormulaField';

export const ACTION_TYPES = {
  validation_error: { label: 'Block the save with a message', group: 'Rules', pre: true },
  set_field: { label: 'Set a field value', group: 'Change data', pre: true },
  set_child_field: { label: 'Set a field on linked records', group: 'Change data' },
  create_record: { label: 'Create a record', group: 'Change data' },
  clone_record: { label: 'Clone this record', group: 'Change data' },
  notify: { label: 'Send an in-app notification', group: 'Notify' },
  create_task: { label: 'Create a task', group: 'Notify' },
  comment: { label: 'Add a comment', group: 'Notify' },
  send_email: { label: 'Send an email', group: 'Message' },
  send_sms: { label: 'Send an SMS', group: 'Message' },
  send_whatsapp: { label: 'Send a WhatsApp message', group: 'Message' },
  slack: { label: 'Post to Slack', group: 'Message' },
  webhook: { label: 'Call a webhook', group: 'Message' },
};

const PRE_ALLOWED = { pre_save: ['validation_error', 'set_field'], pre_delete: ['validation_error'] };
export const allowedActions = (triggerType) => (PRE_ALLOWED[triggerType] ?? Object.keys(ACTION_TYPES).filter((t) => t !== 'validation_error'));

export const newAction = (type) => ({
  validation_error: { type, message: '' },
  set_field: { type, field: '', mode: 'value', value: '', expression: '' },
  set_child_field: { type, childDataformId: '', relationField: '', field: '', mode: 'value', value: '', expression: '' },
  create_record: { type, dataformId: '', values: [] },
  clone_record: { type },
  notify: { type, recipients: { mode: 'creator', users: [] }, title: '', body: '' },
  create_task: { type, title: '', description: '', assignees: { mode: 'creator', users: [] }, priority: 'normal' },
  comment: { type, body: '' },
  send_email: { type, to: { mode: 'field', field: '' }, subject: '', body: '' },
  send_sms: { type, to: { mode: 'field', field: '' }, body: '' },
  send_whatsapp: { type, to: { mode: 'field', field: '' }, body: '' },
  slack: { type, text: '' },
  webhook: { type, url: '', includeRecord: true },
}[type]);

// A literal value input that matches the field type.
function ValueInput({ field, value, onChange }) {
  if (!field) return <TextField disabled label="Value" size="small" fullWidth />;
  if (field.type === 'dropdown') {
    return <TextField select size="small" fullWidth label="Value" value={value ?? ''} onChange={(e) => onChange(e.target.value)}><MenuItem value=""><em>Empty</em></MenuItem>{field.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}</TextField>;
  }
  if (field.type === 'boolean') {
    return <TextField select size="small" fullWidth label="Value" value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}><MenuItem value=""><em>Empty</em></MenuItem><MenuItem value="true">Yes</MenuItem><MenuItem value="false">No</MenuItem></TextField>;
  }
  const type = ['integer', 'decimal'].includes(field.type) ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return <TextField size="small" fullWidth label="Value" type={type} value={value ?? ''} slotProps={type === 'date' || type === 'datetime-local' ? { inputLabel: { shrink: true } } : undefined}
    onChange={(e) => onChange(type === 'number' && e.target.value !== '' ? Number(e.target.value) : type === 'datetime-local' && e.target.value ? new Date(e.target.value).toISOString() : e.target.value)} />;
}

// Which field to write, and either a fixed value or a formula.
function ValueSpec({ spec, fields, dataformId, onChange, error }) {
  const field = fields.find((f) => f.key === spec.field);
  const literalOk = field && !['relationship', 'multiselect', 'location'].includes(field.type);
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField select size="small" fullWidth label="Field" value={spec.field} onChange={(e) => onChange({ ...spec, field: e.target.value, value: '', mode: ['relationship', 'multiselect', 'location'].includes(fields.find((f) => f.key === e.target.value)?.type) ? 'formula' : spec.mode })} error={!!error}>
          {fields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}{f.readOnly ? ' (read-only for users)' : ''}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Set to" value={spec.mode} onChange={(e) => onChange({ ...spec, mode: e.target.value })} sx={{ minWidth: 150 }}>
          <MenuItem value="value" disabled={!!field && !literalOk}>A fixed value</MenuItem><MenuItem value="formula">A formula</MenuItem>
        </TextField>
      </Stack>
      {spec.mode === 'formula'
        ? <FormulaField label="Formula" value={spec.expression} fields={fields} dataformId={dataformId} onChange={(expression) => onChange({ ...spec, expression })} />
        : <ValueInput field={field} value={spec.value} onChange={(value) => onChange({ ...spec, value })} />}
      {field && !literalOk && <Typography variant="caption" color="text.secondary">{field.type === 'relationship' ? 'Link fields are set with a formula that returns a record id.' : 'This field type is set with a formula.'}</Typography>}
    </Stack>
  );
}

function People({ value, onChange, label = 'Who', modes }) {
  const { data: members = [] } = useListMembersQuery();
  const people = members.filter((m) => m.status === 'active').map((m) => m.user);
  return (
    <Stack spacing={1.5}>
      <TextField select size="small" label={label} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value })}>
        {modes.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
      </TextField>
      {value.mode === 'users' && (
        <Autocomplete multiple size="small" options={people} getOptionLabel={(u) => u.name} isOptionEqualToValue={(a, b) => a._id === b._id}
          value={people.filter((u) => value.users.includes(u._id))} onChange={(_e, v) => onChange({ ...value, users: v.map((u) => u._id) })}
          renderInput={(p) => <TextField {...p} label="People" helperText="Only people who can open this workspace" />} />
      )}
    </Stack>
  );
}

function Recipient({ value, onChange, fields, kind }) {
  const type = kind === 'email' ? 'email' : 'phone';
  const candidates = fields.filter((f) => f.type === type);
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <TextField select size="small" label="Send to" value={value.mode} onChange={(e) => onChange({ mode: e.target.value, ...(e.target.value === 'field' ? { field: candidates[0]?.key ?? '' } : { address: '' }) })} sx={{ minWidth: 190 }}>
        <MenuItem value="field">The record&apos;s {type} field</MenuItem><MenuItem value="fixed">A fixed {kind === 'email' ? 'address' : 'number'}</MenuItem>
      </TextField>
      {value.mode === 'field'
        ? <TextField select size="small" fullWidth label={`${type === 'email' ? 'Email' : 'Phone'} field`} value={value.field ?? ''} onChange={(e) => onChange({ ...value, field: e.target.value })} helperText={candidates.length ? undefined : `This dataform has no ${type} field`}>
          {candidates.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
        </TextField>
        : <TextField size="small" fullWidth label={kind === 'email' ? 'Email address' : 'Phone (+14155550123)'} value={value.address ?? ''} onChange={(e) => onChange({ ...value, address: e.target.value })} />}
    </Stack>
  );
}

function TargetDataform({ value, onChange, workspaceId, label, exclude }) {
  const { data: forms = [] } = useListDataformsQuery({ workspaceId }, { skip: !workspaceId });
  return (
    <TextField select size="small" fullWidth label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {forms.filter((d) => d._id !== exclude).map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
    </TextField>
  );
}

function Body({ action: a, set, ctx }) {
  const { fields, dataformId, workspaceId } = ctx;
  const { data: other } = useGetDataformQuery(a.childDataformId || a.dataformId, { skip: !(a.childDataformId || a.dataformId) });
  const otherFields = other?.fields ?? [];
  switch (a.type) {
    case 'validation_error':
      return <TemplateField label="Message shown to the person saving" value={a.message} fields={fields} onChange={(message) => set({ ...a, message })} />;
    case 'set_field':
      return <ValueSpec spec={a} fields={fields} dataformId={dataformId} onChange={(s) => set({ ...a, ...s })} />;
    case 'set_child_field': {
      const relFields = otherFields.filter((f) => f.type === 'relationship' && f.config?.targetDataform === dataformId);
      return (
        <Stack spacing={1.5}>
          <TargetDataform label="Linked dataform" value={a.childDataformId} workspaceId={workspaceId} exclude={dataformId} onChange={(v) => set({ ...a, childDataformId: v, relationField: '', field: '' })} />
          <TextField select size="small" fullWidth label="Link field that points here" value={a.relationField} onChange={(e) => set({ ...a, relationField: e.target.value })} helperText={a.childDataformId && !relFields.length ? 'That dataform has no link field pointing to this one' : undefined}>
            {relFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
          <ValueSpec spec={a} fields={otherFields} dataformId={dataformId} onChange={(s) => set({ ...a, ...s })} />
          <Typography variant="caption" color="text.secondary">Formulas are evaluated against this record, then written to every linked record.</Typography>
        </Stack>
      );
    }
    case 'create_record':
      return (
        <Stack spacing={1.5}>
          <TargetDataform label="Create in" value={a.dataformId} workspaceId={workspaceId} onChange={(v) => set({ ...a, dataformId: v, values: [] })} />
          {a.values.map((v, i) => (
            <Box key={i} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
              <ValueSpec spec={v} fields={otherFields} dataformId={dataformId} onChange={(s) => set({ ...a, values: a.values.map((x, j) => (j === i ? { ...x, ...s } : x)) })} />
              <Button size="small" color="inherit" sx={{ mt: 1 }} onClick={() => set({ ...a, values: a.values.filter((_, j) => j !== i) })}>Remove value</Button>
            </Box>
          ))}
          {a.dataformId && <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => set({ ...a, values: [...a.values, { field: '', mode: 'value', value: '', expression: '' }] })}>Add a value</Button>}
        </Stack>
      );
    case 'clone_record':
      return <Typography variant="body2" color="text.secondary">Creates a copy of the record. Fields that must be unique are left empty.</Typography>;
    case 'notify':
      return (
        <Stack spacing={1.5}>
          <People value={a.recipients} onChange={(recipients) => set({ ...a, recipients })} label="Notify" modes={[['creator', 'The person who created the record'], ['followers', 'People following the record'], ['users', 'Specific people']]} />
          <TemplateField label="Title" value={a.title} fields={fields} onChange={(title) => set({ ...a, title })} />
          <TemplateField label="Details (optional)" value={a.body} fields={fields} minRows={2} onChange={(body) => set({ ...a, body })} />
        </Stack>
      );
    case 'create_task':
      return (
        <Stack spacing={1.5}>
          <TemplateField label="Task title" value={a.title} fields={fields} onChange={(title) => set({ ...a, title })} />
          <People value={a.assignees} onChange={(assignees) => set({ ...a, assignees })} label="Assign to" modes={[['creator', 'The person who created the record'], ['users', 'Specific people']]} />
          <Stack direction="row" spacing={1.5}>
            <TextField size="small" type="number" label="Due in (days)" value={a.dueInDays ?? ''} onChange={(e) => set({ ...a, dueInDays: e.target.value === '' ? undefined : Math.max(0, Math.min(365, Number(e.target.value))) })} sx={{ width: 150 }} />
            <TextField select size="small" label="Priority" value={a.priority} onChange={(e) => set({ ...a, priority: e.target.value })} sx={{ minWidth: 150 }}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <MenuItem key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</MenuItem>)}
            </TextField>
          </Stack>
        </Stack>
      );
    case 'comment':
      return <TemplateField label="Comment" value={a.body} fields={fields} minRows={2} onChange={(body) => set({ ...a, body })} />;
    case 'send_email':
      return (
        <Stack spacing={1.5}>
          <Recipient value={a.to} fields={fields} kind="email" onChange={(to) => set({ ...a, to })} />
          <TemplateField label="Subject" value={a.subject} fields={fields} onChange={(subject) => set({ ...a, subject })} />
          <TemplateField label="Message" value={a.body} fields={fields} minRows={4} onChange={(body) => set({ ...a, body })} />
        </Stack>
      );
    case 'send_sms':
    case 'send_whatsapp':
      return (
        <Stack spacing={1.5}>
          <Recipient value={a.to} fields={fields} kind="sms" onChange={(to) => set({ ...a, to })} />
          <TemplateField label="Message" value={a.body} fields={fields} minRows={2} onChange={(body) => set({ ...a, body })} />
        </Stack>
      );
    case 'slack':
      return <TemplateField label="Message" value={a.text} fields={fields} minRows={2} onChange={(text) => set({ ...a, text })} helperText="Posted to the Slack channel connected under Settings > Integrations." />;
    case 'webhook':
      return (
        <Stack spacing={1.5}>
          <TextField size="small" fullWidth label="URL" placeholder="https://example.com/hooks/orgcrm" value={a.url} onChange={(e) => set({ ...a, url: e.target.value })} helperText="Must be https and reachable from the internet. Internal addresses are blocked." />
          <FormControlLabel control={<Switch checked={a.includeRecord} onChange={(e) => set({ ...a, includeRecord: e.target.checked })} />} label="Include the record's data in the payload" />
          <Alert severity="info" sx={{ py: 0 }}>Each call is signed with <code>X-OrgCRM-Signature</code> (HMAC-SHA256 of timestamp + body). The secret is shown on the workflow&apos;s Settings tab.</Alert>
        </Stack>
      );
    default:
      return null;
  }
}

export default function ActionCard({ index, count, action, ctx, problems, onChange, onRemove, onMove }) {
  const meta = ACTION_TYPES[action.type];
  const incompatible = !allowedActions(ctx.triggerType).includes(action.type);
  return (
    <Card sx={{ p: 2, borderColor: problems.length || incompatible ? 'error.main' : undefined }}>
      <Stack direction="row" sx={{ mb: 1.5, alignItems: 'center', gap: 1 }}>
        <Chip size="small" color="primary" label={index + 1} />
        <Typography fontWeight={600} sx={{ flex: 1 }}>{meta?.label ?? action.type}</Typography>
        <Tooltip title="Move up"><span><IconButton size="small" aria-label="Move action up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Move down"><span><IconButton size="small" aria-label="Move action down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Remove"><IconButton size="small" color="error" aria-label="Remove action" onClick={onRemove}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
      {incompatible && <Alert severity="error" sx={{ mb: 1.5 }}>This action cannot run with the trigger you chose. Remove it or change the trigger.</Alert>}
      {problems.map((p, i) => <Alert key={i} severity="error" sx={{ mb: 1.5 }}>{p}</Alert>)}
      <Body action={action} set={onChange} ctx={ctx} />
    </Card>
  );
}
