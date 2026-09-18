// hermes-pending-board — Hermes Desktop 审批台插件
// 暂存写入(skills/memory)的交互式审阅: unified diff + 一键通过/拒绝。
// 后端: ~/.hermes/plugins/hermes-pending-board/dashboard/plugin_api.py (软链→repo)
//   ctx.rest('/x') → GET/POST /api/plugins/hermes-pending-board/x
// 审批语义与 /skills|/memory approve 完全同源(hermes_cli.write_approval_commands)。
//
// v2 要点(接手修复):
//   1. 样式全部 inline style + --ui-* 主题变量 — 磁盘插件不进 Tailwind 构建扫描,
//      className 里的工具类(含任意值语法)一律不生效, 千万不要改回类名写法。
//   2. defaultEnabled: true — 独立磁盘部署即注册。(上一版 false: 只进 Capabilities
//      清单不注册, 侧栏却有旧贡献残留, 制造了"空白页"排查噪音。)
//   3. 不用 window.confirm — 通过/拒绝直接执行, 按钮带 busy + 结果反馈。
//   4. diff 配色用官方 --ui-diff-add-* / --ui-diff-remove-* 变量。
//
// v2.1: queryKey 全部纳入 connectionId 作用域。多网关连接下 queryKey 若不含
//   连接标识, 切连接后先展示上一网关的缓存(数据串台); 现订阅 host.state.connectionId,
//   切换时前缀失效全部缓存, 待审数/列表/diff 恒属于当前激活网关。

import {
  host, useQuery, useQueryClient, useValue,
  ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS,
} from '@hermes/plugin-sdk'
import React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const { useState, useEffect, useRef } = React

// 连接作用域: null=本机/legacy → ''。防御性读法兼容旧 SDK(官方 bundled 插件同款)。
const connIdOf = () => String(host.state.connectionId?.get?.() || '').trim()
const pendingKey = (c) => ['hermes-pending-board', c, 'pending']
const gatesKey = (c) => ['hermes-pending-board', c, 'gates']
const diffKey = (c, sub, id) => ['hermes-pending-board', c, 'diff', sub, id]

let _rest = null // register(ctx) 时捕获

async function api(path, opts) {
  if (!_rest) throw new Error('plugin not registered yet')
  return _rest(path, opts)
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

function fmtTs(ts) {
  if (!ts) return ''
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

// ── 状态条 pill: 待审数量, 点击进入审批页 ─────────────────────
function PendingCount({ navigate }) {
  // 订阅 connectionId: 切连接时 queryKey 随之变化, 待审数立即跟随新网关而非旧缓存。
  const connId = String(useValue(host.state.connectionId) || '').trim()
  const { data } = useQuery({
    queryKey: pendingKey(connId),
    queryFn: () => api('/pending'),
    refetchInterval: 30_000,
  })
  const n = (data && data.items ? data.items.length : 0)
  if (n === 0) return null
  return jsx('button', {
    type: 'button',
    title: `${n} 项待审写入 — 点击打开审批台`,
    onClick: () => navigate('/hermes-pending-board'),
    style: {
      all: 'unset', cursor: 'pointer', padding: '0 6px',
      fontSize: '11px', fontFamily: MONO,
      color: 'var(--ui-text-tertiary)',
    },
    children: `☑ ${n}`,
  })
}

// ── diff 渲染 ───────────────────────────────────────────────
// wrap=true: 自动换行(overflowWrap anywhere, 不用 break-all 碎行, 中文 prose 友好)
// wrap=false: 横向滚动(whiteSpace pre, 行结构绝对整齐, 代码式 diff 惯例)
function DiffView({ lines, wrap }) {
  const lineStyle = (l) => {
    // unified diff 行: '+xxx'/'-xxx'。排除 '---'(frontmatter/分隔线) 与 '--'(长横线)。
    if (l.startsWith('+')) return { color: 'var(--ui-diff-add-foreground)', background: 'var(--ui-diff-add-background)' }
    if (l.startsWith('-') && !l.startsWith('---') && !l.startsWith('──')) return { color: 'var(--ui-diff-remove-foreground)', background: 'var(--ui-diff-remove-background)' }
    if (l.startsWith('---') || l.startsWith('@@') || l.startsWith('──')) return { color: 'var(--ui-text-tertiary)' }
    return { color: 'var(--ui-text-secondary)' }
  }
  return jsx('div', {
    style: {
      maxHeight: 'none',
      overflowX: wrap ? 'hidden' : 'auto',
      border: '1px solid var(--ui-stroke-secondary)',
      background: 'var(--ui-bg-secondary)',
      borderRadius: '8px', padding: '10px 12px',
    },
    children: jsx('pre', {
      style: {
        margin: 0, fontFamily: MONO, fontSize: '11.5px',
        lineHeight: 1.65,
        whiteSpace: wrap ? 'pre-wrap' : 'pre',
        overflowWrap: wrap ? 'anywhere' : 'normal',
      },
      children: lines.map((l, i) => jsx('span', {
        style: Object.assign({ display: 'block' }, lineStyle(l)),
        children: l || ' ',
      }, i)),
    }),
  })
}

// ── 单张审批卡 ───────────────────────────────────────────────
function Card({ it, onActed }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [wrap, setWrap] = useState(true) // diff 换行模式: true=自动换行 false=横向滚动(会话级偏好记忆)
  const [ctxOpen, setCtxOpen] = useState(true) // 审批上下文: 默认展开(审批人主要读"为什么改")
  const [diffOpen, setDiffOpen] = useState(false) // diff: 默认折叠(看不看按需点开)
  const diffQ = useQuery({
    queryKey: diffKey(connIdOf(), it.sub, it.id),
    queryFn: () => api(`/diff/${it.sub}/${it.id}`),
    enabled: open,
  })

  async function act(ok) {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await api('/act', {
        method: 'POST',
        body: { action: ok ? 'approve' : 'reject', sub: it.sub, id: it.id },
      })
      setResult(r)
      if (r && r.ok) {
        await qc.invalidateQueries({ queryKey: pendingKey(connIdOf()) })
        onActed && onActed()
      }
    } catch (e) {
      setResult({ ok: false, output: String(e) })
    } finally {
      setBusy(false)
    }
  }

  const isMem = it.sub === 'memory'
  const opsLabel = String(it.ops || '').slice(0, 28)

  const headerBtn = {
    all: 'unset', cursor: 'pointer', display: 'flex', flexWrap: 'wrap',
    alignItems: 'center', gap: '10px', width: '100%', boxSizing: 'border-box',
    padding: '11px 14px', textAlign: 'left',
  }

  return jsxs('div', {
    style: {
      border: '1px solid var(--ui-stroke-secondary)',
      background: 'var(--ui-bg-elevated)',
      borderRadius: '10px', overflow: 'hidden',
    },
    children: [
      jsxs('button', {
        type: 'button',
        style: headerBtn,
        onClick: () => setOpen(o => !o),
        children: [
          jsx('span', {
            style: {
              borderRadius: '5px', padding: '1px 6px',
              fontFamily: MONO, fontSize: '10.5px',
              background: 'color-mix(in srgb, var(--ui-accent) 15%, transparent)',
              color: 'var(--ui-accent)',
            },
            children: isMem ? '记忆' : (opsLabel || '技能'),
          }),
          jsx('span', {
            style: { fontSize: '13.5px', fontWeight: 600, color: 'var(--ui-text-primary)' },
            children: it.name,
          }),
          jsx('span', {
            style: {
              marginLeft: 'auto', fontFamily: MONO, fontSize: '10.5px',
              color: 'var(--ui-text-tertiary)',
            },
            children: `${it.hasContext ? '🛈 ' : ''}${it.id} · ${fmtTs(it.ts)}`,
          }),
          jsx('span', {
            style: { color: 'var(--ui-text-tertiary)', fontSize: '11px' },
            children: open ? '▲' : '▼',
          }),
        ],
      }),
      jsx('div', {
        style: {
          padding: '0 14px 10px', fontSize: '12.5px', lineHeight: 1.6,
          color: 'var(--ui-text-tertiary)', wordBreak: 'break-all',
        },
        children: it.summary,
      }),
      open && jsxs('div', {
        style: { borderTop: '1px solid var(--ui-stroke-secondary)', display: 'flex', flexDirection: 'column' },
        children: [
          // ── 操作条置顶: 通过/拒绝常驻卡片顶部, 不再与 diff 抢宽度 ──
          jsxs('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 14px', flexWrap: 'wrap',
            },
            children: [
              jsx('button', {
                type: 'button', disabled: busy,
                onClick: () => act(true),
                style: {
                  all: 'unset', cursor: busy ? 'default' : 'pointer',
                  background: 'var(--ui-accent)', color: 'var(--color-primary-foreground, #fcfcfc)',
                  borderRadius: '7px', padding: '5px 16px',
                  fontSize: '12.5px', fontWeight: 600,
                  opacity: busy ? 0.4 : 1,
                },
                children: '✓ 通过',
              }),
              jsx('button', {
                type: 'button', disabled: busy,
                onClick: () => act(false),
                style: {
                  all: 'unset', cursor: busy ? 'default' : 'pointer',
                  border: '1px solid var(--ui-stroke-secondary)',
                  color: 'var(--ui-text-secondary)',
                  borderRadius: '7px', padding: '5px 16px', fontSize: '12.5px',
                  opacity: busy ? 0.4 : 1,
                },
                children: '✕ 拒绝',
              }),
              result && result.ok && jsx('span', {
                style: { fontFamily: MONO, fontSize: '11.5px', color: 'var(--ui-green)' },
                children: '✓ 已生效',
              }),
            ],
          }),
          // ── 元信息: 一行小字, 窄屏自动折行 ──
          jsxs('div', {
            style: {
              display: 'flex', flexWrap: 'wrap', gap: '2px 14px',
              padding: '0 14px 10px', fontSize: '11.5px', alignItems: 'baseline',
            },
            children: [
              jsxs('span', { style: { color: 'var(--ui-text-tertiary)' }, children: [
                '落盘 ',
                jsx('span', {
                  style: { fontFamily: MONO, color: 'var(--ui-text-secondary)', wordBreak: 'break-all' },
                  children: it.target,
                }),
              ] }),
              jsxs('span', { style: { color: 'var(--ui-text-tertiary)' }, children: [
                '来源 ',
                jsx('span', {
                  style: { fontFamily: MONO, color: 'var(--ui-text-secondary)', wordBreak: 'break-all' },
                  children: it.origin,
                }),
              ] }),
            ],
          }),
          // ── 审批上下文: 默认展开, 可折叠; 展开时限高独立滚动 ──
          jsxs('div', { style: { padding: '0 14px 10px' }, children: [
            jsx('button', {
              type: 'button',
              onClick: () => setCtxOpen(o => !o),
              style: {
                all: 'unset', cursor: 'pointer',
                fontSize: '11px', fontWeight: 600, color: 'var(--ui-accent)', letterSpacing: '0.03em',
              },
              children: `🛈 审批上下文 ${ctxOpen ? '▾' : '▸'}`,
            }),
            ctxOpen && (diffQ.data && diffQ.data.context
              ? jsx('pre', {
                  style: {
                    margin: '6px 0 0', padding: '8px 10px',
                    border: '1px solid var(--ui-stroke-secondary)', borderRadius: '7px',
                    background: 'var(--ui-bg-secondary)',
                    fontSize: '11.5px', lineHeight: 1.7,
                    color: 'var(--ui-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    fontFamily: 'inherit',
                    maxHeight: '240px', overflowY: 'auto',
                  },
                  children: String(diffQ.data.context),
                })
              : jsx('div', {
                  style: {
                    marginTop: '6px', padding: '8px 10px',
                    border: '1px dashed var(--ui-stroke-secondary)', borderRadius: '7px',
                    fontSize: '11.5px', color: 'var(--ui-text-quaternary, var(--ui-text-tertiary))', lineHeight: 1.6,
                  },
                  children: '该暂存未携带上下文(发起时未写 sidecar)。仅凭 diff 判断需谨慎,可先拒。',
                })),
          ] }),
          // ── diff: 默认折叠, 点开后全宽 + 「换行 ⇄ 横滚」切换 ──
          jsxs('div', {
            style: { padding: '0 14px 12px', minWidth: 0 },
            children: [
              jsxs('div', {
                style: {
                  display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px',
                  fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.05em',
                  color: 'var(--ui-text-tertiary)',
                },
                children: [
                  jsx('span', {
                    style: { flex: 1 },
                    children: it.sub === 'skills' ? 'UNIFIED DIFF (对照磁盘现状)' : '写入内容 (旧 → 新)',
                  }),
                  diffOpen && jsx('button', {
                    type: 'button',
                    onClick: () => setWrap(w => !w),
                    title: wrap ? '当前: 自动换行。点击切换为横向滚动(行结构整齐)' : '当前: 横向滚动。点击切换为自动换行(prose 友好)',
                    style: {
                      all: 'unset', cursor: 'pointer',
                      border: '1px solid var(--ui-stroke-secondary)', borderRadius: '5px',
                      padding: '1px 8px', fontFamily: MONO, fontSize: '10px',
                      color: 'var(--ui-text-tertiary)', letterSpacing: '0.02em',
                    },
                    children: wrap ? '⏎ 换行' : '⇆ 横滚',
                  }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => setDiffOpen(o => !o),
                    title: diffOpen ? '收起 diff' : '展开 diff 查看具体改动',
                    style: {
                      all: 'unset', cursor: 'pointer',
                      border: '1px solid var(--ui-stroke-secondary)', borderRadius: '5px',
                      padding: '1px 8px', fontFamily: MONO, fontSize: '10px',
                      color: 'var(--ui-text-tertiary)', letterSpacing: '0.02em',
                    },
                    children: diffOpen ? '▾ 收起 diff' : '▸ 展开 diff',
                  }),
                ],
              }),
              diffOpen && (diffQ.isLoading
                ? jsx('div', { style: { color: 'var(--ui-text-tertiary)', fontSize: '12px', padding: '10px 0' }, children: '加载 diff…' })
                : (diffQ.data && diffQ.data.error)
                  ? jsx('div', { style: { color: 'var(--ui-red)', fontSize: '12px', padding: '10px 0' }, children: diffQ.data.error })
                  : jsx(DiffView, { lines: (diffQ.data && diffQ.data.lines) || [], wrap })),
            ],
          }),
          result && !result.ok && jsxs('div', {
            style: {
              margin: '0 14px 12px', padding: '8px 12px',
              border: '1px solid var(--ui-red)', borderRadius: '7px',
              background: 'color-mix(in srgb, var(--ui-red) 6%, transparent)',
            },
            children: [
              jsx('div', {
                style: { fontSize: '12px', fontWeight: 600, color: 'var(--ui-red)', marginBottom: '4px' },
                children: '✕ 未生效 — 该写入无法落盘',
              }),
              jsx('pre', {
                style: {
                  margin: 0, fontFamily: MONO, fontSize: '11px', lineHeight: 1.6,
                  color: 'var(--ui-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                },
                children: String(result.output || result.error || '未知错误'),
              }),
              jsx('div', {
                style: { marginTop: '6px', fontSize: '11.5px', color: 'var(--ui-text-tertiary)' },
                children: '常见原因: description 超 60 字符 / 记忆超容量 / old_text 已过期。此类记录 approve 永远失败，请 ✕ 拒绝清掉。',
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

// ── 审批页 ──────────────────────────────────────────────────
function PendingBoardPage() {
  const [filter, setFilter] = useState('all')
  const qc = useQueryClient()
  // 连接切换: 前缀失效全部缓存(含旧网关遗留的 pending/gates/diff), 强制按新 connId 重新拉取。
  const connId = String(useValue(host.state.connectionId) || '').trim()
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    qc.invalidateQueries({ queryKey: ['hermes-pending-board'] })
  }, [connId, qc])
  const listQ = useQuery({
    queryKey: pendingKey(connId), queryFn: () => api('/pending'), refetchInterval: 15_000,
  })
  const gatesQ = useQuery({
    queryKey: gatesKey(connId), queryFn: () => api('/gates'), refetchInterval: 60_000,
  })

  const items = (listQ.data && listQ.data.items) || []
  const shown = items.filter(it => filter === 'all' || it.sub === filter)
  const nSkills = items.filter(it => it.sub === 'skills').length
  const nMem = items.filter(it => it.sub === 'memory').length

  const chip = (active) => ({
    all: 'unset', cursor: 'pointer', borderRadius: '999px', padding: '2px 12px',
    fontSize: '12px',
    border: `1px solid ${active ? 'var(--ui-accent)' : 'var(--ui-stroke-secondary)'}`,
    color: active ? 'var(--ui-accent)' : 'var(--ui-text-tertiary)',
    fontWeight: active ? 600 : 400,
  })

  return jsxs('div', {
    style: {
      height: '100%', overflow: 'auto', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: '12px', padding: '18px',
    },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' },
        children: [
          jsx('h1', { style: { margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--ui-text-primary)' }, children: '审批台' }),
          jsx('span', { style: { fontSize: '12px', color: 'var(--ui-text-tertiary)' },
            children: '技能与记忆的暂存写入 · ~/.hermes/pending/' }),
          jsxs('span', {
            style: { marginLeft: 'auto', display: 'flex', gap: '6px' },
            children: [
              jsx('button', { type: 'button', style: chip(filter === 'all'),
                onClick: () => setFilter('all'), children: `全部 ${items.length}` }),
              jsx('button', { type: 'button', style: chip(filter === 'skills'),
                onClick: () => setFilter('skills'), children: `技能 ${nSkills}` }),
              jsx('button', { type: 'button', style: chip(filter === 'memory'),
                onClick: () => setFilter('memory'), children: `记忆 ${nMem}` }),
            ],
          }),
        ],
      }),
      gatesQ.data && jsxs('div', { style: { display: 'flex', gap: '8px' }, children: [
        jsx('span', {
          style: {
            borderRadius: '999px', padding: '2px 10px', fontSize: '11.5px',
            border: '1px solid var(--ui-stroke-secondary)', color: 'var(--ui-text-tertiary)',
          },
          children: `技能写审批 ${gatesQ.data.skills ? 'ON' : 'OFF'}`,
        }),
        jsx('span', {
          style: {
            borderRadius: '999px', padding: '2px 10px', fontSize: '11.5px',
            border: '1px solid var(--ui-stroke-secondary)', color: 'var(--ui-text-tertiary)',
          },
          children: `记忆写审批 ${gatesQ.data.memory ? 'ON' : 'OFF'}`,
        }),
      ] }),
      listQ.isLoading
        ? jsx('div', { style: { color: 'var(--ui-text-tertiary)', padding: '24px 0' }, children: '加载中…' })
        : listQ.isError
          ? jsxs('div', {
              style: {
                border: '1px dashed var(--ui-red)', borderRadius: '10px',
                padding: '18px', textAlign: 'center', color: 'var(--ui-red)', fontSize: '13px',
              },
              children: [
                jsx('div', { children: `后端不可达: ${String(listQ.error && listQ.error.message || listQ.error)}` }),
                jsx('div', {
                  style: { marginTop: '8px', fontSize: '12px', color: 'var(--ui-text-tertiary)' },
                  children: 'plugin_api.py 挂载于 hermes serve 进程; 检查 config.yaml plugins.enabled 与后端重启时机',
                }),
              ],
            })
          : items.length === 0
            ? jsx('div', {
                style: {
                  border: '1px dashed var(--ui-stroke-secondary)', borderRadius: '10px',
                  padding: '36px', textAlign: 'center', color: 'var(--ui-text-tertiary)', fontSize: '13px',
                },
                children: '队列干净 —— 没有待审的技能或记忆写入',
              })
            : jsxs('div', {
                style: { display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '24px' },
                children: [
                  jsx('span', { style: { fontSize: '11.5px', color: 'var(--ui-text-tertiary)' },
                    children: `${shown.length} 项待审` }),
                  ...shown.map(it => jsx(Card, { it, key: it.sub + ':' + it.id })),
                ],
              }),
    ],
  })
}

export default {
  id: 'hermes-pending-board',
  name: '审批台',
  description: '技能与记忆暂存写入的审阅: unified diff、通过/拒绝',
  defaultEnabled: true,
  register(ctx) {
    _rest = (path, opts) => ctx.rest(path, opts)
    const nav = (path) => host.navigate(path)
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: '/hermes-pending-board' },
        render: () => jsx(PendingBoardPage, {}) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: 45,
        data: { path: '/hermes-pending-board', label: '审批台', codicon: 'pass-filled' } },
      { id: 'count', area: STATUSBAR_AREAS.right, order: 130,
        render: () => jsx(PendingCount, { navigate: nav }) },
    ])
  },
}
