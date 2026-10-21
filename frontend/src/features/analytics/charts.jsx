import { Box, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatGroupKey } from './AnalyzerPanel';

// Validated categorical palette (fixed order, never cycled). Dark values are the same hues stepped for the dark surface.
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const formatMetric = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// Server response -> chart points. Dropdown groups follow the option order, dates follow time, others by size.
export function toPoints(result, fields) {
  const group = result.groups[0];
  const meta = fields.find((f) => f.key === group.field);
  let rows = result.rows.map((r) => ({ name: formatGroupKey(group, r.keys[0], result.refs, fields), key: r.keys[0], value: r.metrics.m0 ?? 0 }));
  if (meta?.type === 'dropdown') {
    const order = meta.options.map((o) => o.value);
    rows = rows.sort((a, b) => (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key)));
  } else if (!group.interval) rows = rows.sort((a, b) => b.value - a.value);
  return rows;
}

function ChartTooltip({ active, payload, label, metricName }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1.5, px: 1.5, py: 1, boxShadow: 3 }}>
      <Typography variant="caption" color="text.secondary">{label ?? p.payload.name}</Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: p.color || p.payload.fill }} />
        <Typography variant="body2" fontWeight={600}>{formatMetric(p.value)}</Typography>
        <Typography variant="caption" color="text.secondary">{metricName}</Typography>
      </Stack>
    </Box>
  );
}

export function ChartWidget({ result, fields, height }) {
  const theme = useTheme();
  const colors = SERIES[theme.palette.mode];
  const points = toPoints(result, fields);
  const metricName = result.metrics[0].op === 'count' ? 'Records' : `${result.metrics[0].op} of ${fields.find((f) => f.key === result.metrics[0].field)?.label ?? ''}`;
  const axis = { stroke: theme.palette.text.secondary, fontSize: 12, tickLine: false };
  const summary = points.map((p) => `${p.name}: ${formatMetric(p.value)}`).join('; ');

  if (points.length === 0) return <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No data</Typography>;

  if (result.chart === 'pie') {
    // Eight categorical slots max; the rest folds into "Other" (neutral) rather than inventing hues.
    const top = points.slice(0, 8);
    const other = points.slice(8).reduce((n, p) => n + p.value, 0);
    const slices = other ? [...top, { name: 'Other', value: other }] : top;
    const total = slices.reduce((n, s) => n + s.value, 0) || 1;
    const colorOf = (i) => (slices[i].name === 'Other' && i === 8 ? theme.palette.text.disabled : colors[i]);
    return (
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', height }} role="img" aria-label={`Pie chart. ${summary}`}>
        <Box sx={{ width: '50%', height: '100%' }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={2} stroke={theme.palette.background.paper} strokeWidth={2} isAnimationActive={false}>
                {slices.map((s, i) => <Cell key={s.name} fill={colorOf(i)} />)}
              </Pie>
              <Tooltip content={<ChartTooltip metricName={metricName} />} />
            </PieChart>
          </ResponsiveContainer>
        </Box>
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          {slices.map((s, i) => (
            <Stack key={s.name} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: colorOf(i), flexShrink: 0 }} />
              <Typography variant="body2" noWrap sx={{ flex: 1 }}>{s.name}</Typography>
              <Typography variant="body2" color="text.secondary">{Math.round((s.value / total) * 100)}%</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    );
  }

  const common = { data: points, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const grid = <CartesianGrid vertical={false} stroke={theme.palette.divider} strokeDasharray="3 3" />;
  const yAxis = <YAxis {...axis} axisLine={false} width={44} tickFormatter={(v) => compact.format(v)} />;
  const xAxis = <XAxis dataKey="name" {...axis} axisLine={{ stroke: theme.palette.divider }} interval="preserveStartEnd" />;

  return (
    <Box sx={{ height }} role="img" aria-label={`${result.chart === 'line' ? 'Line' : 'Bar'} chart. ${summary}`}>
      <ResponsiveContainer>
        {result.chart === 'line' ? (
          <LineChart {...common}>
            {grid}{xAxis}{yAxis}
            <Tooltip content={<ChartTooltip metricName={metricName} />} cursor={{ stroke: theme.palette.divider }} />
            <Line type="linear" dataKey="value" stroke={colors[0]} strokeWidth={2} dot={{ r: 4, fill: colors[0], stroke: theme.palette.background.paper, strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        ) : (
          <BarChart {...common}>
            {grid}{xAxis}{yAxis}
            <Tooltip content={<ChartTooltip metricName={metricName} />} cursor={{ fill: theme.palette.action.hover }} />
            <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </Box>
  );
}
