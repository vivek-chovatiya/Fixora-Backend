/**
 * India wall-clock time, for the two things that are stated in it: a customer's preferred date
 * and time, and a vendor report's today / this week / this month (Phase 4B contract §3, §5).
 *
 * Why it exists: the app sends a preferred date and time as the customer read them on the
 * calendar — no time zone — and asks for "today" without saying when today starts. Both are
 * India's, decided here, once, so a late-evening job is counted in the same day the customer and
 * the vendor think it happened in, whatever the server's own clock zone is.
 *
 * The decision that shaped it: Asia/Kolkata is a fixed UTC+05:30 with no daylight saving, so the
 * conversions are plain arithmetic on the offset rather than a time-zone library.
 *
 * ⚠️ Never use the server's local-time getters (getHours, getDate, setHours …) here or in callers:
 * they read the zone the machine happens to run in. Shift by the offset and read the UTC getters.
 */

const TIME_ZONE = 'Asia/Kolkata';
const OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (value) => String(value).padStart(2, '0');

/** True for a real calendar date written YYYY-MM-DD ('2026-02-30' is not one). */
const isCalendarDate = (value) => {
  const match = DATE_PATTERN.exec(String(value));
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/** True for a 24-hour, zero-padded HH:mm ('09:00' yes, '9:00' and '24:00' no). */
const isWallClockTime = (value) => TIME_PATTERN.test(String(value));

/** The instant of an India date (YYYY-MM-DD) at an India time (HH:mm, default midnight). */
const indiaInstant = (date, time = '00:00') => new Date(`${date}T${time}:00+05:30`);

/** An instant as India reads it: { date: 'YYYY-MM-DD', time: 'HH:mm' } (seconds dropped). */
const indiaWallClock = (instant) => {
  const shifted = new Date(new Date(instant).getTime() + OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
};

/**
 * The India-time window [from, to) holding `now`: 'today' from midnight, 'week' from midnight on
 * Monday, 'month' from midnight on the 1st; `to` is where the next one starts.
 */
const periodWindow = (period, now) => {
  const shifted = new Date(new Date(now).getTime() + OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const midnight = Date.UTC(year, month, day) - OFFSET_MS;

  if (period === 'today') {
    return { from: new Date(midnight), to: new Date(midnight + DAY_MS) };
  }
  if (period === 'week') {
    const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
    const monday = midnight - daysSinceMonday * DAY_MS;
    return { from: new Date(monday), to: new Date(monday + 7 * DAY_MS) };
  }
  if (period === 'month') {
    return {
      from: new Date(Date.UTC(year, month, 1) - OFFSET_MS),
      to: new Date(Date.UTC(year, month + 1, 1) - OFFSET_MS),
    };
  }
  throw new Error(`Unknown report period: ${period}`);
};

module.exports = {
  TIME_ZONE,
  isCalendarDate,
  isWallClockTime,
  indiaInstant,
  indiaWallClock,
  periodWindow,
};
