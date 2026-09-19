# 项目协作指南（hermes-pending-board）

> 本文件等价于项目 AGENTS.md（写入保护文件需另行授权，暂以 docs/AGENT-NOTES.md 承载）。
> 行为规则遵循全局协议，本文件只补充本项目上下文。全程中文。

## 项目简介

Hermes 桌面 App 的**审批台插件**：`skills.write_approval` / `memory.write_approval` 门暂存到 `~/.hermes/pending/{skills,memory}/` 的写入，变成桌面端可点开的审阅界面——**左右分栏**（左=审批上下文，右=diff）、一键通过/拒绝，语义与官方 `/skills|/memory approve|reject` 完全同源。

本 repo 是唯一权威源，`~/.hermes/plugins/hermes-pending-board` 和 `~/.hermes/desktop-plugins/hermes-pending-board/plugin.js` 均为软链指向这里。

## 三层体系（2026-09-16 定型）

1. **插件本体**（本 repo，GitHub: cat-xierluo/hermes-pending-board）
2. **防膨胀体系**：生成前查重门（agent 铁律）+ 周一 10:00 合并审查 cron `skill-merge-review`（跑 `~/.hermes/scripts/skill-cluster-check.py`，合并走 `absorbed_into` 暂存等审批）
3. **审批上下文体系**：
   - sidecar `~/.hermes/pending/context/<id>.md`（三段式：为什么改/改后效果/来源）
   - 发起方当场写（最准）；每日 3:30 补写 cron `pending-context-backfill`（从会话库/git 回溯）
   - 无 sidecar 的暂存在 UI 显示警示框（信息缺失=决策输入）
   - 上游 `stage_write` 加 reason 字段是 DEC-008 观察项，暂不动核心

## 相关 cron 一览

| job | 时间 | 作用 |
|---|---|---|
| `skill-merge-review` (0ea5fff477b2) | 周一 10:00 | skill 聚类合并建议（走审批） |
| `pending-context-backfill` (ca4a83d04913) | 每日 03:30 | 补写缺失的审批上下文 sidecar |
| config-sync (26dc34f9373c) | 每日 03:00 | ~/.hermes 自动 commit+push（与上面错开半小时） |

## 文档职责

| 文档 | 职责 | git |
|---|---|---|
| README.md | 产品介绍+安装+**cron 搭配配置（完整可复制）** | ✅ 入库 |
| docs/DECISIONS.md | DEC-001~008 决策记录 | ❌ 仅本地 |
| docs/TASKS.md / ROADMAP.md | 待办与阶段 | ❌ 仅本地 |
| CHANGELOG.md | 版本变更 | ✅ 入库 |

## 关键约束（改代码前必读）

- plugin.js：只能 import `@hermes/plugin-sdk`/`react`/`react/jsx-runtime`；禁 JSX 语法；**禁 Tailwind 类名**（磁盘插件不进构建扫描），inline style + `--ui-*` 变量；accent 按钮文字用 `var(--color-primary-foreground, #fcfcfc)`
- plugin_api.py：审批必须走 `hermes_cli.write_approval_commands._approve/_reject`；路由挂载在后端启动时（改动需重启 serve）；`_context_text()` 读 sidecar，缺文件优雅降级
- 命名链四处同步：plugin id = manifest name = agent 目录名 = config plugins.enabled 条目
- 热重载不稳时 ⌘K → Reload desktop plugins；plugin_api 改动要 ⌘Q 重开 App

## 验证纪律

声称"修好了"必须有证据：desktop.log 无 `runtime load failed` + 探针 E2E（隔离 HERMES_HOME + CDP）或真实 App DOM 断言。样式断言用 `getComputedStyle`，比截图硬。

## 推送

`HTTPS_PROXY=http://127.0.0.1:1082 git push`（本机代理对 git 上行的唯一稳定通道）。提交作者统一 `cat-xierluo <cat-xierluo@users.noreply.github.com>`。
