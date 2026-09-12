/**
 * Smart send-time helpers: shift a send into the recipient's local
 * 8:00–11:00 AM window using IANA timezones (DST-safe via Intl).
 */

const STATE_TZ: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',
  ID: 'America/Denver',
  IL: 'America/Chicago',
  IN: 'America/New_York',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  MT: 'America/Denver',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  NE: 'America/Chicago',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NV: 'America/Los_Angeles',
  NY: 'America/New_York',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WA: 'America/Los_Angeles',
  WI: 'America/Chicago',
  WV: 'America/New_York',
  WY: 'America/Denver',
};

export function stateTimeZone(state?: string | null): string {
  return STATE_TZ[(state ?? '').trim().toUpperCase()] ?? 'America/Chicago';
}

function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const part = dtf
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = (part ?? '').match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function localDateParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = dtf.format(date).split('-').map(Number);
  return { y, m, d };
}

function localWallClockToUtc(
  y: number,
  m: number,
  d: number,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, Math.floor(hours), minutes));
  let offset = tzOffsetMinutes(guess, timeZone);
  let utc = new Date(guess.getTime() - offset * 60000);
  // DST boundary safety: re-derive offset at the target instant
  const verify = tzOffsetMinutes(utc, timeZone);
  if (verify !== offset) {
    offset = verify;
    utc = new Date(guess.getTime() - offset * 60000);
  }
  return utc;
}

/**
 * Shifts `base` into the local 8:00–11:00 AM window of `timeZone`.
 * `fraction` (0..1) positions the send within the 3h window.
 * If the slot has already passed today, the next day is used.
 */
export function shiftToLocalMorning(
  base: Date,
  timeZone: string,
  fraction = 0,
): Date {
  const clamped = Math.min(1, Math.max(0, fraction));
  const minutesPastEight = Math.round(clamped * 180);

  const today = localDateParts(base, timeZone);
  const target = localWallClockToUtc(
    today.y,
    today.m,
    today.d,
    8,
    minutesPastEight,
    timeZone,
  );
  if (target.getTime() > base.getTime()) return target;

  const tomorrow = new Date(base.getTime() + 24 * 3600 * 1000);
  const next = localDateParts(tomorrow, timeZone);
  return localWallClockToUtc(
    next.y,
    next.m,
    next.d,
    8,
    minutesPastEight,
    timeZone,
  );
}
