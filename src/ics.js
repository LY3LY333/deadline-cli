/**
 * iCalendar (RFC 5545) serialisation.
 *
 * We deliberately emit UTC timestamps (`20261102T155900Z`) instead of local
 * times with a TZID: that keeps the file valid without shipping a VTIMEZONE
 * component, and every calendar app understands it.
 */

import { createHash } from 'node:crypto';

const CRLF = '\r\n';
const PRODID = '-//deadline-cli//deadline-cli 0.1.0//EN';

export function formatUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets (UTF-8), continuation lines start with a
 * single space — required by RFC 5545 section 3.1.
 */
export function foldLine(line, limit = 75) {
  if (Buffer.byteLength(line, 'utf8') <= limit) return line;

  const parts = [];
  let current = '';
  let bytes = 0;

  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > limit) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

export function eventUid(item) {
  const seed = `${item.title}|${item.due.toISOString()}`;
  return `${createHash('sha1').update(seed).digest('hex').slice(0, 16)}@deadline-cli`;
}

const KIND_LABEL = {
  homework: '作业',
  exam: '考试',
  project: '项目',
  other: '其他'
};

function summaryOf(item) {
  const kind = KIND_LABEL[item.type];
  const course = item.course ? `[${item.course}] ` : '';
  return `${course}${item.title}${kind ? `（${kind}）` : ''}`;
}

function descriptionOf(item) {
  const lines = [];
  if (item.course) lines.push(`课程：${item.course}`);
  if (item.type) lines.push(`类型：${KIND_LABEL[item.type] ?? item.type}`);
  if (item.note) lines.push(`备注：${item.note}`);
  return lines.join('\n');
}

/**
 * @param {Array<{title: string, due: Date, course?: string, type?: string, note?: string, doneAt?: string|null}>} items
 * @param {{now?: Date, prodId?: string, includeDone?: boolean}} [options]
 * @returns {string} iCalendar document, CRLF terminated
 */
export function toIcs(items, options = {}) {
  const { now = new Date(), prodId = PRODID, includeDone = false } = options;
  const stamp = formatUtc(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN'
  ];

  for (const item of items) {
    if (!includeDone && item.doneAt) continue;

    const start = item.due;
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${eventUid(item)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatUtc(start)}`);
    lines.push(`DTEND:${formatUtc(end)}`);
    lines.push(`SUMMARY:${escapeIcsText(summaryOf(item))}`);

    const description = descriptionOf(item);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    if (item.course) lines.push(`CATEGORIES:${escapeIcsText(item.course)}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:TRANSPARENT');

    // Reminder one day before, and two hours before.
    lines.push('BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`明天截止：${item.title}`)}`, 'END:VALARM');
    lines.push('BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`2 小时后截止：${item.title}`)}`, 'END:VALARM');

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map((line) => foldLine(line)).join(CRLF) + CRLF;
}
