/**
 * Command line interface. Kept free of side effects at import time so the
 * commands can be exercised from tests.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { formatCountdown, formatDue, parseDue, DueParseError } from './due.js';
import {
  KINDS,
  StoreError,
  assignIds,
  defaultFile,
  readStore,
  sortByDue,
  writeStore
} from './store.js';
import { toIcs } from './ics.js';

const HELP = `ddl — 作业/考试截止日管理，可导出到手机日历

用法：
  ddl list [--all] [--today] [--week] [--json]     查看截止日
  ddl add <标题> --due <时间> [--course 课程] [--type 类型] [--note 备注]
  ddl done <编号>          标记完成
  ddl undone <编号>        取消完成
  ddl rm <编号>            删除
  ddl export [--out 文件] [--days N] [--all]       导出 .ics
  ddl init                 创建数据文件
  ddl help                 显示本帮助

时间写法：
  2026-11-02 23:59   11-02 23:59   11/02
  今天 20:00   明天 09:00   后天   tomorrow 09:00
  +3d   +48h   +30m
  周五 20:00   星期一

类型：${KINDS.join(' / ')}

数据文件：${defaultFile()}
（可用 --file <路径> 或环境变量 DEADLINE_CLI_FILE 覆盖）
`;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[body] = true;
      } else {
        flags[body] = next;
        i += 1;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

/** Terminal width of a string, counting CJK as two columns. */
export function displayWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

export function padEndWidth(text, width) {
  const pad = width - displayWidth(text);
  return pad > 0 ? `${text}${' '.repeat(pad)}` : String(text);
}

function makePalette(enabled) {
  const wrap = (code) => (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text));
  return {
    dim: wrap('2'),
    red: wrap('31'),
    yellow: wrap('33'),
    green: wrap('32'),
    bold: wrap('1')
  };
}

function colorFor(item, now, palette) {
  if (item.doneAt) return palette.dim;
  const diff = item.due.getTime() - now.getTime();
  if (diff < 0) return palette.red;
  if (diff <= 3 * 24 * 60 * 60 * 1000) return palette.yellow;
  return (text) => String(text);
}

export function renderTable(items, { now = new Date(), palette = makePalette(false) } = {}) {
  if (items.length === 0) return '';

  const header = ['#', '到期', '剩余', '标题', '课程', '类型'];
  const rows = items.map((item) => [
    String(item.id),
    formatDue(item.due),
    item.doneAt ? '已完成' : formatCountdown(item.due, now),
    item.title,
    item.course || '-',
    item.type
  ]);

  const widths = header.map((cell, index) =>
    Math.max(displayWidth(cell), ...rows.map((row) => displayWidth(row[index])))
  );

  const line = (cells) => cells.map((cell, i) => padEndWidth(cell, widths[i])).join('  ').trimEnd();

  const out = [palette.bold(line(header))];
  for (let i = 0; i < rows.length; i += 1) {
    const color = colorFor(items[i], now, palette);
    out.push(color(line(rows[i])));
  }
  return out.join('\n');
}

function sortForDisplay(items) {
  const open = sortByDue(items.filter((item) => !item.doneAt));
  const done = sortByDue(items.filter((item) => item.doneAt));
  return [...open, ...done];
}

function resolveFile(flags) {
  return flags.file ? resolve(String(flags.file)) : defaultFile();
}

function printItems(items, io, { now, flags, palette }) {
  const visible = items.filter((item) => !item.doneAt);
  let selected = visible;

  if (flags.today) {
    const end = new Date(now.getTime());
    end.setHours(23, 59, 59, 999);
    selected = visible.filter((item) => item.due.getTime() <= end.getTime());
  } else if (flags.week) {
    selected = visible.filter((item) => item.due.getTime() <= now.getTime() + WEEK_MS);
  }

  const rows = flags.all ? sortForDisplay(items) : sortByDue(selected);

  if (flags.json) {
    const payload = rows.map((item) => ({
      id: item.id,
      title: item.title,
      due: item.due.toISOString(),
      dueLocal: formatDue(item.due),
      course: item.course,
      type: item.type,
      note: item.note,
      done: Boolean(item.doneAt),
      doneAt: item.doneAt,
      countdown: item.doneAt ? '已完成' : formatCountdown(item.due, now)
    }));
    io.out(JSON.stringify(payload, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    io.out('没有待办 🎉  用 ddl add "标题" --due 明天 20:00 添加一条');
    return 0;
  }

  io.out(renderTable(rows, { now, palette }));

  const overdue = rows.filter((item) => !item.doneAt && item.due.getTime() < now.getTime()).length;
  const summary = `共 ${rows.length} 条` + (overdue ? `，其中 ${overdue} 条已逾期` : '');
  io.out(palette.dim(summary));
  return 0;
}

const COMMANDS = {
  list: (ctx) => {
    const { items } = readStore(ctx.file);
    return printItems(items, ctx.io, ctx);
  },

  add: (ctx) => {
    const title = ctx.positional.join(' ').trim();
    if (!title) {
      ctx.io.err('缺少标题，例如：ddl add "高数作业 3" --due 明天 20:00');
      return 2;
    }
    if (!ctx.flags.due) {
      ctx.io.err('缺少 --due，例如：--due "2026-11-02 23:59" 或 --due 明天 20:00');
      return 2;
    }

    const type = String(ctx.flags.type ?? 'other');
    if (!KINDS.includes(type)) {
      ctx.io.err(`类型只能是 ${KINDS.join(' / ')}，收到「${type}」`);
      return 2;
    }

    let due;
    try {
      due = parseDue(String(ctx.flags.due), ctx.now);
    } catch (error) {
      if (error instanceof DueParseError) {
        ctx.io.err(error.message);
        return 2;
      }
      throw error;
    }

    const { items } = readStore(ctx.file);
    const item = {
      due,
      title,
      course: String(ctx.flags.course ?? '').trim(),
      type,
      note: String(ctx.flags.note ?? '').trim(),
      doneAt: null
    };
    // Ids are file positions, so renumber after sorting and before writing.
    const next = assignIds(sortByDue([...items, item]));
    writeStore(next, ctx.file);

    const saved = next.find(
      (entry) => entry.title === item.title && entry.due.getTime() === item.due.getTime()
    );
    ctx.io.out(`✓ 已添加 #${saved ? saved.id : '?'}  ${title}`);
    ctx.io.out(`  到期：${formatDue(due)}（${formatCountdown(due, ctx.now)}）`);
    return 0;
  },

  done: (ctx) => setDone(ctx, true),
  undone: (ctx) => setDone(ctx, false),

  rm: (ctx) => {
    const id = Number(ctx.positional[0]);
    const { items } = readStore(ctx.file);
    const target = items.find((item) => item.id === id);
    if (!target) {
      ctx.io.err(`没有编号为 ${ctx.positional[0] ?? '(空)'} 的条目，先 ddl list 看看`);
      return 2;
    }
    writeStore(items.filter((item) => item.id !== id), ctx.file);
    ctx.io.out(`✓ 已删除 #${id}  ${target.title}`);
    return 0;
  },

  export: (ctx) => {
    const { items } = readStore(ctx.file);
    const days = ctx.flags.days === undefined ? null : Number(ctx.flags.days);
    if (days !== null && (!Number.isFinite(days) || days <= 0)) {
      ctx.io.err('--days 需要一个正整数');
      return 2;
    }

    const horizon = days === null ? null : ctx.now.getTime() + days * 24 * 60 * 60 * 1000;
    const selected = items.filter((item) => {
      if (!ctx.flags.all && item.doneAt) return false;
      if (horizon !== null && item.due.getTime() > horizon) return false;
      return true;
    });

    if (selected.length === 0) {
      ctx.io.err('没有可导出的条目');
      return 1;
    }

    const outPath = resolve(String(ctx.flags.out ?? 'deadlines.ics'));
    writeFileSync(outPath, toIcs(selected, { now: ctx.now }), 'utf8');
    ctx.io.out(`✓ 已导出 ${selected.length} 条 → ${outPath}`);
    ctx.io.out('  导入方式：手机日历 App → 设置 → 导入，或把 .ics 发给自己点开');
    return 0;
  },

  init: (ctx) => {
    if (existsSync(ctx.file)) {
      ctx.io.out(`数据文件已存在：${ctx.file}`);
      return 0;
    }
    writeStore([], ctx.file);
    ctx.io.out(`✓ 已创建 ${ctx.file}`);
    ctx.io.out('  下一步：ddl add "高数作业 3" --due 明天 20:00');
    return 0;
  },

  help: (ctx) => {
    ctx.io.out(HELP.trimEnd());
    return 0;
  }
};

function setDone(ctx, done) {
  const id = Number(ctx.positional[0]);
  const { items } = readStore(ctx.file);
  const target = items.find((item) => item.id === id);
  if (!target) {
    ctx.io.err(`没有编号为 ${ctx.positional[0] ?? '(空)'} 的条目，先 ddl list 看看`);
    return 2;
  }

  const next = items.map((item) =>
    item.id === id ? { ...item, doneAt: done ? formatDue(ctx.now) : null } : item
  );
  writeStore(next, ctx.file);
  ctx.io.out(`✓ ${done ? '已完成' : '已恢复'} #${id}  ${target.title}`);
  return 0;
}

/**
 * @param {string[]} argv
 * @param {{now?: Date, io?: {out: Function, err: Function}, isTTY?: boolean}} [options]
 */
export function run(argv, options = {}) {
  const now = options.now ?? new Date();
  const io = options.io ?? {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`)
  };
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const palette = makePalette(isTTY && !process.env.NO_COLOR);

  const { flags, positional } = parseArgs(argv);
  if (flags.version || flags.v) {
    io.out('deadline-cli 0.1.0');
    return 0;
  }

  const command = positional.shift() ?? 'list';
  const handler = COMMANDS[command];
  if (!handler) {
    io.err(`未知命令：${command}`);
    io.out(HELP.trimEnd());
    return 2;
  }

  try {
    return handler({
      flags,
      positional,
      now,
      io,
      palette,
      file: resolveFile(flags)
    });
  } catch (error) {
    if (error instanceof StoreError || error instanceof DueParseError) {
      io.err(error.message);
      return 2;
    }
    throw error;
  }
}
