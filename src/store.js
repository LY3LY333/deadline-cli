/**
 * The data file.
 *
 * One deadline per line, pipe separated, `#` starts a comment:
 *
 *   到期时间 | 标题 | 课程 | 类型 | 备注 | 完成时间
 *   2026-11-02 23:59 | 高数作业 3 | 高等数学 | homework | 第 5 章 |
 *
 * The last field is empty while the deadline is open and holds the completion
 * timestamp once `ddl done` was used. Pipes inside a field are written as `\|`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { DueParseError, formatDue, parseDue } from './due.js';

export const KINDS = ['homework', 'exam', 'project', 'other'];

export const HEADER = [
  '# deadline-cli 数据文件',
  '# 每行一条：到期时间 | 标题 | 课程 | 类型 | 备注 | 完成时间',
  '# 类型可选：homework / exam / project / other；直接编辑本文件也可以',
  ''
].join('\n');

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

/** Location of the data file (`DEADLINE_CLI_FILE` wins, handy for tests). */
export function defaultFile() {
  if (process.env.DEADLINE_CLI_FILE) return process.env.DEADLINE_CLI_FILE;
  return join(homedir(), '.deadline-cli', 'deadlines.dd');
}

function escapeField(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split on unescaped pipes. */
export function splitFields(line) {
  const out = [];
  let current = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      current += line[i + 1];
      i += 1;
      continue;
    }
    if (ch === '|') {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((field) => field.trim());
}

/**
 * @param {string} line
 * @param {number} [lineNumber] used in error messages
 * @returns {object|null} null for blank / comment lines
 */
export function parseLine(line, lineNumber = 0) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const fields = splitFields(trimmed);
  if (fields.length < 2) {
    throw new StoreError(`第 ${lineNumber} 行至少需要「到期时间 | 标题」`);
  }

  const [dueText, title, course = '', kind = 'other', note = '', doneAt = ''] = fields;
  if (!title) throw new StoreError(`第 ${lineNumber} 行标题为空`);

  let due;
  try {
    due = parseDue(dueText);
  } catch (error) {
    if (error instanceof DueParseError) throw new StoreError(`第 ${lineNumber} 行：${error.message}`);
    throw error;
  }

  const type = KINDS.includes(kind) ? kind : 'other';

  return {
    due,
    title,
    course,
    type,
    note,
    doneAt: doneAt || null
  };
}

/** @param {string} text */
export function parseData(text) {
  const items = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const item = parseLine(lines[i], i + 1);
    if (item) items.push(item);
  }
  return assignIds(items);
}

/** Ids are stable file positions, so `ddl done 2` always means the second row. */
export function assignIds(items) {
  return items.map((item, index) => ({ ...item, id: index + 1 }));
}

export function serializeItem(item) {
  return [
    formatDue(item.due),
    escapeField(item.title),
    escapeField(item.course),
    escapeField(item.type || 'other'),
    escapeField(item.note),
    item.doneAt ? escapeField(item.doneAt) : ''
  ].join(' | ');
}

export function serialize(items) {
  const body = items.map(serializeItem).join('\n');
  return `${HEADER}${body}${body ? '\n' : ''}`;
}

export function readStore(file = defaultFile()) {
  if (!existsSync(file)) return { file, items: [] };
  const text = readFileSync(file, 'utf8');
  return { file, items: parseData(text) };
}

export function writeStore(items, file = defaultFile()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, serialize(items), 'utf8');
  renameSync(tmp, file);
  return file;
}

export function sortByDue(items) {
  return [...items].sort((a, b) => a.due.getTime() - b.due.getTime() || a.id - b.id);
}
