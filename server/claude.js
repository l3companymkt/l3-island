// Lê as sessões do Claude Code direto dos transcripts locais (~/.claude/projects/**/*.jsonl)
// e calcula o consumo por janela de 5 horas e por semana.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOTS = [
  process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'),
  path.join(os.homedir(), '.claude', 'projects'),
  path.join(os.homedir(), '.config', 'claude', 'projects'),
].filter(Boolean);

const WEEK = 7 * 24 * 3600e3;
const BLOCK = 5 * 3600e3;

const files = new Map();     // path -> { offset, size, mtime, partial, session }
const usage = [];            // { t, tokens, out, model }
const seenMsg = new Set();
const live = new Map();      // session_id -> { status, at, detail } vindo dos hooks

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.find(c => c && c.type === 'text' && c.text);
    if (t) return t.text;
    const tool = content.find(c => c && c.type === 'tool_use');
    if (tool) return `⚙ ${tool.name}`;
  }
  return '';
}
const clip = (s, n = 140) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function ingestLine(line, f) {
  let d;
  try { d = JSON.parse(line); } catch { return; }
  const s = f.session;
  if (d.sessionId) s.id = d.sessionId;
  if (d.cwd) s.cwd = d.cwd;
  if (d.gitBranch) s.branch = d.gitBranch;
  const t = d.timestamp ? Date.parse(d.timestamp) : 0;
  if (t) { s.last = Math.max(s.last || 0, t); s.first = s.first || t; }
  const m = d.message;
  if (!m || typeof m !== 'object' || d.isSidechain) return;
  if (d.type === 'user' && m.role === 'user' && !d.isMeta) {
    const c = m.content;
    const txt = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(x => x && x.type === 'text') || {}).text : '';
    if (txt && !txt.trimStart().startsWith('<')) { s.lastPrompt = clip(txt); s.prompts = (s.prompts || 0) + 1; }
  }
  if (d.type === 'assistant') {
    const txt = textOf(m.content);
    if (txt) s.lastReply = clip(txt);
    if (m.model && m.model !== '<synthetic>') s.model = m.model;
    const u = m.usage;
    const key = (m.id || '') + ':' + (d.requestId || '');
    if (u && t && !seenMsg.has(key)) {
      seenMsg.add(key);
      const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      s.tokens = (s.tokens || 0) + tokens;
      if (Date.now() - t < WEEK + BLOCK) usage.push({ t, tokens, out: u.output_tokens || 0, model: m.model });
    }
  }
}

function readNew(p, st) {
  let f = files.get(p);
  if (!f) { f = { offset: 0, partial: '', session: { file: p } }; files.set(p, f); }
  if (st.size < f.offset) { f.offset = 0; f.partial = ''; }
  if (st.size === f.offset) return false;
  const fd = fs.openSync(p, 'r');
  try {
    const len = st.size - f.offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, f.offset);
    f.offset = st.size;
    const chunk = f.partial + buf.toString('utf8');
    const lines = chunk.split('\n');
    f.partial = lines.pop();
    for (const l of lines) if (l.trim()) ingestLine(l, f);
  } finally { fs.closeSync(fd); }
  f.mtime = st.mtimeMs;
  return true;
}

function scan() {
  let changed = false;
  const cutoff = Date.now() - WEEK - BLOCK;
  for (const root of ROOTS) {
    let dirs;
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      let list;
      try { list = fs.readdirSync(dir); } catch { continue; }
      for (const name of list) {
        if (!name.endsWith('.jsonl')) continue;
        const p = path.join(dir, name);
        let st;
        try { st = fs.statSync(p); } catch { continue; }
        if (st.mtimeMs < cutoff && !files.has(p)) continue;
        try { if (readNew(p, st)) changed = true; } catch { /* arquivo em uso */ }
      }
    }
  }
  // descarta consumo antigo
  const old = Date.now() - WEEK - BLOCK;
  while (usage.length && usage[0].t < old) usage.shift();
  if (changed) usage.sort((a, b) => a.t - b.t);
  return changed;
}

// Janelas de 5h no estilo do Claude: começam na hora cheia da primeira mensagem
// depois que a janela anterior terminou.
function currentBlock(now = Date.now()) {
  let start = null, entries = [];
  for (const e of usage) {
    if (e.t < now - 24 * 3600e3) continue;
    if (start === null || e.t >= start + BLOCK) {
      const d = new Date(e.t); d.setMinutes(0, 0, 0);
      start = d.getTime(); entries = [];
    }
    entries.push(e);
  }
  if (start === null || now >= start + BLOCK) return { active: false, tokens: 0, start: null, end: null };
  const tokens = entries.reduce((s, e) => s + e.tokens, 0);
  const recent = entries.filter(e => e.t > now - 30 * 60e3);
  const span = Math.max(5 * 60e3, Math.min(30 * 60e3, now - (recent[0]?.t || now)));
  const perMin = recent.reduce((s, e) => s + e.tokens, 0) / (span / 60e3);
  return { active: true, tokens, start, end: start + BLOCK, perMin: Math.round(perMin), messages: entries.length };
}

function snapshot(cfg) {
  const now = Date.now();
  const block = currentBlock(now);
  const weekly = usage.filter(e => e.t > now - WEEK).reduce((s, e) => s + e.tokens, 0);
  const lim = cfg.limits;
  let etaLimit = null;
  if (block.active && block.perMin > 0 && lim.block > block.tokens) {
    etaLimit = now + (lim.block - block.tokens) / block.perMin * 60e3;
    if (etaLimit > block.end) etaLimit = null; // não deve bater o limite antes da janela reiniciar
  }
  // últimas 24h por hora, para o gráfico
  const hours = Array(24).fill(0);
  for (const e of usage) {
    const h = Math.floor((now - e.t) / 3600e3);
    if (h >= 0 && h < 24) hours[23 - h] += e.tokens;
  }
  const sessions = [...files.values()].map(f => f.session)
    .filter(s => s.id && s.last && now - s.last < 3 * 24 * 3600e3)
    .sort((a, b) => b.last - a.last).slice(0, 12)
    .map(s => {
      const l = live.get(s.id);
      let status = now - s.last < 90e3 ? 'working' : 'idle';
      if (l && l.at > s.last - 5e3) status = l.status;
      if (l && l.status === 'ended') status = 'ended';
      if (status === 'working' && now - s.last > 10 * 60e3) status = 'idle';
      return {
        id: s.id, project: s.cwd ? path.basename(s.cwd) : '?', cwd: s.cwd, branch: s.branch,
        model: s.model, last: s.last, first: s.first, lastPrompt: s.lastPrompt, lastReply: s.lastReply,
        tokens: s.tokens || 0, status, detail: l && l.detail,
      };
    });
  return {
    plan: cfg.plan, limits: lim,
    block: { ...block, pct: lim.block ? Math.min(100, Math.round(block.tokens / lim.block * 100)) : 0, etaLimit },
    weekly: { tokens: weekly, pct: lim.weekly ? Math.min(100, Math.round(weekly / lim.weekly * 100)) : 0 },
    hours, sessions,
  };
}

function hookEvent(ev) {
  const id = ev.session_id;
  if (!id) return;
  const map = {
    SessionStart: 'idle', UserPromptSubmit: 'working', PreToolUse: 'working', PostToolUse: 'working',
    Stop: 'idle', SubagentStop: 'working', Notification: 'waiting', PermissionRequest: 'waiting', SessionEnd: 'ended',
  };
  const status = map[ev.hook_event_name];
  if (!status) return;
  let detail = null;
  if (ev.hook_event_name === 'Notification') detail = clip(ev.message, 100);
  live.set(id, { status, at: Date.now(), detail });
  if (ev.transcript_path && !files.has(ev.transcript_path)) {
    try { readNew(ev.transcript_path, fs.statSync(ev.transcript_path)); } catch {}
  }
}

module.exports = { scan, snapshot, hookEvent };
