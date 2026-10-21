import { z } from 'zod';

// Recurring schedules: hourly, daily, weekly or monthly, evaluated in the workflow's own IANA time zone
// (so "daily at 09:00 America/New_York" stays at 9 o'clock local time across daylight-saving changes).

export const scheduleSchema = z.object({
  frequency: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:30').default('09:00'),
  dayOfWeek: z.number().int().min(0).max(6).default(1), // 0 = Sunday
  dayOfMonth: z.number().int().min(1).max(28).default(1), // capped at 28 so every month has the day
  timezone: z.string().max(60).default('UTC').refine(isValidZone, 'Unknown time zone'),
});

export function isValidZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Offset (ms) of the zone from UTC at a given instant.
function offsetAt(utcMs, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(utcMs / 1000) * 1000;
}

// Local wall-clock time in a zone -> UTC instant. A time skipped by a spring-forward change maps to just after the gap.
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  // If that instant does not read back as the requested wall time, the time falls in a spring-forward gap: use the later reading.
  return second + offsetAt(second, tz) === guess ? second : first;
}

function localParts(utcMs, tz) {
  const o = offsetAt(utcMs, tz);
  const d = new Date(utcMs + o);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() };
}

// The first run strictly after `from`.
export function nextRun(schedule, from = new Date()) {
  const s = scheduleSchema.parse(schedule);
  const [hh, mm] = s.time.split(':').map(Number);
  const after = from.getTime();

  if (s.frequency === 'hourly') {
    const next = new Date(after);
    next.setUTCMinutes(mm, 0, 0);
    if (next.getTime() <= after) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  const base = localParts(after, s.timezone);
  for (let i = 0; i <= 62; i++) {
    const day = new Date(Date.UTC(base.y, base.mo - 1, base.d + i));
    const y = day.getUTCFullYear(); const mo = day.getUTCMonth() + 1; const d = day.getUTCDate();
    if (s.frequency === 'weekly' && day.getUTCDay() !== s.dayOfWeek) continue;
    if (s.frequency === 'monthly' && d !== s.dayOfMonth) continue;
    const at = zonedToUtc(y, mo, d, hh, mm, s.timezone);
    if (at > after) return new Date(at);
  }
  throw new Error('Could not compute the next run');
}
