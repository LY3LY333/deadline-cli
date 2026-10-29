import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeIcsText, eventUid, foldLine, formatUtc, toIcs } from '../src/ics.js';

const NOW = new Date(2026, 9, 29, 18, 0, 0);

function sample(overrides = {}) {
  return {
    title: '高数作业 3',
    due: new Date(2026, 10, 2, 23, 59),
    course: '高等数学',
    type: 'homework',
    note: '第 5 章',
    doneAt: null,
    ...overrides
  };
}

function unfold(ics) {
  return ics.replace(/\r\n /g, '');
}

test('calendar envelope is valid', () => {
  const ics = toIcs([sample()], { now: NOW });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /PRODID:/);
  assert.match(ics, /CALSCALE:GREGORIAN/);
});

test('timestamps are converted to UTC', () => {
  const item = sample();
  const ics = unfold(toIcs([item], { now: NOW }));
  const expected = formatUtc(item.due);
  assert.match(ics, new RegExp(`DTSTART:${expected}`));
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
  // DTEND is 30 minutes later
  const end = new Date(item.due.getTime() + 30 * 60 * 1000);
  assert.match(ics, new RegExp(`DTEND:${formatUtc(end)}`));
});

test('every event carries two reminders', () => {
  const ics = toIcs([sample()], { now: NOW });
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /TRIGGER:-PT2H/);
});

test('done items are skipped unless asked for', () => {
  const done = sample({ doneAt: '2026-11-01 10:00' });
  assert.equal((toIcs([done], { now: NOW }).match(/BEGIN:VEVENT/g) ?? []).length, 0);
  assert.equal((toIcs([done], { now: NOW, includeDone: true }).match(/BEGIN:VEVENT/g) ?? []).length, 1);
});

test('text is escaped per RFC 5545', () => {
  assert.equal(escapeIcsText('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.equal(escapeIcsText('第一行\n第二行'), '第一行\\n第二行');

  const ics = unfold(toIcs([sample({ title: '读 A, B; 两篇' })], { now: NOW }));
  assert.match(ics, /SUMMARY:.*\\,.*\\;/);
});

test('long lines are folded at 75 octets', () => {
  const longTitle = '很长的标题'.repeat(20);
  const ics = toIcs([sample({ title: longTitle })], { now: NOW });
  const lines = ics.split('\r\n');

  for (const line of lines) {
    assert.ok(
      Buffer.byteLength(line, 'utf8') <= 75,
      `line exceeds 75 octets: ${Buffer.byteLength(line, 'utf8')} — ${line}`
    );
  }
  // continuation lines start with a space, and unfolding restores the text
  assert.ok(lines.some((line) => line.startsWith(' ')));
  assert.ok(unfold(ics).includes(longTitle));
});

test('uids are stable across runs and unique per item', () => {
  const a = eventUid(sample());
  const b = eventUid(sample());
  const c = eventUid(sample({ title: '物理作业' }));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /@deadline-cli$/);
});

test('uses CRLF line endings', () => {
  const ics = toIcs([sample()], { now: NOW });
  assert.ok(!/[^\r]\n/.test(ics));
});
