/**
 * Parsing and formatting of due dates.
 *
 * Supported input formats (all local time):
 *   2026-11-02 23:59   2026-11-02   11-02 23:59   11-02   11/02
 *   today 20:00  明天 09:00  后天   tomorrow 09:00
 *   +3d   +48h   +30m
 *   fri 20:00  周五 20:00  星期一
 *
 * A missing time defaults to 23:59 (end of day).
 */

export class DueParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DueParseError';
  }
}

const WEEKDAYS = new Map([
  ['sun', 0], ['sunday', 0], ['周日', 0], ['周天', 0], ['星期日', 0], ['星期天', 0],
  ['mon', 1], ['monday', 1], ['周一', 1], ['星期一', 1],
  ['tue', 2], ['tuesday', 2], ['周二', 2], ['星期二', 2],
  ['wed', 3], ['wednesday', 3], ['周三', 3], ['星期三', 3],
  ['thu', 4], ['thursday', 4], ['周四', 4], ['星期四', 4],
  ['fri', 5], ['friday', 5], ['周五', 5], ['星期五', 5],
  ['sat', 6], ['saturday', 6], ['周六', 6], ['星期六', 6]
]);

const DAY_WORDS = new Map([
  ['today', 0], ['今天', 0],
  ['tomorrow', 1], ['明天', 1],
  ['后天', 2],
  ['大后天', 3]
]);

const RELATIVE = /^\+\s*(\d+)\s*([dhm])$/i;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SHORT_DATE = /^(\d{1,2})[-/](\d{1,2})$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function splitClock(input) {
  const match = input.trim().match(/^(.*?)\s+(\d{1,2}:\d{2})$/);
  if (match) return { head: match[1].trim(), clock: match[2] };
  return { head: input.trim(), clock: null };
}

function parseClock(text) {
  const match = CLOCK.exec(text);
  if (!match) throw new DueParseError(`时间格式不对：「${text}」，应为 HH:mm`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new DueParseError(`时间超出范围：「${text}」`);
  return { hours, minutes };
}

function at(date, hours, minutes) {
  const d = new Date(date.getTime());
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function assertDay(year, month, day, raw) {
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    throw new DueParseError(`日期不存在：「${raw}」`);
  }
  return probe;
}

/**
 * @param {string} input
 * @param {Date} [now]
 * @returns {Date}
 */
export function parseDue(input, now = new Date()) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new DueParseError('到期时间不能为空');
  }

  const { head, clock } = splitClock(input);
  const time = clock ? parseClock(clock) : { hours: 23, minutes: 59 };
  const lower = head.toLowerCase();

  const relative = RELATIVE.exec(lower);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const base = new Date(now.getTime());
    if (unit === 'd') {
      // `+3d` keeps the time of day; the 23:59 default only applies to dates.
      const shifted = new Date(base.getTime() + amount * DAY_MS);
      return clock ? at(shifted, time.hours, time.minutes) : shifted;
    }
    if (unit === 'h') return new Date(base.getTime() + amount * 60 * 60 * 1000);
    return new Date(base.getTime() + amount * 60 * 1000);
  }

  if (DAY_WORDS.has(lower)) {
    const offset = DAY_WORDS.get(lower);
    return at(new Date(startOfDay(now).getTime() + offset * DAY_MS), time.hours, time.minutes);
  }

  if (WEEKDAYS.has(lower)) {
    const target = WEEKDAYS.get(lower);
    const today = startOfDay(now);
    let delta = (target - today.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // 「周五」说的永远是下一个周五
    return at(new Date(today.getTime() + delta * DAY_MS), time.hours, time.minutes);
  }

  let match = ISO_DATE.exec(head);
  if (match) {
    const [, y, m, d] = match;
    return at(assertDay(Number(y), Number(m), Number(d), head), time.hours, time.minutes);
  }

  match = SHORT_DATE.exec(head);
  if (match) {
    const [, m, d] = match;
    return at(assertDay(now.getFullYear(), Number(m), Number(d), head), time.hours, time.minutes);
  }

  throw new DueParseError(
    `看不懂这个时间：「${input}」。可用写法：2026-11-02 23:59 / 11-02 23:59 / 明天 09:00 / +3d / 周五 20:00`
  );
}

/** ISO-ish local stamp, the format stored on disk. */
export function formatDue(due) {
  return `${due.getFullYear()}-${pad2(due.getMonth() + 1)}-${pad2(due.getDate())} ${pad2(due.getHours())}:${pad2(due.getMinutes())}`;
}

/**
 * Human friendly countdown, e.g. 「已逾期 2 天」「今天 23:59」「3 天后」.
 * @param {Date} due
 * @param {Date} [now]
 */
export function formatCountdown(due, now = new Date()) {
  const diff = due.getTime() - now.getTime();

  if (diff < 0) {
    const overdue = -diff;
    const days = Math.floor(overdue / DAY_MS);
    if (days >= 1) return `已逾期 ${days} 天`;
    const hours = Math.floor(overdue / (60 * 60 * 1000));
    if (hours >= 1) return `已逾期 ${hours} 小时`;
    return '已逾期';
  }

  const dayDiff = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS);
  const clock = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;

  if (dayDiff === 0) return `今天 ${clock}`;
  if (dayDiff === 1) return `明天 ${clock}`;
  if (dayDiff === 2) return `后天 ${clock}`;
  if (dayDiff <= 14) return `${dayDiff} 天后`;
  return formatDue(due).slice(0, 10);
}

/** Whole days between two instants (negative when `to` is in the past). */
export function daysBetween(from, to) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}
