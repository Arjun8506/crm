import { Button, Card, Chip, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import AddIcon from '@mui/icons-material/AddRounded';
import AnalyticsIcon from '@mui/icons-material/QueryStatsRounded';
import ReportIcon from '@mui/icons-material/DescriptionOutlined';
import { EmptyState, ErrorState, PageHeader, PageTransition } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useListReportsQuery } from './analyticsApi';

export default function ReportsPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { data = [], isLoading, error, refetch } = useListReportsQuery(workspaceId);
  const actions = (
    <>
      <Button variant="outlined" startIcon={<AnalyticsIcon />} onClick={() => navigate(`/w/${workspaceId}/reports/new/analyzer`)}>New analysis</Button>
      <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`/w/${workspaceId}/reports/new/list`)}>New report</Button>
    </>
  );
  return (
    <PageTransition>
      <PageHeader title="Reports & analysis" description="Saved lists and grouped tables (pivot-style) built on your dataforms." actions={actions} />
      {error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : (
        <Card>
          {isLoading ? <Skeleton variant="rounded" height={180} /> : data.length === 0 ? (
            <EmptyState icon={<ReportIcon />} title="No reports yet" description="Build a report to save a filtered, sorted list, or an analysis to group and total your records." action={actions} />
          ) : (
            <TableContainer>
              <Table size="small" sx={{ '& td, & th': { py: 1.25 } }}>
                <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Type</TableCell><TableCell>Dataform</TableCell><TableCell>Owner</TableCell><TableCell>Access</TableCell></TableRow></TableHead>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r._id} hover sx={{ cursor: 'pointer' }} tabIndex={0} onClick={() => navigate(`/w/${workspaceId}/reports/${r._id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/w/${workspaceId}/reports/${r._id}`)}>
                      <TableCell><Typography fontWeight={500}>{r.name}</Typography>{r.description && <Typography variant="caption" color="text.secondary">{r.description}</Typography>}</TableCell>
                      <TableCell><Chip size="small" label={r.kind === 'list' ? 'List' : 'Analysis'} /></TableCell>
                      <TableCell>{r.dataform?.name}</TableCell>
                      <TableCell>{r.owner?.name}</TableCell>
                      <TableCell><Stack direction="row"><Chip size="small" variant="outlined" label={r.shared ? 'Shared' : 'Private'} /></Stack></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}
    </PageTransition>
  );
}
