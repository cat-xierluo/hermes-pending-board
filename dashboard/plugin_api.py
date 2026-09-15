"""pending-board 插件 — Hermes 原生 pending skills/memory 写入的审批台后端路由。

挂载于 /api/plugins/pending-board/*，随桌面端 serve / dashboard 进程运行，
无需单独的 localhost 服务。审批语义与官方 /skills|/memory approve|reject 完全
一致（hermes_cli.write_approval_commands 同一实现）：
  approve = apply_skill_pending()/apply_memory_pending() 重放落盘 + discard_pending
  reject  = discard_pending
"""
from __future__ import annotations

import difflib
import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from tools import write_approval as wa
from hermes_cli.write_approval_commands import _approve, _reject

router = APIRouter()
_lock = threading.Lock()  # 审批操作串行化


class ActBody(BaseModel):
    action: str   # approve | reject
    sub: str      # skills | memory
    id: str


def _diff_ops(payload: Dict[str, Any]) -> List[str]:
    """batch 记录逐 op 展开；单 op 记录直接渲染。"""
    if payload.get("action") == "batch":
        ops = payload.get("operations") or []
        out: List[str] = []
        for i, op in enumerate(ops, 1):
            head = f"── op {i}/{len(ops)}: {op.get('action')} on {op.get('name', '')}"
            if op.get("file_path"):
                head += f" ({op.get('file_path')})"
            out.append(head + " " + "─" * 20)
            out.extend(wa.skill_pending_diff({"payload": op}).splitlines())
            out.append("")
        return out
    return wa.skill_pending_diff({"payload": payload}).splitlines()


def _memory_diff(record: Dict[str, Any]) -> List[str]:
    p = record.get("payload", {})
    op = p.get("action")
    if op == "replace":
        return [f"── 旧记忆 {'─' * 40}", p.get("old_text", ""), "",
                f"── 新记忆 {'─' * 40}", p.get("content", "")]
    if op == "batch":
        parts = []
        for o in p.get("operations", []):
            parts.append(f"[{o.get('action')}] {str(o.get('old_text') or o.get('content', ''))[:80]}")
        return parts
    return [f"[{op}] {p.get('content', '')}"]


def _target_path(record: Dict[str, Any]) -> str:
    p = record.get("payload", {})
    action, name = p.get("action"), p.get("name", "")
    if action == "batch":
        ops = p.get("operations") or []
        if ops:
            action, name = ops[0].get("action"), ops[0].get("name", "")
        else:
            action, name = None, ""
    if not name:
        return "~/.hermes/memories/"
    if action in ("create", "edit", "patch"):
        sub = (p.get("file_path") or "SKILL.md") if action != "edit" else "SKILL.md"
        return f"~/.hermes/skills/personal/{name}/{sub}"
    return f"~/.hermes/skills/personal/{name}/"


@router.get("/pending")
def list_pending() -> Dict[str, Any]:
    out = []
    for sub in (wa.SKILLS, wa.MEMORY):
        for rec in wa.list_pending(sub):
            p = rec.get("payload", {})
            ops = p.get("operations")
            if sub == wa.SKILLS and ops:
                op_desc = " + ".join(
                    o.get("action", "") + (f":{o['file_path']}" if o.get("file_path") else "")
                    for o in ops)
                name = ops[0].get("name") or "?"
            else:
                op_desc = p.get("action", "?")
                name = p.get("name") or ("USER.md" if p.get("target") == "user" else "MEMORY.md")
            out.append({
                "id": rec["id"], "sub": sub, "name": name, "ops": op_desc,
                "summary": rec.get("summary", ""), "origin": rec.get("origin", ""),
                "ts": rec.get("created_at", 0), "target": _target_path(rec),
            })
    out.sort(key=lambda r: r["ts"])
    return {"items": out}


@router.get("/gates")
def gates() -> Dict[str, Any]:
    return {"skills": wa.write_approval_enabled(wa.SKILLS),
            "memory": wa.write_approval_enabled(wa.MEMORY)}


@router.get("/diff/{sub}/{pid}")
def diff(sub: str, pid: str) -> Dict[str, Any]:
    rec = wa.get_pending(sub, pid)
    if not rec:
        return {"error": "not found"}
    lines = _diff_ops(rec.get("payload", {})) if sub == wa.SKILLS else _memory_diff(rec)
    return {"id": pid, "sub": sub, "lines": lines}


@router.post("/act")
def act(body: ActBody) -> Dict[str, Any]:
    if body.action not in ("approve", "reject") or body.sub not in (wa.SKILLS, wa.MEMORY):
        return {"ok": False, "output": "bad request"}
    with _lock:
        if body.action == "approve" and body.sub == wa.MEMORY:
            from tools.memory_tool import load_on_disk_store
            out = _approve(body.sub, [body.id], memory_store=load_on_disk_store())
        elif body.action == "approve":
            out = _approve(body.sub, [body.id], memory_store=None)
        else:
            out = _reject(body.sub, [body.id])
    ok = ("Failed" not in out) and ("Rejected" in out or "Approved" in out)
    return {"ok": ok, "output": out}
