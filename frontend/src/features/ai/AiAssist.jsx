import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, MenuList, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import AiIcon from '@mui/icons-material/AutoAwesomeRounded';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import {
  useAiAskMutation, useAiDraftEmailMutation, useAiExplainAnalysisMutation, useAiRewriteMutation, useAiStatusQuery, useAiSuggestWorkflowMutation, useAiSummarizeMutation,
} from './aiApi';

const WHY = {
  disabled: 'AI assistance is switched off for your organisation. An admin can turn it on under Account settings.',
  plan: 'AI assistance is included from the Team plan.',
  quota: 'You have used this month’s AI requests.',
};

// AI features stay out of the way when the server has no provider; they explain themselves when something else blocks them.
export function useAi() {
  const { data } = useAiStatusQuery();
  return { status: data, visible: !!data && data.configured, available: !!data?.available, why: data ? WHY[data.reason] : undefined };
}

// A button that is only there when AI exists, and is disabled with a reason when it cannot be used right now.
export function AiButton({ children = 'AI', onClick, size = 'small', variant = 'text', ...rest }) {
  const { visible, available, why } = useAi();
  if (!visible) return null;
  return (
    <Tooltip title={available ? 'Uses AI. You will see what is sent.' : why ?? ''}>
      <span>
        <Button size={size} variant={variant} startIcon={<AiIcon fontSize="small" />} disabled={!available} onClick={onClick} {...rest}>{children}</Button>
      </span>
    </Tooltip>
  );
}

// Tells the person exactly what left the server, so "AI" is never a black box.
export function Disclosure({ shared }) {
  if (!shared) return null;
  const parts = [];
  if (shared.selection) parts.push('the text you selected');
  if (shared.fields?.length) parts.push(`fields: ${shared.fields.join(', ')}`);
  if (shared.withheld) parts.push(`${shared.withheld} email/phone field${shared.withheld === 1 ? '' : 's'} withheld`);
  if (shared.historyEntries) parts.push(`${shared.historyEntries} history entries`);
  if (shared.comments) parts.push(`${shared.comments} comment${shared.comments === 1 ? '' : 's'}`);
  if (shared.interactions) parts.push(`${shared.interactions} message${shared.interactions === 1 ? '' : 's'}`);
  if (shared.aggregatedOnly) parts.push(`${shared.rows} summary rows (no individual records)`);
  if (shared.noRecords) parts.push('your field names only (no records)');
  if (shared.redactions) parts.push(`${shared.redactions} email address/number${shared.redactions === 1 ? '' : 'es'} masked`);
  return <Typography variant="caption" color="text.secondary">Sent to the AI provider: {parts.join(' · ') || 'nothing from your records'}.</Typography>;
}

const Footer = () => <Typography variant="caption" color="text.secondary">AI can make mistakes. Check anything important before you rely on it.</Typography>;

function Working({ label = 'Thinking…' }) {
  return <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 2 }} role="status"><CircularProgress size={20} /><Typography>{label}</Typography></Stack>;
}

// Runs one AI call when opened and shows the answer. `run` returns a promise of the mutation result.
function ResultDialog({ title, run, onClose, children, actions }) {
  const dispatch = useDispatch();
  const [state, setState] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // The request starts when the dialog opens (and again on "Try again"). State only changes when the answer arrives.
  useEffect(() => {
    let alive = true;
    run().then(
      (result) => alive && setState({ phase: 'done', result }),
      (err) => { if (alive) { setState({ phase: 'error', message: errorMessage(err, 'The AI assistant could not answer') }); dispatch(showToast(errorMessage(err), 'error')); } },
    );
    return () => { alive = false; };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = () => { setState({ phase: 'loading' }); setAttempt((n) => n + 1); };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {state.phase === 'error' && <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>Try again</Button>}>{state.message}</Alert>}
        {state.phase === 'loading' && <Working />}
        {state.phase === 'done' && <Stack spacing={1.5}>{children(state.result)}<Disclosure shared={state.result.shared} /><Footer /></Stack>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>{state.phase === 'done' && actions?.(state.result)}<Button color="inherit" onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

const Answer = ({ text }) => <Typography sx={{ whiteSpace: 'pre-wrap' }}>{text}</Typography>;

// ---- on a record: summaries and questions ----
export function RecordAiMenu({ dataformId, recordId }) {
  const [anchor, setAnchor] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [summarize] = useAiSummarizeMutation();
  const [ask] = useAiAskMutation();
  const [question, setQuestion] = useState('');
  const base = { dataformId, recordId };
  const SUMMARIES = [['all', 'Summarize this record'], ['discussion', 'Summarize the discussion'], ['activity', 'Summarize recent changes']];
  const open = (d) => { setAnchor(null); setDialog(d); };
  return (
    <>
      <AiButton onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu">AI</AiButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuList dense>
          {SUMMARIES.map(([scope, label]) => <MenuItem key={scope} onClick={() => open({ kind: 'summary', scope, label })}>{label}</MenuItem>)}
          <MenuItem onClick={() => open({ kind: 'ask' })}>Ask a question…</MenuItem>
        </MenuList>
      </Menu>
      {dialog?.kind === 'summary' && <ResultDialog title={dialog.label} onClose={() => setDialog(null)} run={() => summarize({ ...base, scope: dialog.scope }).unwrap()}>{(r) => <Answer text={r.text} />}</ResultDialog>}
      {dialog?.kind === 'ask' && !dialog.q && (
        <Dialog open onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
          <form onSubmit={(e) => { e.preventDefault(); setDialog({ kind: 'ask', q: question.trim() }); }}>
            <DialogTitle>Ask about this record</DialogTitle>
            <DialogContent><TextField autoFocus fullWidth sx={{ mt: 1 }} label="Your question" value={question} onChange={(e) => setQuestion(e.target.value)} helperText="Answers use only this record’s visible fields and discussion." /></DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}><Button color="inherit" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="contained" disabled={question.trim().length < 3}>Ask</Button></DialogActions>
          </form>
        </Dialog>
      )}
      {dialog?.kind === 'ask' && dialog.q && <ResultDialog title={dialog.q} onClose={() => { setDialog(null); setQuestion(''); }} run={() => ask({ ...base, question: dialog.q }).unwrap()}>{(r) => <Answer text={r.text} />}</ResultDialog>}
    </>
  );
}

// ---- rewrite text being written (comments and messages) ----
const MODES = [['professional', 'More professional'], ['friendly', 'Friendlier'], ['concise', 'Shorter'], ['expand', 'More detail'], ['fix', 'Fix spelling and grammar']];
export function RewriteMenu({ text, onUse }) {
  const [anchor, setAnchor] = useState(null);
  const [mode, setMode] = useState(null);
  const [rewrite] = useAiRewriteMutation();
  return (
    <>
      <AiButton disabled={!text.trim()} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu">Rewrite</AiButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {MODES.map(([m, label]) => <MenuItem key={m} onClick={() => { setAnchor(null); setMode([m, label]); }}>{label}</MenuItem>)}
      </Menu>
      {mode && (
        <ResultDialog title={`Rewrite: ${mode[1].toLowerCase()}`} onClose={() => setMode(null)} run={() => rewrite({ text: text.trim().slice(0, 4000), mode: mode[0] }).unwrap()}
          actions={(r) => <Button variant="contained" onClick={() => { onUse(r.text); setMode(null); }}>Use this</Button>}>
          {(r) => (
            <>
              <Box><Typography variant="caption" color="text.secondary">Suggestion</Typography><Answer text={r.text} /></Box>
              <Box sx={{ opacity: 0.7 }}><Typography variant="caption" color="text.secondary">Your text</Typography><Answer text={text} /></Box>
            </>
          )}
        </ResultDialog>
      )}
    </>
  );
}

// ---- email draft: fills the compose form, never sends ----
export function DraftEmailButton({ dataformId, recordId, onUse }) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [tone, setTone] = useState('professional');
  const [go, setGo] = useState(null);
  const [draft] = useAiDraftEmailMutation();
  return (
    <>
      <AiButton onClick={() => setOpen(true)}>Draft with AI</AiButton>
      {open && !go && (
        <Dialog open onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
          <form onSubmit={(e) => { e.preventDefault(); setGo({ intent: intent.trim(), tone }); }}>
            <DialogTitle>Draft an email with AI</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <TextField autoFocus label="What should the email do?" value={intent} onChange={(e) => setIntent(e.target.value)} multiline minRows={2} placeholder="Follow up on last week’s call and propose a time to meet" />
                <TextField select label="Tone" value={tone} onChange={(e) => setTone(e.target.value)}><MenuItem value="professional">Professional</MenuItem><MenuItem value="friendly">Friendly</MenuItem><MenuItem value="brief">Brief</MenuItem></TextField>
                <Typography variant="caption" color="text.secondary">The record’s visible fields (without email or phone) are sent to the AI provider. Nothing is sent to the customer until you press Send.</Typography>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}><Button color="inherit" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="contained" disabled={intent.trim().length < 3}>Write draft</Button></DialogActions>
          </form>
        </Dialog>
      )}
      {go && (
        <ResultDialog title="Email draft" onClose={() => { setGo(null); setOpen(false); }} run={() => draft({ dataformId, recordId, ...go }).unwrap()}
          actions={(r) => <Button variant="contained" onClick={() => { onUse({ subject: r.subject, body: r.body }); setGo(null); setOpen(false); }}>Use this draft</Button>}>
          {(r) => <><Typography fontWeight={600}>{r.subject}</Typography><Answer text={r.body} /></>}
        </ResultDialog>
      )}
    </>
  );
}

// ---- explain an analyzer table ----
export function ExplainButton({ dataformId, analysis }) {
  const [open, setOpen] = useState(false);
  const [explain] = useAiExplainAnalysisMutation();
  return (
    <>
      <AiButton onClick={() => setOpen(true)}>Explain</AiButton>
      {open && <ResultDialog title="What this table shows" onClose={() => setOpen(false)} run={() => explain({ dataformId, analysis }).unwrap()}>{(r) => <Answer text={r.text} />}</ResultDialog>}
    </>
  );
}

// ---- workflow draft: untrusted until you review and save it in the builder ----
export function SuggestWorkflowButton({ workspaceId, dataforms }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dataformId, setDataformId] = useState('');
  const [description, setDescription] = useState('');
  const [go, setGo] = useState(false);
  const [suggest] = useAiSuggestWorkflowMutation();
  const close = () => { setOpen(false); setGo(false); };
  return (
    <>
      <AiButton variant="outlined" onClick={() => { setDataformId(dataforms[0]?._id ?? ''); setOpen(true); }}>Suggest with AI</AiButton>
      {open && !go && (
        <Dialog open onClose={close} maxWidth="sm" fullWidth>
          <form onSubmit={(e) => { e.preventDefault(); setGo(true); }}>
            <DialogTitle>Describe the workflow you want</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <TextField select label="For which dataform?" value={dataformId} onChange={(e) => setDataformId(e.target.value)}>{dataforms.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}</TextField>
                <TextField autoFocus label="What should happen?" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={3} placeholder="When a deal is marked Won, notify me and create a task to send the contract within 2 days" />
                <Typography variant="caption" color="text.secondary">Only the names and types of this dataform’s fields are sent, never your records. The result is a draft: you review it in the builder, and it starts switched off.</Typography>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}><Button color="inherit" onClick={close}>Cancel</Button><Button type="submit" variant="contained" disabled={!dataformId || description.trim().length < 10}>Draft workflow</Button></DialogActions>
          </form>
        </Dialog>
      )}
      {go && (
        <ResultDialog title="Workflow draft" onClose={close} run={() => suggest({ dataformId, description: description.trim() }).unwrap()}
          actions={(r) => r.valid && <Button variant="contained" onClick={() => navigate(`/w/${workspaceId}/workflows/new`, { state: { aiDraft: r.draft } })}>Open in builder</Button>}>
          {(r) => (
            r.valid ? (
              <>
                <Alert severity="success">The draft is valid for this dataform. Review every step in the builder before saving.</Alert>
                <Typography fontWeight={600}>{r.draft.name}</Typography>
                {r.draft.description && <Typography color="text.secondary">{r.draft.description}</Typography>}
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>{r.draft.actions.map((a, i) => <Chip key={i} size="small" label={a.type.replace(/_/g, ' ')} />)}</Stack>
              </>
            ) : (
              <>
                <Alert severity="warning">The AI’s draft does not work for this dataform, so it cannot be opened. Try describing it differently.</Alert>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{r.problems.slice(0, 6).map((p, i) => <li key={i}><Typography variant="body2">{p.message}</Typography></li>)}</Box>
              </>
            )
          )}
        </ResultDialog>
      )}
    </>
  );
}
