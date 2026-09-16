# hermes-pending-board

Hermes 桌面 App 的**审批台插件**：`skills.write_approval` / `memory.write_approval` 门暂存的写入（`~/.hermes/pending/{skills,memory}/`），在桌面端点开即审——unified diff、一键通过/拒绝。

审批语义与官方 `/skills | /memory approve | reject` **完全同源**（直接调用 `hermes_cli.write_approval_commands`），不引入第二套审批实现。

## 为什么

开了写审批门之后，agent 的技能/记忆写入会持续暂存等待人工审。官方审阅面是 CLI 斜杠命令（`/skills pending` → `/skills approve <id>`），diff 长了在终端里翻很费劲。这个插件给暂存队列一个桌面 GUI 入口：状态条常驻待审计数，侧栏「审批台」整页审阅。

## 结构（统一包，一个 repo 两个半体）

```
hermes-pending-board/
├── plugin.yaml               # agent 半体清单
├── __init__.py
├── dashboard/
│   ├── manifest.json         # name = API 命名空间 /api/plugins/hermes-pending-board/
│   └── plugin_api.py         # FastAPI 后端：/pending /gates /diff/{sub}/{pid} /act
└── desktop/
    └── plugin.js             # 桌面半体：侧栏入口 + 状态条 pill + 审批页
```

## 安装

**方式 A：git clone + 软链（开发者，本机当前用法）**

```bash
git clone <this-repo> <任意目录>
ln -s <repo> ~/.hermes/plugins/hermes-pending-board
mkdir -p ~/.hermes/desktop-plugins/hermes-pending-board
ln -s <repo>/desktop/plugin.js ~/.hermes/desktop-plugins/hermes-pending-board/plugin.js
# config.yaml 的 plugins.enabled 加入 hermes-pending-board，重启 serve 后端
```

**方式 B：hermes plugins install（分发用）**

```bash
hermes plugins install cat-xierluo/hermes-pending-board
# 桌面半体会被 Electron 复制到 desktop-plugins/（带 marker，opt-in），
# 在 Capabilities → Plugins 里打开
```

## 使用

1. 开启审批门：`/skills approval on`、`/memory approval on`（或 config.yaml `skills.write_approval: true`）
2. 桌面 App 侧栏「审批台」（状态条也有 `☑ N` 计数 pill）
3. 展开卡片看 diff（技能=unified diff 对照磁盘现状；记忆=旧→新全文），✓ 通过 / ✕ 拒绝

## 前置要求

- Hermes Desktop（App 构建需含 2026-09-10 `6c3d4a4af7` 之后的 loader 修复——更早的构建所有磁盘插件都加载失败，与本插件无关）
- 后端半体需在 `config.yaml` 的 `plugins.enabled` 中，且 serve 进程在此之后启动

## 已知折衷

- 软链部署时 `plugin.js` 的 fs watch 热重载可能不触发，改完 ⌘K → **Reload desktop plugins**
- `plugin_api.py` 改动需重启 serve 后端（路由启动时挂载，平台机制）
- 对 OAuth 远程后端，`ctx.rest` 之外的 socket 通道不可用（本插件只用 REST + 轮询，不受影响）

## License

MIT

## 搭配：审批上下文 sidecar（推荐配置）

暂存记录本身只有一句话 gist（上游 `stage_write` schema 所限），审批时"为什么改"需要额外上下文。
本插件支持 sidecar 机制：`~/.hermes/pending/context/<id>.md`（三段式：为什么改/改后效果/来源），
`/pending` 与 `/diff` 自动附带；无 sidecar 的记录显示警示框。

两条配套（参照 `docs/DECISIONS.md` DEC-006，本地）：
1. **发起方约定**：agent 每次 stage 后顺手写 sidecar（当场写最准）
2. **每日补写 cron（正式推荐配置）**：为漏写的存量补写（从会话库/git 历史回溯动机）。
凌晨 3:30 跑（错开整点高峰；审批人隔天看队列时上下文已就位）。可直接复制：

```bash
hermes cron create --name "pending-context-backfill" "30 3 * * *" \
  "任务: 为 ~/.hermes/pending/{skills,memory}/ 里没有对应 context sidecar(~/.hermes/pending/context/<id>.md)的暂存记录补写审批上下文。步骤: 1) 遍历 pending/{skills,memory}/*.json,找出 pending/context/ 下无同名 .md 的; 2) 对每条: 从 state.db 会话库(该暂存 created_at 前后的 assistant 正文/工具调用)和 git log 挖出修改动机,写三段式 sidecar(## 为什么改 / ## 改后效果 / ## 来源),末尾注明'本 sidecar 为定时补写(时间)'; 3) 挖不到动机的写明'来源不可考,仅凭 diff 判断'。约束: 只写 context/*.md,绝不碰暂存 JSON 本身,绝不 approve/reject 任何记录。输出一行摘要: 补写 N 条/跳过 M 条(不可考 K 条)。另外: 若发现 MEMORY.md 超 2200 字符上限导致记忆暂存会成为死信,在摘要里提醒。" \
  --skill "hermes-ops" --deliver "local"
```

> `--skill hermes-ops` 换成你自己环境里承载运维知识的 skill（或不带此参数）。
