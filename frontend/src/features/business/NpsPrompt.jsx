import { useState } from 'react';
import { Box, Button, Card, Collapse, IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useDispatch } from 'react-redux';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { errorMessage } from '../../services/api';
import { showToast } from '../ui/uiSlice';
import { useDismissNpsMutation, useNpsEligibilityQuery, useSubmitNpsMutation } from './businessApi';

// A small, easy-to-ignore survey card. It appears only for people who have been around a while and have not been asked lately.
export default function NpsPrompt() {
  const dispatch = useDispatch();
  const { data } = useNpsEligibilityQuery();
  const [submit, { isLoading }] = useSubmitNpsMutation();
  const [dismiss] = useDismissNpsMutation();
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [thanked, setThanked] = useState(false);

  const send = async () => {
    try { await submit({ score, ...(comment.trim() ? { comment: comment.trim() } : {}) }).unwrap(); setThanked(true); } catch (err) { dispatch(showToast(errorMessage(err), 'error')); }
  };
  return (
    <Collapse in={!!data?.eligible || thanked} unmountOnExit>
      <Card elevation={8} role="complementary" aria-label="Quick survey" sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1300, p: 2.5, width: { xs: 'calc(100% - 32px)', sm: 420 } }}>
        {thanked ? (
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}><Typography>Thank you for your feedback!</Typography><IconButton size="small" aria-label="Close" onClick={() => setThanked(false)}><CloseIcon fontSize="small" /></IconButton></Stack>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Typography fontWeight={600}>How likely are you to recommend this to a colleague?</Typography>
              <IconButton size="small" aria-label="Not now" onClick={() => dismiss()}><CloseIcon fontSize="small" /></IconButton>
            </Stack>
            <ToggleButtonGroup exclusive size="small" value={score} onChange={(_e, v) => v !== null && setScore(v)} aria-label="Score from 0 to 10" sx={{ flexWrap: 'wrap' }}>
              {Array.from({ length: 11 }, (_, i) => <ToggleButton key={i} value={i} sx={{ minWidth: 32, px: 0 }} aria-label={`${i}`}>{i}</ToggleButton>)}
            </ToggleButtonGroup>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="caption" color="text.secondary">Not likely</Typography><Typography variant="caption" color="text.secondary">Very likely</Typography></Stack>
            {score !== null && (
              <Box>
                <TextField fullWidth size="small" multiline minRows={2} label="Anything we could do better? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <Stack direction="row" spacing={1} sx={{ mt: 1.5, justifyContent: 'flex-end' }}><Button color="inherit" size="small" onClick={() => dismiss()}>Not now</Button><Button variant="contained" size="small" disabled={isLoading} onClick={send}>Send</Button></Stack>
              </Box>
            )}
          </Stack>
        )}
      </Card>
    </Collapse>
  );
}
