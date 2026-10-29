import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../src/cli.js';

const NOW = new Date(2026, 9, 29, 18, 0, 0);

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'ddl-'));
  const file = join(dir, 'deadlines.dd');
  const out = [];
  const err = [];
  const io = { out: (text) => out.push(text), err: (text) => err.push(text) };
  const invoke = (argv) => run([...argv, '--file', file], { now: NOW, io, isTTY: false });
  return { dir, file, out, err, invoke };
}

test('add writes a row and list shows it', () => {
  const h = harness();

  assert.equal(h.invoke(['add', '高数作业 3', '--due', '2026-11-02 23:59', '--course', '高等数学']), 0);
  assert.ok(existsSync(h.file));
  assert.match(readFileSync(h.file, 'utf8'), /高数作业 3/);

  assert.equal(h.invoke(['list']), 0);
  const listing = h.out.join('\n');
  assert.match(listing, /高数作业 3/);
  assert.match(listing, /高等数学/);
  assert.match(listing, /4 天后/);
});

test('ids refer to rows, so done/undone/rm work on the right item', () => {
  const h = harness();
  h.invoke(['add', '作业B', '--due', '2026-11-05 09:00']);
  h.invoke(['add', '作业A', '--due', '2026-11-02 09:00']);

  h.out.length = 0;
  h.invoke(['list']);
  const firstRow = h.out.join('\n').split('\n').find((line) => line.includes('作业A'));
  assert.match(firstRow, /^\s*1\s/);

  assert.equal(h.invoke(['done', '1']), 0);
  h.out.length = 0;
  h.invoke(['list']);
  assert.doesNotMatch(h.out.join('\n'), /作业A/);

  h.out.length = 0;
  h.invoke(['list', '--all']);
  const doneRow = h.out.join('\n').split('\n').find((line) => line.includes('作业A'));
  assert.match(doneRow, /已完成/);

  assert.equal(h.invoke(['undone', '1']), 0);
  h.out.length = 0;
  h.invoke(['list']);
  assert.match(h.out.join('\n'), /作业A/);

  assert.equal(h.invoke(['rm', '1']), 0);
  h.out.length = 0;
  h.invoke(['list']);
  assert.doesNotMatch(h.out.join('\n'), /作业A/);
});

test('export produces a calendar file', () => {
  const h = harness();
  h.invoke(['add', '期中考试', '--due', '2026-11-05 09:00', '--course', '线性代数', '--type', 'exam']);

  const icsPath = join(h.dir, 'out.ics');
  assert.equal(h.invoke(['export', '--out', icsPath]), 0);

  const ics = readFileSync(icsPath, 'utf8');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /期中考试/);
  assert.match(ics, /CATEGORIES:线性代数/);
  assert.match(ics, /BEGIN:VALARM/);
});

test('--json output is machine readable', () => {
  const h = harness();
  h.invoke(['add', '作业C', '--due', '2026-11-03 12:00']);
  h.out.length = 0;
  h.invoke(['list', '--json']);

  const payload = JSON.parse(h.out.join('\n'));
  assert.equal(payload.length, 1);
  assert.equal(payload[0].title, '作业C');
  assert.equal(payload[0].countdown, '5 天后');
  assert.equal(payload[0].done, false);
});

test('friendly errors and exit codes', () => {
  const h = harness();

  assert.equal(h.invoke(['add', '没写时间']), 2);
  assert.match(h.err.join('\n'), /--due/);

  assert.equal(h.invoke(['add', '时间写错', '--due', '下周']), 2);
  assert.match(h.err.join('\n'), /看不懂/);

  assert.equal(h.invoke(['rm', '99']), 2);
  assert.match(h.err.join('\n'), /没有编号/);

  assert.equal(h.invoke(['bogus']), 2);
  assert.match(h.err.join('\n'), /未知命令/);
});

test('empty list suggests the first command', () => {
  const h = harness();
  assert.equal(h.invoke(['list']), 0);
  assert.match(h.out.join('\n'), /ddl add/);
});

test('--today and --week filter the list', () => {
  const h = harness();
  h.invoke(['add', '今天的活', '--due', '今天 20:00']);
  h.invoke(['add', '下周的活', '--due', '2026-11-20 20:00']);

  h.out.length = 0;
  h.invoke(['list', '--today']);
  const today = h.out.join('\n');
  assert.match(today, /今天的活/);
  assert.doesNotMatch(today, /下周的活/);

  h.out.length = 0;
  h.invoke(['list', '--week']);
  assert.match(h.out.join('\n'), /今天的活/);
  assert.doesNotMatch(h.out.join('\n'), /下周的活/);
});
