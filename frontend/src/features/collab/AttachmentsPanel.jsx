import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, IconButton, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import dayjs from 'dayjs';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import FileIcon from '@mui/icons-material/InsertDriveFileOutlined';
import UploadIcon from '@mui/icons-material/CloudUploadOutlined';
import { store } from '../../app/store';
import { ConfirmDialog, EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { downloadFile, fetchAuthed } from '../../services/download';
import { showToast } from '../ui/uiSlice';
import { useDeleteAttachmentMutation, useListAttachmentsQuery, useUploadAttachmentMutation } from './collabApi';

const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// Thumbnails need the bearer token, so images are fetched with it and shown from a temporary object URL.
function Thumb({ attachment }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!attachment.previewable) return undefined;
    let revoked = false; let objectUrl;
    fetchAuthed(store, `/attachments/${attachment._id}/download?inline=1`, { method: 'GET' })
      .then((r) => r.blob()).then((b) => { if (!revoked) { objectUrl = URL.createObjectURL(b); setUrl(objectUrl); } }).catch(() => {});
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment._id, attachment.previewable]);
  if (url) return <Box component="img" src={url} alt={attachment.filename} sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider' }} />;
  return <Avatar variant="rounded" sx={{ width: 48, height: 48, bgcolor: 'action.hover', color: 'text.secondary' }}><FileIcon /></Avatar>;
}

export default function AttachmentsPanel({ dataformId, recordId, canWrite, canModerate, meId }) {
  const dispatch = useDispatch();
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const { data, isLoading, error, refetch } = useListAttachmentsQuery({ dataformId, recordId });
  const [upload, uploadState] = useUploadAttachmentMutation();
  const [remove, removeState] = useDeleteAttachmentMutation();
  const files = data?.data ?? [];
  const max = data?.maxUploadMb ?? 25;

  const send = async (list) => {
    for (const file of Array.from(list)) {
      if (file.size > max * 1048576) { dispatch(showToast(`${file.name} is larger than your ${max} MB limit`, 'error')); continue; }
      try { await upload({ dataformId, recordId, file }).unwrap(); dispatch(showToast(`${file.name} uploaded`)); } catch (err) { dispatch(showToast(errorMessage(err, `Could not upload ${file.name}`), 'error')); }
    }
  };
  const get = (a) => downloadFile(store, `/attachments/${a._id}/download`, undefined, a.filename, 'GET').catch((err) => dispatch(showToast(err.message, 'error')));

  if (error) return <ErrorState message={errorMessage(error, 'Could not load files')} onRetry={refetch} />;
  return (
    <Stack spacing={2}>
      {canWrite && (
        <Box
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}
          sx={{ border: 2, borderStyle: 'dashed', borderColor: drag ? 'primary.main' : 'divider', borderRadius: 2, p: 2.5, textAlign: 'center', bgcolor: drag ? 'action.hover' : 'transparent', transition: 'all 120ms' }}
        >
          <UploadIcon color="disabled" />
          <Typography variant="body2" sx={{ mb: 1 }}>Drag files here, or</Typography>
          <Button variant="outlined" size="small" disabled={uploadState.isLoading} onClick={() => input.current.click()}>{uploadState.isLoading ? 'Uploading…' : 'Choose files'}</Button>
          <input ref={input} type="file" multiple hidden aria-label="Upload files" onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Up to {max} MB per file</Typography>
        </Box>
      )}
      {files.length > 1 && (
        <Button size="small" startIcon={<DownloadIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => downloadFile(store, `/dataforms/${dataformId}/records/${recordId}/attachments/zip`, {}, 'attachments.zip').catch((err) => dispatch(showToast(err.message, 'error')))}>Download all (ZIP)</Button>
      )}
      {isLoading ? <Skeleton variant="rounded" height={100} />
        : files.length === 0 ? <EmptyState icon={<FileIcon />} title="No files yet" description={canWrite ? 'Attach contracts, images and documents to this record.' : undefined} />
          : files.map((a) => (
            <Stack key={a._id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Thumb attachment={a} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap title={a.filename}>{a.filename}</Typography>
                <Typography variant="caption" color="text.secondary">{size(a.size)} · {a.uploader?.name} · {dayjs(a.createdAt).format('MMM D, YYYY')}</Typography>
                {a.description && <Typography variant="caption" sx={{ display: 'block' }}>{a.description}</Typography>}
              </Box>
              <Tooltip title="Download"><IconButton aria-label={`Download ${a.filename}`} onClick={() => get(a)}><DownloadIcon /></IconButton></Tooltip>
              {canWrite && (String(a.uploader?._id) === meId || canModerate) && <Tooltip title="Delete"><IconButton aria-label={`Delete ${a.filename}`} color="error" onClick={() => setToDelete(a)}><DeleteIcon /></IconButton></Tooltip>}
            </Stack>
          ))}
      <ConfirmDialog
        open={!!toDelete} destructive loading={removeState.isLoading} title={`Delete “${toDelete?.filename}”?`} confirmLabel="Delete file" message="The file is permanently removed."
        onClose={() => setToDelete(null)}
        onConfirm={async () => { try { await remove(toDelete._id).unwrap(); dispatch(showToast('File deleted')); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); } setToDelete(null); }}
      />
    </Stack>
  );
}
