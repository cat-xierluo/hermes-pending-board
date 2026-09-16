# Changelog

本文件记录 hermes-pending-board 的版本变化。

## 2.0.0（2026-09-15）

### Changed
- **改名**：`pending-board` → `hermes-pending-board`（plugin id / API 命名空间 / 桌面路由 `/hermes-pending-board`，DEC-004）
- **repo 化**：独立 git 仓库，`~/.hermes/` 侧软链挂载

## 1.x（2026-09-14 ~ 09-15，repo 化之前）

### Added
- FastAPI 后端 `plugin_api.py`：`/pending` `/gates` `/diff/{sub}/{pid}` `/act`，审批语义与官方 `/skills|/memory approve|reject` 同源
- CLI fallback：`~/.hermes/bin/pending-review`（list/show/approve/reject）
- 桌面插件：侧栏「审批台」入口、状态条待审计数 pill、审批卡片页（unified diff + 通过/拒绝）

### Fixed（v1 → v2 关键修复）
- 样式裸奔：磁盘插件不进 Tailwind 构建扫描，v1 类名全部失效 → v2 改 inline style + `--ui-*` 主题变量
- `defaultEnabled: false` 导致只进清单不注册 → v2 改 true
- 移除 `window.confirm` 二次确认，改 busy 态 + 行内结果反馈（DEC-005）
- 历史遗留：v1 某版语法错误（`Unexpected token ']'`）+ 框架级 loader bug（2026-09-10 upstream 修复 `6c3d4a4af7`）叠加造成的"空白页"，详见 HANDOFF 结案记录

## 2.0.1（2026-09-15）

### Fixed
- 「通过」按钮文字对比度：`--ui-bg-primary` → `var(--color-primary-foreground, #fcfcfc)`（官方 accent 按钮配对色，此前蓝底深字看不清）
- diff 行前缀误判：YAML frontmatter 分隔线 `---` 被 `startsWith('-')` 误染为删除行 → 排除 `---`/`──`，归入分隔线灰色

## 2.0.2（2026-09-15）

### Added
- docs/: DECISIONS / TASKS / ROADMAP（本地工作流文档，不入库）
- 排障经验沉淀为 `hermes-desktop-plugins` skill v2.0.0（暂存待审，含两轮会话踩坑全录）

## 2.0.3（2026-09-16）

### Fixed
- approve 失败反馈:行内小字 → 整宽错误块(标题+完整后端原因+死信指引)。
  起因:存量 75 条暂存全部是结构性死信(stage 不校验:desc 超 60 字符 28 条/patch 缺参 3 条/记忆超容量或 old_text 过期若干),
  approve 必失败且回滚留存,GUI 表现为"点了没反应"。已全部 reject 清零。

## 2.1.0（2026-09-16）

### Added
- **审批上下文**: 每条暂存可携带"为什么改/改后效果/来源"(sidecar `pending/context/<id>.md`)
  - 后端: /pending 带 hasContext+contextPreview, /diff 带全文 context
  - 前端: 卡头 🛈 徽标 + 展开区顶部上下文块(accent 边框区隔)
  - 发起方(agent/cron)stage 后顺手写 sidecar;无 sidecar 时优雅降级(仅 summary)
  - 已为当前 8 条待审补写真实上下文(打捞/重建理由)

## 2.2.0（2026-09-16）

### Changed
- 卡片展开区改**左右分栏**: 左=审批上下文+元信息(38%,独立滚动), 右=diff(独立滚动)。
  长上下文/长 diff 不再互相挤占,总高度封顶 480px。

### Added
- 无 sidecar 暂存的显式提示: 左栏显示虚线框"未携带上下文,仅凭 diff 判断需谨慎"——
  把"信息缺失"本身变成审批决策输入,而不是静默降级。

### Fixed
- FDE 记忆重提(eec9c546, 原 4f9b8539 在重启窗口丢失); 5 条存量暂存补写 context sidecar。

## 2.2.1（2026-09-16）

### Changed
- 补写 cron 调整为凌晨 3:30(原 22:40,错开整点高峰)
- README 搭配章节升级: cron 写法完整可复制(含 prompt 全文),作为正式推荐配置
