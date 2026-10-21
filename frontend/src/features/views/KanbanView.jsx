import { useState } from 'react';
import { Alert, Box, Card, Chip, IconButton, Menu, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import MoreIcon from '@mui/icons-material/MoreVertRounded';
import ViewKanbanIcon from '@mui/icons-material/ViewKanbanOutlined';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { formatValue } from '../records/fieldUtils';
import { recordsApi, useQueryRecordsQuery } from '../records/recordsApi';
import { useMoveRecordMutation } from './viewsApi';

const LIMIT = 200;
const NONE = '__none__';

function Column({ stage, cards, canWrite, dragging, over, setOver, onDrop, onOpen, onMove, stages, refs, shown }) {
  const [menu, setMenu] = useState(null);
  const isOver = over?.stage === stage.value;
  return (
    <Box
      onDragOver={(e) => { if (!canWrite || !dragging.id) return; e.preventDefault(); if (!over || over.stage !== stage.value || over.cardId) setOver({ stage: stage.value, cardId: null }); }}
      onDrop={(e) => { e.preventDefault(); onDrop(stage.value, over?.stage === stage.value ? over : { stage: stage.value }); }}
      sx={{ width: 290, flexShrink: 0, bgcolor: isOver ? 'action.hover' : 'action.selected', borderRadius: 2, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 340px)', minHeight: 160, transition: 'background-color 120ms' }}
    >
      <Stack direction="row" sx={{ px: 1.5, py: 1.25, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography fontWeight={600} noWrap>{stage.label}</Typography>
        <Chip size="small" label={cards.length} />
      </Stack>
      <Stack spacing={1} sx={{ px: 1, pb: 1, overflowY: 'auto', flex: 1 }}>
        {cards.map((r) => {
          const before = isOver && over.cardId === r._id && over.pos === 'before';
          const after = isOver && over.cardId === r._id && over.pos === 'after';
          return (
            <Box
              key={r._id}
              onDragOver={(e) => {
                if (!canWrite || !dragging.id) return;
                e.preventDefault(); e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                if (over?.cardId !== r._id || over?.pos !== pos) setOver({ stage: stage.value, cardId: r._id, pos });
              }}
              sx={{ borderTop: 3, borderBottom: 3, borderColor: 'transparent', ...(before && { borderTopColor: 'primary.main' }), ...(after && { borderBottomColor: 'primary.main' }) }}
            >
              <Card
                draggable={canWrite} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r._id); dragging.set(r._id); }}
                onDragEnd={() => { dragging.set(null); setOver(null); }}
                sx={{ p: 1.5, cursor: canWrite ? 'grab' : 'pointer', opacity: dragging.id === r._id ? 0.4 : 1, '&:hover': { borderColor: 'primary.main' } }}
                onClick={() => onOpen(r._id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(r._id)}
              >
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Typography variant="body2" fontWeight={600} sx={{ pr: 0.5 }}>{r._label}</Typography>
                  {canWrite && (
                    <IconButton size="small" aria-label={`Move ${r._label} to another stage`} sx={{ mt: -0.5, mr: -0.75 }} onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, id: r._id }); }}><MoreIcon fontSize="small" /></IconButton>
                  )}
                </Stack>
                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                  {shown.map((f) => {
                    const v = r.data?.[f.key];
                    if (v === null || v === undefined || v === '') return null;
                    return <Typography key={f.key} variant="caption" color="text.secondary" noWrap>{f.label}: {f.type === 'relationship' ? refs?.[f.key]?.[v] : formatValue(f, v)}</Typography>;
                  })}
                </Stack>
              </Card>
            </Box>
          );
        })}
        {cards.length === 0 && <Typography variant="body2" color="text.disabled" sx={{ textAlign: 'center', py: 3 }}>{canWrite ? 'Drop cards here' : 'Empty'}</Typography>}
      </Stack>
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {stages.filter((s) => s.value !== stage.value).map((s) => (
          <MenuItem key={s.value} onClick={() => { onMove(menu.id, s.value); setMenu(null); }}>Move to {s.label}</MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

export default function KanbanView({ dataform, fields, query, config, onConfig, canWrite, onOpen }) {
  const dispatch = useDispatch();
  const stageFields = fields.filter((f) => f.type === 'dropdown');
  const stageField = stageFields.find((f) => f.key === config.groupField) ?? stageFields[0];
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [move] = useMoveRecordMutation();
  const args = { dataformId: dataform._id, page: 1, limit: LIMIT, q: query.q || undefined, filter: query.filter || undefined, sort: 'rank:asc' };
  const { data, error, refetch } = useQueryRecordsQuery(args, { skip: !stageField });

  const stages = stageField ? stageField.options : [];
  const columns = Object.fromEntries([...stages.map((s) => [s.value, []]), [NONE, []]]);
  for (const r of data?.data ?? []) (columns[r.data?.[stageField.key]] ?? columns[NONE]).push(r);

  if (!stageField) return <EmptyState icon={<ViewKanbanIcon />} title="No stage field available" description="The Kanban board groups records by a dropdown field. Add a dropdown field in the dataform settings first." />;
  if (error) return <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error, 'Could not load the board')} onRetry={refetch} /></Box>;
  if (!data) return <Stack direction="row" spacing={2} sx={{ p: 2 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="rounded" width={290} height={300} />)}</Stack>;

  const listFields = fields.filter((f) => f.visibility.list && f.key !== stageField.key && f.key !== dataform.primaryField);
  const shown = (config.cardFields?.length ? config.cardFields.map((k) => listFields.find((f) => f.key === k)).filter(Boolean) : listFields.slice(0, 3));

  const doMove = async (id, value, prevId, nextId) => {
    // Optimistic: reposition the card in the cached list, roll back if the server refuses.
    const patch = dispatch(recordsApi.util.updateQueryData('queryRecords', args, (draft) => {
      const from = draft.data.findIndex((r) => r._id === id);
      if (from < 0) return;
      const [card] = draft.data.splice(from, 1);
      card.data[stageField.key] = value;
      let to = draft.data.length;
      if (nextId) to = draft.data.findIndex((r) => r._id === nextId);
      else if (prevId) to = draft.data.findIndex((r) => r._id === prevId) + 1;
      draft.data.splice(to < 0 ? draft.data.length : to, 0, card);
    }));
    try {
      await move({ dataformId: dataform._id, recordId: id, field: stageField.key, value, ...(prevId ? { afterId: prevId } : {}), ...(nextId ? { beforeId: nextId } : {}) }).unwrap();
    } catch (err) {
      patch.undo();
      dispatch(showToast(errorMessage(err, 'Could not move the card'), 'error'));
    }
  };

  const onDrop = (stageValue, target) => {
    const id = dragId;
    setDragId(null); setOver(null);
    if (!id || stageValue === NONE) return;
    const list = columns[stageValue].filter((r) => r._id !== id);
    let prevId; let nextId;
    if (target.cardId) {
      const i = list.findIndex((r) => r._id === target.cardId);
      if (target.pos === 'before') { nextId = list[i]?._id; prevId = list[i - 1]?._id; } else { prevId = list[i]?._id; nextId = list[i + 1]?._id; }
    } else prevId = list.at(-1)?._id;
    doMove(id, stageValue, prevId, nextId);
  };

  const allStages = [...stages, ...(columns[NONE].length ? [{ value: NONE, label: 'No stage' }] : [])];
  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        {stageFields.length > 1 && (
          <TextField select size="small" label="Group by" value={stageField.key} onChange={(e) => onConfig({ groupField: e.target.value })} sx={{ minWidth: 180 }}>
            {stageFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
        )}
        {data.total > LIMIT && <Alert severity="info" sx={{ py: 0 }}>Showing the first {LIMIT} of {data.total} records. Use search or filters to narrow the board.</Alert>}
      </Stack>
      <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 1, alignItems: 'flex-start' }}>
        {allStages.map((s) => (
          <Column
            key={s.value} stage={s} cards={columns[s.value]} canWrite={canWrite} dragging={{ id: dragId, set: setDragId }} over={over} setOver={setOver}
            onDrop={onDrop} onOpen={onOpen} onMove={(id, v) => doMove(id, v, columns[v].at(-1)?._id, undefined)} stages={stages} refs={data.refs} shown={shown}
          />
        ))}
      </Stack>
    </Box>
  );
}
