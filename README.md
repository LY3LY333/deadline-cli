# deadline-cli

[![CI](https://github.com/LY3LY333/deadline-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/LY3LY333/deadline-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518.17-brightgreen.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

在终端里记作业和考试截止日，一条命令导出 `.ics` 塞进手机日历。**零依赖**，只用 Node 内置模块。

> Track assignment and exam deadlines from the terminal and export them to a valid iCalendar file — no dependencies, no account, no cloud.

---

## 为什么需要它

截止日散落在微信群、课程网站、教务系统里，靠脑子记迟早翻车。待办 App 又太重，导入日历还要手动一条条建。

这个工具把「记录」压到一行命令，把「提醒」交给手机日历（提前 1 天 + 提前 2 小时，双提醒），数据存在**一个纯文本文件**里，随时能 `git diff`、能备份、能手改。

## 安装

```bash
# 直接用，不用装
npx deadline-cli list

# 或者克隆下来
git clone https://github.com/LY3LY333/deadline-cli.git
cd deadline-cli
node bin/ddl.js list
```

要求 Node.js ≥ 18.17。没有任何第三方依赖。

## 快速开始

```bash
ddl init                                          # 创建数据文件
ddl add "高数作业 3" --due 11-02 23:59 --course 高等数学 --type homework --note 第5章
ddl add "软件工程期中考试" --due 明天 09:00 --course 软件工程 --type exam
ddl add "数据库大作业" --due +5d 18:00 --course 数据库 --type project

ddl list                # 未完成的，按到期排序
ddl list --today        # 只看今天到期的
ddl list --week         # 只看未来 7 天
ddl list --all          # 包含已完成的
ddl list --json         # 给脚本用

ddl done 2              # 标记完成
ddl export              # 生成 deadlines.ics
```

### 输出长这样

```text
#  到期              剩余        标题              课程      类型
1  2026-10-30 09:00  明天 09:00  软件工程期中考试  软件工程  exam
2  2026-11-02 23:59  4 天后      高数作业 3        高等数学  homework
3  2026-11-03 18:00  5 天后      数据库大作业      数据库    project
共 3 条
```

逾期条目显示红色、3 天内显示黄色（终端支持时自动着色，`NO_COLOR=1` 可关闭）。

## 支持的时间写法

| 写法 | 含义 |
|---|---|
| `2026-11-02 23:59` | 指定日期时间 |
| `2026-11-02` | 当天 23:59 |
| `11-02 08:00` / `11/02` | 今年的 11 月 2 日 |
| `今天 20:00` / `明天 09:00` / `后天` | 相对日期 |
| `+3d` / `+48h` / `+30m` | 从现在起 3 天 / 48 小时 / 30 分钟 |
| `周五 20:00` / `星期一` | 下一个周五 / 下周一 |

时间省略时默认为 `23:59`（`+Nd` 例外，它保持当前时刻）。

## 命令一览

| 命令 | 说明 |
|---|---|
| `ddl list [--today] [--week] [--all] [--json]` | 查看截止日 |
| `ddl add <标题> --due <时间> [--course] [--type] [--note]` | 添加 |
| `ddl done <编号>` / `ddl undone <编号>` | 完成 / 取消完成 |
| `ddl rm <编号>` | 删除 |
| `ddl export [--out 文件] [--days N] [--all]` | 导出 .ics（默认 `deadlines.ics`） |
| `ddl init` | 创建数据文件 |
| `ddl help` | 帮助 |

类型可选：`homework` / `exam` / `project` / `other`。

## 导入到手机

1. `ddl export --out deadlines.ics`
2. 把文件发给自己（微信/邮件/网盘都行）
3. 手机上点开 → 「添加到日历」，或者用日历 App 的「导入」功能

导出的每个事件带 **两个提醒**：提前 1 天、提前 2 小时。iPhone 日历、Google 日历、Outlook、小米/华为自带日历都能正常导入。

## 数据文件

默认位置 `~/.deadline-cli/deadlines.dd`，也可以用 `--file <路径>` 或环境变量 `DEADLINE_CLI_FILE` 指定。

格式是纯文本，一行一条，`#` 开头是注释：

```text
# 到期时间 | 标题 | 课程 | 类型 | 备注 | 完成时间
2026-11-02 23:59 | 高数作业 3 | 高等数学 | homework | 第 5 章 |
2026-11-05 09:00 | 期中考试 | 线性代数 | exam | |
```

可以直接用编辑器改，改完 `ddl list` 立刻生效。字段里的 `|` 写成 `\|`。

## 实现要点

- **UTC 时间戳**：`.ics` 里用 `DTSTART:20261102T155900Z` 而不是本地时间 + TZID，这样不需要附带 VTIMEZONE 组件，所有客户端都认
- **RFC 5545 折行**：按 **75 字节**（不是字符）折行，中文标题不会把行撑爆；续行以空格开头
- **转义**：`\` `;` `,` 和换行按规范转义
- **稳定 UID**：`sha1(标题 + 到期时间)`，重复导入不会产生重复事件
- **原子写入**：先写 `.tmp` 再 `rename`，中途崩溃不会损坏数据文件

## 已知限制

- 时间按**本机时区**解释；跨时区旅行时请在导入前确认
- 不做重复事件（每周的课可以自己写多条）
- 没有撤销；`rm` 之后只能靠 `git`/备份找回（建议把数据文件放进版本控制）

## 开发

```bash
node --test     # 32 个测试：时间解析、数据文件往返、.ics 结构/折行/转义、CLI 集成
```

## License

MIT © 2026 六月风
