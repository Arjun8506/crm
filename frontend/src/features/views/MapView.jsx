import { useEffect, useMemo } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import PlaceIcon from '@mui/icons-material/PlaceOutlined';
import { EmptyState, ErrorState } from '../../components/common';
import { errorMessage } from '../../services/api';
import { useQueryRecordsQuery } from '../records/recordsApi';

const LIMIT = 200;

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 8);
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 10 });
  }, [map, points]);
  return null;
}

export default function MapView({ dataform, fields, query, config, onConfig, onOpen }) {
  const theme = useTheme();
  const locFields = fields.filter((f) => f.type === 'location');
  const loc = locFields.find((f) => f.key === config.locationField) ?? locFields[0];
  const hasValue = loc && { field: loc.key, operator: 'notEmpty' };
  const filter = hasValue ? { op: 'and', conditions: [hasValue, ...(query.filter ? [query.filter] : [])] } : undefined;
  const { data, error, refetch } = useQueryRecordsQuery({ dataformId: dataform._id, page: 1, limit: LIMIT, q: query.q || undefined, filter, sort: 'updatedAt:desc' }, { skip: !loc });

  const markers = (loc ? data?.data ?? [] : []).filter((r) => r.data?.[loc.key]).map((r) => ({ id: r._id, label: r._label, pos: [r.data[loc.key].lat, r.data[loc.key].lng] }));
  // FitBounds re-fits only when the set of plotted records changes, not on every render.
  const pointsKey = markers.map((m) => m.id).join(',');
  const points = useMemo(() => markers.map((m) => m.pos), [pointsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loc) return <EmptyState icon={<PlaceIcon />} title="No location field" description="The map plots records that have a location field (latitude and longitude). Add a Location field in the dataform settings. Location fields depend on your plan." />;
  if (error) return <Box sx={{ p: 2 }}><ErrorState message={errorMessage(error, 'Could not load the map')} onRetry={refetch} /></Box>;

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {locFields.length > 1 && (
          <TextField select size="small" label="Location field" value={loc.key} onChange={(e) => onConfig({ locationField: e.target.value })} sx={{ minWidth: 200 }}>
            {locFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
          </TextField>
        )}
        <Typography variant="body2" color="text.secondary">{markers.length} record{markers.length === 1 ? '' : 's'} on the map</Typography>
        {data && data.total > LIMIT && <Alert severity="info" sx={{ py: 0 }}>Showing the first {LIMIT} of {data.total}.</Alert>}
      </Stack>
      <Box sx={{ height: 'calc(100vh - 380px)', minHeight: 360, borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
        <MapContainer center={[20, 0]} zoom={2} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={points} />
          {markers.map((m) => (
            <CircleMarker key={m.id} center={m.pos} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: theme.palette.primary.main, fillOpacity: 0.95 }}>
              <Popup>
                <Typography fontWeight={600} sx={{ color: '#111' }}>{m.label}</Typography>
                <Button size="small" onClick={() => onOpen(m.id)}>Open record</Button>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </Box>
    </Box>
  );
}
