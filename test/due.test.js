import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DueParseError,
  formatCountdown,
  formatDue,
  parseDue,
  startOfDay
} from '../src/due.js';

/** Fixed reference point: Thursday 2026-10-29 18:00 local time. */
const NOW = new Date(2026, 9, 29, 18, 0, 0);

test('ISO date with time', () => {
  const due = parseDue('2026-11-02 14:30', NOW);
  assert.equal(due.getFullYear(), 2026);
  assert.equal(due.getMonth(), 10);
  assert.equal(due.getDate(), 2);
  assert.equal(due.getHours(), 14);
  assert.equal(due.getMinutes(), 30);
});

test('date only defaults to 23:59', () => {
  const due = parseDue('2026-11-02', NOW);
  assert.equal(due.getHours(), 23);
  assert.equal(due.getMinutes(), 59);
});

test('short date uses the current year', () => {
  const due = parseDue('11-02 08:00', NOW);
  assert.equal(due.getFullYear(), 2026);
  assert.equal(due.getMonth(), 10);
  assert.equal(due.getDate(), 2);
});

test('today / 明天 / 后天', () => {
  assert.equal(formatDue(parseDue('今天 20:00', NOW)), '2026-10-29 20:00');
  assert.equal(formatDue(parseDue('明天 09:00', NOW)), '2026-10-30 09:00');
  assert.equal(formatDue(parseDue('后天', NOW)), '2026-10-31 23:59');
  assert.equal(formatDue(parseDue('tomorrow 09:00', NOW)), '2026-10-30 09:00');
});

test('relative offsets', () => {
  assert.equal(formatDue(parseDue('+3d', NOW)), '2026-11-01 18:00');
  assert.equal(formatDue(parseDue('+3d 20:00', NOW)), '2026-11-01 20:00');
  assert.equal(formatDue(parseDue('+2h', NOW)), '2026-10-29 20:00');
  assert.equal(formatDue(parseDue('+30m', NOW)), '2026-10-29 18:30');
});

test('weekday resolves to the next occurrence', () => {
  // NOW is a Thursday, so 周五 is tomorrow.
  assert.equal(formatDue(parseDue('周五 20:00', NOW)), '2026-10-30 20:00');
  // ...and 周四 means next week's Thursday, not today.
  assert.equal(formatDue(parseDue('周四 20:00', NOW)), '2026-11-05 20:00');
  assert.equal(formatDue(parseDue('sun', NOW)), '2026-11-01 23:59');
});

test('rejects nonsense instead of guessing', () => {
  assert.throws(() => parseDue('', NOW), DueParseError);
  assert.throws(() => parseDue('下周', NOW), DueParseError);
  assert.throws(() => parseDue('2026-02-30', NOW), DueParseError);
  assert.throws(() => parseDue('2026-11-02 25:00', NOW), DueParseError);
});

test('countdown wording', () => {
  const at = (h) => new Date(2026, 9, 29, h, 0, 0);
  assert.equal(formatCountdown(new Date(2026, 9, 27, 10, 0), NOW), '已逾期 2 天');
  assert.equal(formatCountdown(at(15), NOW), '已逾期 3 小时');
  assert.equal(formatCountdown(at(20), NOW), '今天 20:00');
  assert.equal(formatCountdown(new Date(2026, 9, 30, 9, 0), NOW), '明天 09:00');
  assert.equal(formatCountdown(new Date(2026, 9, 31, 9, 0), NOW), '后天 09:00');
  assert.equal(formatCountdown(new Date(2026, 10, 2, 9, 0), NOW), '4 天后');
  assert.equal(formatCountdown(new Date(2026, 11, 20, 9, 0), NOW), '2026-12-20');
});

test('startOfDay keeps the local date', () => {
  const start = startOfDay(NOW);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getDate(), 29);
});
