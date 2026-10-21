import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, Chip, IconButton, MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import ArrowBack from '@mui/icons-material/ArrowBackRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import EditIcon from '@mui/icons-material/EditOutlined';
import UpIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { TYPE_LABELS } from '../records/fieldUtils';
import FieldDialog from './FieldDialog';
import {
  useCloneDataformMutation, useDeleteDataformMutation, useDeleteFieldMutation, useGetDataformQuery, useListDataformsQuery,
  useReorderFieldsMutation, useUpdateDataformMutation,
} from './dataformsApi';

export default function DataformSettingsPage() {
  const { workspaceId, dataformId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useGetDataformQuery(dataformId);
  const { data: siblings = [] } = useListDataformsQuery({ workspaceId, includeArchived: false });
  const [updateDataform, updateState] = useUpdateDataformMutation();
  const [cloneDataform] = useCloneDataformMutation();
  const [deleteDataform, deleteState] = useDeleteDataformMutation();
  const [deleteField] = useDeleteFieldMutation();
  const [reorder] = useReorderFieldsMutation();
  const [fieldDialog, setFieldDialog] = useState({ open: false, field: null });
  const [toDeleteField, setToDeleteField] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm({ defaultValues: { name: '', description: '', category: '', primaryField: '' } });
  const dataform = data?.dataform;

  useEffect(() => {
    if (dataform) reset({ name: dataform.name, description: dataform.description, category: dataform.category, primaryField: dataform.primaryField ?? '' });
  }, [dataform, reset]);

  if (isLoading) return <Skeleton variant="rounded" height={300} />;
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  if (data.access !== 'admin') return <EmptyState title="Admin access required" description="Only workspace admins can change a dataform's structure." action={<Button component={RouterLink} to={`/w/${workspaceId}/f/${dataformId}`}>Back to records</Button>} />;

  const { fields } = data;
  const guard = async (fn, ok) => {
    try { await fn().unwrap(); if (ok) dispatch(showToast(ok)); return true; } catch (err) { dispatch(showToast(errorMessage(err), 'error')); return false; }
  };
  const move = (i, dir) => {
    const ids = fields.map((f) => f._id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    guard(() => reorder({ dataformId, ids }));
  };
  const textFields = fields.filter((f) => ['text', 'email'].includes(f.type));

  return (
    <PageTransition>
      <PageHeader
        title={`${dataform.name} settings`} description="Configure the dataform and its fields."
        actions={<Button component={RouterLink} to={`/w/${workspaceId}/f/${dataformId}`} startIcon={<ArrowBack />} color="inherit">Back to records</Button>}
      />
      <Stack spacing={3}>
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>General</Typography>
          <Stack component="form" spacing={2} sx={{ maxWidth: 560 }} onSubmit={handleSubmit((values) => guard(() => updateDataform({ id: dataformId, ...values, primaryField: values.primaryField || undefined }), 'Dataform saved'))} noValidate>
            <TextField label="Name" {...register('name', { required: 'Enter a name', minLength: { value: 2, message: 'At least 2 characters' } })} error={!!errors.name} helperText={errors.name?.message} />
            <TextField label="Description" multiline minRows={2} {...register('description')} />
            <TextField label="Category" {...register('category')} helperText="Used to group dataforms in the sidebar and workspace home" />
            <TextField select label="Display field" defaultValue={dataform.primaryField ?? ''} {...register('primaryField')} helperText="Shown as the record's name in pickers and titles">
              {textFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
            <Button type="submit" variant="contained" disabled={!isDirty || updateState.isLoading} sx={{ alignSelf: 'flex-start' }}>Save changes</Button>
          </Stack>
        </Card>

        <Card>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", p: 3, pb: 2 }}>
            <Box><Typography variant="h6">Fields</Typography><Typography variant="body2" color="text.secondary">The order here is the order in forms and tables.</Typography></Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFieldDialog({ open: true, field: null })}>Add field</Button>
          </Stack>
          {fields.length === 0 ? <EmptyState title="No fields yet" description="Add fields to define what each record stores." /> : (
            <TableContainer>
              <Table size="small" sx={{ '& td, & th': { py: 1 } }}>
                <TableHead><TableRow><TableCell width={90}>Order</TableCell><TableCell>Label</TableCell><TableCell>Key</TableCell><TableCell>Type</TableCell><TableCell>Rules</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
                <TableBody>
                  {fields.map((f, i) => (
                    <TableRow key={f._id} hover>
                      <TableCell>
                        <IconButton size="small" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><UpIcon fontSize="small" /></IconButton>
                        <IconButton size="small" aria-label={`Move ${f.label} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}><DownIcon fontSize="small" /></IconButton>
                      </TableCell>
                      <TableCell><Typography fontWeight={500}>{f.label}</Typography><Typography variant="caption" color="text.secondary">{f.section}</Typography></TableCell>
                      <TableCell><code>{f.key}</code></TableCell>
                      <TableCell>{TYPE_LABELS[f.type]}</TableCell>
                      <TableCell><Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                        {f.required && <Chip size="small" label="required" />}{f.unique && <Chip size="small" label="unique" />}{f.readOnly && <Chip size="small" label="read-only" />}
                        {!f.visibility.list && <Chip size="small" variant="outlined" label="hidden in table" />}
                        {dataform.primaryField === f.key && <Chip size="small" color="primary" label="display" />}
                      </Stack></TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${f.label}`} onClick={() => setFieldDialog({ open: true, field: f })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" color="error" aria-label={`Delete ${f.label}`} onClick={() => setToDeleteField(f)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>

        <Card sx={{ p: 3, borderColor: 'error.main' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Manage</Typography>
          {dataform.status === 'archived' && <Alert severity="info" sx={{ mb: 2 }}>This dataform is archived and read-only.</Alert>}
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button variant="outlined" color="inherit" onClick={async () => { if (await guard(() => cloneDataform(dataformId), 'Dataform cloned (fields only)')) navigate(`/w/${workspaceId}`); }}>Clone structure</Button>
            <Button variant="outlined" color="inherit" onClick={() => guard(() => updateDataform({ id: dataformId, status: dataform.status === 'archived' ? 'active' : 'archived' }), dataform.status === 'archived' ? 'Dataform restored' : 'Dataform archived')}>
              {dataform.status === 'archived' ? 'Restore' : 'Archive'}
            </Button>
            <Button variant="outlined" color="error" onClick={() => setConfirmDelete(true)}>Delete dataform</Button>
          </Stack>
        </Card>
      </Stack>

      {fieldDialog.open && <FieldDialog open dataformId={dataformId} field={fieldDialog.field} dataforms={siblings.filter((d) => d._id !== dataformId || fieldDialog.field?.type === 'relationship')} onClose={() => setFieldDialog({ open: false, field: null })} />}
      <ConfirmDialog
        open={!!toDeleteField} destructive title={`Delete “${toDeleteField?.label}”?`} confirmLabel="Delete field" onClose={() => setToDeleteField(null)}
        message="The field and all values stored in it are removed from every record. This cannot be undone."
        onConfirm={async () => { await guard(() => deleteField({ dataformId, fieldId: toDeleteField._id }), 'Field deleted'); setToDeleteField(null); }}
      />
      <ConfirmDialog
        open={confirmDelete} destructive loading={deleteState.isLoading} title={`Delete “${dataform.name}”?`} confirmLabel="Delete dataform" onClose={() => setConfirmDelete(false)}
        message="All records, fields and history in this dataform are permanently deleted."
        onConfirm={async () => { if (await guard(() => deleteDataform(dataformId), 'Dataform deleted')) navigate(`/w/${workspaceId}`); setConfirmDelete(false); }}
      />
    </PageTransition>
  );
}
