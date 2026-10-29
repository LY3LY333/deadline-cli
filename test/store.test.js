import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  StoreError,
  HEADER,
  assignIds,
  parseData,
  parseLine,
  serialize,
  serializeItem,
  sortByDue,
  splitFields
} from '../src/store.js';

const SAMPLE = `${HEADER}2026-11-02 23:59 | 高数作业 3 | 高等数学 | homework | 第 5 章 |
2026-11-05 09:00 | 期中考试 | 线性代数 | exam |
`;

test('parses the sample file and skips comments', () => {
  const items = parseData(SAMPLE);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 1);
  assert.equal(items[0].title, '高数作业 3');
  assert.equal(items[0].course, '高等数学');
  assert.equal(items[0].type, 'homework');
  assert.equal(items[0].note, '第 5 章');
  assert.equal(items[0].doneAt, null);
  assert.equal(items[1].type, 'exam');
});

test('unknown types fall back to other', () => {
  const item = parseLine('2026-11-02 23:59 | 交作业 | 物理 | 随便写的 |');
  assert.equal(item.type, 'other');
});

test('pipes inside a field are escaped and restored', () => {
  const item = {
    due: new Date(2026, 10, 2, 23, 59),
    title: '读 A | B 两篇论文',
    course: 'C\\D',
    type: 'other',
    note: 'a|b',
    doneAt: null
  };

  const line = serializeItem(item);
  assert.match(line, /\\\|/);

  const back = parseLine(line);
  assert.equal(back.title, '读 A | B 两篇论文');
  assert.equal(back.note, 'a|b');
  assert.equal(back.course, 'C\\D');
});

test('splitFields keeps empty trailing fields', () => {
  assert.deepEqual(splitFields('a | b |'), ['a', 'b', '']);
});

test('serialize + parseData round trip', () => {
  const items = parseData(SAMPLE);
  const again = parseData(serialize(items));
  assert.deepEqual(
    again.map((item) => [item.title, item.course, item.type, item.note]),
    items.map((item) => [item.title, item.course, item.type, item.note])
  );
});

test('done items keep their completion stamp', () => {
  const text = '2026-11-02 23:59 | 高数作业 | 高数 | homework | | 2026-11-01 10:00';
  const item = parseData(text)[0];
  assert.equal(item.doneAt, '2026-11-01 10:00');
  assert.match(serialize([item]), /2026-11-01 10:00/);
});

test('bad lines raise a readable error', () => {
  assert.throws(() => parseLine('只有一列', 7), StoreError);
  assert.throws(() => parseLine('2026-11-02 23:59 |  | 高数', 8), StoreError);
  assert.throws(() => parseLine('2026-02-30 10:00 | 交作业', 9), StoreError);
});

test('ids follow file order and sorting is stable', () => {
  const items = assignIds([
    { due: new Date(2026, 10, 5), title: 'b' },
    { due: new Date(2026, 10, 2), title: 'a' }
  ]);
  assert.deepEqual(items.map((item) => item.id), [1, 2]);
  assert.deepEqual(sortByDue(items).map((item) => item.title), ['a', 'b']);
});
