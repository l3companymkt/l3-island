// Claude Island — interface (ilha no PC e página no celular)
(() => {
  // ---------- token / modo ----------
  const qs = new URLSearchParams(location.search);
  let token = qs.get('token');
  try {
    if (token) localStorage.setItem('island_token', token);
    else token = localStorage.getItem('island_token');
  } catch {}
  if (qs.has('token')) history.replaceState(null, '', location.pathname);

  const isIsland = !!window.islandBridge;
  document.body.classList.add(isIsland ? 'mode-island' : 'mode-page');

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (p, body) => fetch(p, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());

  // ---------- formatação ----------
  const bytes = b => { if (b == null) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`; };
  const rate = b => bytes(b) + '/s';
  const tok = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n || 0);
  const ago = t => { const s = (Date.now() - t) / 1000; if (s < 60) return 'agora'; if (s < 3600) return `há ${Math.floor(s / 60)} min`; if (s < 86400) return `há ${Math.floor(s / 3600)} h`; return `há ${Math.floor(s / 86400)} d`; };
  const dur = ms => { if (ms <= 0) return '0 min'; const m = Math.round(ms / 60000); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}min` : `${m} min`; };
  const hhmm = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const level = (v, warn = 60, bad = 85) => v == null ? 'var(--dim)' : v >= bad ? 'var(--bad)' : v >= warn ? 'var(--warn)' : 'var(--good)';
  const STATUS = { working: 'trabalhando', waiting: 'aguardando você', idle: 'parado', ended: 'encerrada' };

  // ---------- estado ----------
  const S = { system: null, claude: null, media: null, weather: null, permissions: [], config: null };
  let tab = 'system', islandMode = 'compact';

  // ---------- modos da ilha ----------
  const island = $('#island');
  function setMode(m) {
    if (!isIsland) return;
    if (S.permissions.length && m === 'compact') m = 'alert';
    if (m === islandMode) return;
    const prev = islandMode; islandMode = m;
    const growing = (m === 'expanded') || (m === 'alert' && prev === 'compact');
    if (growing) window.islandBridge.resize(m);
    requestAnimationFrame(() => {
      island.classList.toggle('expanded', m === 'expanded');
      island.classList.toggle('alert-on', m === 'alert');
      island.classList.toggle('compact', m === 'compact');
    });
    if (!growing) setTimeout(() => { if (islandMode === m) window.islandBridge.resize(m); }, 480);
    if (m === 'expanded') render();
  }
  $('#pill').addEventListener('click', () => setMode('expanded'));
  $('#btnCollapse').addEventListener('click', () => setMode('compact'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMode('compact'); });
  if (isIsland) window.islandBridge.onCommand(cmd => {
    if (cmd === 'expand') setMode('expanded');
    if (cmd === 'collapse') setMode(S.permissions.length ? 'alert' : 'compact');
    if (cmd === 'pair') { setMode('expanded'); showTab('settings'); }
  });

  // ---------- abas ----------
  function showTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.views section').forEach(s => s.classList.toggle('on', s.dataset.view === t));
    render();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  // ---------- componentes ----------
  const ring = (v, label, extra, warn, bad) => {
    const r = 31, c = 2 * Math.PI * r, val = v == null ? 0 : Math.max(0, Math.min(100, v));
    return `<div class="gauge"><div class="ring"><svg viewBox="0 0 74 74"><circle class="bg" cx="37" cy="37" r="${r}"/>
      <circle class="fg" cx="37" cy="37" r="${r}" stroke="${level(v, warn, bad)}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - val / 100)}"/></svg>
      <b><span>${v == null ? '—' : Math.round(v) + '<small style="font-size:10px;color:var(--muted)">%</small>'}</span></b></div>
      <div class="lbl">${label}</div><div class="extra">${extra || '&nbsp;'}</div></div>`;
  };
  const bar = (pct, color, big) => `<div class="bar${big ? ' big' : ''}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%;background:${color}"></i></div>`;

  function spark(canvas, series, colors, max) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d'); g.scale(dpr, dpr);
    const top = max || Math.max(1, ...series.flat());
    series.forEach((data, k) => {
      if (!data.length) return;
      const step = w / Math.max(1, 59);
      const off = w - (data.length - 1) * step;
      g.beginPath();
      data.forEach((v, i) => { const x = off + i * step, y = h - 2 - (v / top) * (h - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = colors[k]; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
      g.lineTo(w, h); g.lineTo(off, h); g.closePath();
      const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, colors[k] + '40'); grad.addColorStop(1, colors[k] + '00');
      g.fillStyle = grad; g.fill();
    });
  }

  // ---------- views ----------
  function renderSystem() {
    const s = S.system; const el = $('#vSystem');
    if (!s) { el.innerHTML = '<div class="empty">Coletando dados…</div>'; return; }
    const w = S.config?.widgets || {};
    const cpuColor = getComputedStyle(document.body).getPropertyValue('--blue').trim() || '#2f6bff';
    let html = `<div class="grid3">
      ${ring(s.cpu.load, 'CPU', s.cpu.temp != null ? `${s.cpu.temp}°C` : `${s.static?.cores || ''} núcleos`)}
      ${ring(s.mem.pct, 'Memória', `${bytes(s.mem.used)} / ${bytes(s.mem.total)}`, 70, 90)}
      ${s.gpu && s.gpu.load != null ? ring(s.gpu.load, 'GPU', s.gpu.temp != null ? `${s.gpu.temp}°C` : '') :
        s.battery ? ring(s.battery.pct, 'Bateria', s.battery.charging ? 'carregando' : 'na bateria', 101, 101) :
        ring(s.mem.swapPct, 'Swap', '', 40, 75)}
    </div>
    <div class="card"><h3>CPU · últimos 2 min <span>${esc(s.static?.cpu || '')}</span></h3>
      <canvas class="spark" id="cpuSpark"></canvas>
      <div class="cores">${s.cpu.cores.map(c => `<i style="height:${Math.max(8, c)}%;background:${level(c)}"></i>`).join('')}</div>
    </div>`;
    if (w.network) html += `<div class="card"><h3>Rede <span><span style="color:#5b8cff">↓ ${rate(s.net.rx)}</span> · <span style="color:#9aa3b2">↑ ${rate(s.net.tx)}</span></span></h3>
      <canvas class="spark" id="netSpark"></canvas></div>`;
    if (w.disks && s.disks.length) html += `<div class="card"><h3>Discos</h3><div class="list">${s.disks.map(d => `
      <div><div class="row" style="margin-bottom:6px"><span>${esc(d.name)}</span><span class="muted num">${bytes(d.used)} / ${bytes(d.size)}</span></div>
      ${bar(d.pct, level(d.pct, 80, 92))}</div>`).join('')}</div></div>`;
    if (w.processes && s.processes.length) html += `<div class="card"><h3>Processos que mais usam CPU</h3><div class="list">${s.processes.map(p => `
      <div class="row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
      <span class="num" style="color:${level(p.cpu, 30, 70)}">${p.cpu.toFixed(1)}%</span></div>`).join('')}</div></div>`;
    html += `<div class="kv" style="padding:0 4px 6px"><div><span>Ligado há </span><b>${dur(s.uptime * 1000)}</b></div><div><span>Sistema </span><b>${esc(s.static?.os || '')}</b></div></div>`;
    el.innerHTML = html;
    spark($('#cpuSpark'), [s.history.cpu], [cpuColor], 100);
    spark($('#netSpark'), [s.history.rx, s.history.tx], ['#5b8cff', '#6b7280']);
  }

  const TOOL_ICON = {
    Bash: '<svg viewBox="0 0 24 24"><path d="M4 17l6-5-6-5M12 19h8"/></svg>',
    Edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    default: '<svg viewBox="0 0 24 24"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>',
  };
  TOOL_ICON.Write = TOOL_ICON.MultiEdit = TOOL_ICON.Edit;

  const permCard = p => `<div class="perm" data-id="${esc(p.id)}">
    <div class="row"><b>${esc(p.tool)}</b><span class="chip">${esc(p.project || '')}</span></div>
    ${p.description ? `<div class="muted" style="margin-top:4px;font-size:12px">${esc(p.description)}</div>` : ''}
    <code>${esc(p.detail)}</code>
    <div class="actions"><button class="btn danger" data-d="deny">Negar</button><button class="btn ghost" data-d="ask" title="Responder no terminal">Terminal</button><button class="btn primary" data-d="allow">Permitir</button></div>
  </div>`;

  function renderClaude() {
    const c = S.claude; const el = $('#vClaude');
    if (!c) { el.innerHTML = '<div class="empty">Lendo sessões…</div>'; return; }
    let html = '';
    if (S.permissions.length) html += S.permissions.map(permCard).join('');
    const b = c.block, preset = S.config?.presets?.[c.plan];
    const now = Date.now();
    html += `<div class="card"><h3>Janela de 5 horas <span>${esc(preset?.label || '')} · estimativa</span></h3>`;
    if (b.active) {
      const proj = b.etaLimit ? `<span style="color:var(--bad)">limite previsto às ${hhmm(b.etaLimit)}</span>` : `<span style="color:var(--good)">dentro do limite até reiniciar</span>`;
      html += `<div class="row" style="align-items:flex-end;margin-bottom:8px"><div><div class="big num">${b.pct}%</div><div class="muted">${tok(b.tokens)} de ~${tok(c.limits.block)} tokens</div></div>
        <div style="text-align:right"><div class="num">reinicia em <b>${dur(b.end - now)}</b></div><div class="muted" style="font-size:11.5px">às ${hhmm(b.end)}</div></div></div>
        ${bar(b.pct, level(b.pct, 70, 90), true)}
        <div class="row" style="margin-top:8px;font-size:11.5px"><span class="muted">${tok(b.perMin)}/min agora</span>${proj}</div>`;
    } else html += `<div class="muted">Nenhuma janela ativa. Ela começa na sua próxima mensagem ao Claude.</div>`;
    html += `</div>
      <div class="card"><h3>Semana (7 dias) <span>${tok(c.weekly.tokens)} de ~${tok(c.limits.weekly)}</span></h3>
        ${bar(c.weekly.pct, level(c.weekly.pct, 70, 90), true)}
        <div style="margin-top:12px" class="hours">${c.hours.map((v, i) => { const m = Math.max(1, ...c.hours); return `<i class="${i === 23 ? 'now' : ''}" style="height:${Math.max(4, v / m * 100)}%" title="${tok(v)}"></i>`; }).join('')}</div>
        <div class="row dim" style="font-size:10.5px;margin-top:4px"><span>24h atrás</span><span>agora</span></div>
      </div>
      <div class="card"><h3>Sessões <span>${c.sessions.filter(s => s.status === 'working' || s.status === 'waiting').length} ativas</span></h3>`;
    html += c.sessions.length ? `<div class="list">${c.sessions.map(s => `<div class="sess">
        <span class="dot ${s.status}"></span>
        <div style="flex:1;min-width:0">
          <div class="row"><span class="name">${esc(s.project)}</span><span class="meta">${ago(s.last)}</span></div>
          <div class="meta">${STATUS[s.status] || s.status}${s.branch ? ' · ' + esc(s.branch) : ''}${s.model ? ' · ' + esc(s.model.replace(/^claude-/, '')) : ''} · ${tok(s.tokens)}</div>
          ${s.detail && s.status === 'waiting' ? `<div class="msg" style="color:var(--warn)">${esc(s.detail)}</div>` : ''}
          ${s.lastPrompt ? `<div class="msg">› ${esc(s.lastPrompt)}</div>` : ''}
        </div></div>`).join('')}</div>` : '<div class="empty">Nenhuma sessão nos últimos 3 dias.</div>';
    html += '</div>';
    el.innerHTML = html;
  }

  function renderWidgets() {
    const el = $('#vWidgets'); const w = S.config?.widgets || {};
    let html = '';
    if (w.clock) {
      const d = new Date();
      html += `<div class="card"><div class="row"><div><div class="bigclock num" id="bigClock">${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
        <div class="muted" style="margin-top:6px">${(x => x[0].toUpperCase() + x.slice(1))(d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div></div></div>`;
    }
    if (w.music) {
      const m = S.media;
      html += `<div class="card"><h3>Tocando agora <span>${esc(m?.app ? m.app.replace(/\.exe$|!.*$/i, '').split('.').pop() : '')}</span></h3>
        <div class="music"><div class="art"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <div class="info">${m ? `<div style="font-weight:600">${esc(m.title)}</div><div class="muted">${esc(m.artist || '')}</div><div class="dim" style="font-size:11px">${esc(m.album || '')}</div>` : '<div class="muted">Nada tocando</div>'}</div></div>
        <div class="controls">
          <button data-m="prev"><svg viewBox="0 0 24 24"><path d="M19 20L9 12l10-8zM5 19V5"/></svg></button>
          <button data-m="toggle" class="main">${m?.playing ? '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>'}</button>
          <button data-m="next"><svg viewBox="0 0 24 24"><path d="M5 4l10 8-10 8zM19 5v14"/></svg></button>
        </div></div>`;
    }
    if (w.weather) {
      const x = S.weather;
      html += `<div class="card"><h3>Tempo <span>${esc(x?.city || '')}</span></h3>`;
      if (x) {
        html += `<div class="weather-now"><div class="ic">${x.icon}</div><div><div class="big num">${x.temp}°</div><div class="muted">${esc(x.label)} · sensação ${x.feels}°</div></div>
          <div style="margin-left:auto;text-align:right;font-size:11.5px" class="muted">💧 ${x.humidity}%<br>💨 ${x.wind} km/h</div></div>
          <div class="days">${x.days.map(d => `<div><div class="dim">${new Date(d.date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</div>
            <div style="font-size:18px;margin:3px 0">${d.icon}</div><div class="num"><b>${d.max}°</b> <span class="dim">${d.min}°</span></div>
            <div class="num" style="color:#5b8cff;font-size:10.5px">${d.rain ?? 0}%</div></div>`).join('')}</div>`;
      } else html += `<div class="muted">Defina sua cidade em Ajustes (⚙).</div>`;
      html += '</div>';
    }
    if (!html) html = '<div class="empty">Ative widgets em Ajustes.</div>';
    el.innerHTML = html;
  }

  let pairInfo = null;
  function renderSettings() {
    const c = S.config; const el = $('#vSettings');
    if (!c) return;
    if (el.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return; // não atrapalhar quem está digitando
    const sw = (k, on) => `<label class="switch"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span></span></label>`;
    const W = { clock: 'Relógio', weather: 'Tempo', music: 'Música', network: 'Rede', disks: 'Discos', processes: 'Processos' };
    el.innerHTML = `
    <div class="card"><h3>Limites do Claude</h3>
      <div class="field"><label>Plano<small>Os limites são estimativas</small></label>
        <select id="plan">${Object.entries(c.presets).map(([k, p]) => `<option value="${k}" ${k === c.plan ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Janela de 5h<small>milhões de tokens</small></label><input type="number" id="limBlock" min="1" step="1" value="${Math.round(c.limits.block / 1e6)}"></div>
      <div class="field"><label>Semana<small>milhões de tokens</small></label><input type="number" id="limWeekly" min="1" step="10" value="${Math.round(c.limits.weekly / 1e6)}"></div>
      <div class="actions" style="margin-top:8px"><button class="btn" id="calBlock">Bati o limite de 5h agora</button><button class="btn" id="calWeekly">Bati o limite semanal</button></div>
      <div class="note">Quando o Claude avisar que você chegou no limite, toque no botão: o painel aprende o seu limite real.</div>
    </div>
    <div class="card"><h3>Permissões</h3>
      <div class="field"><label>Esperar minha resposta<small>depois disso a pergunta volta pro terminal</small></label><input type="number" id="wait" min="10" max="3600" value="${c.permissionWaitSeconds}" style="width:90px"></div>
      <div class="field"><label>Abrir junto com o Claude<small>quando uma sessão do Claude Code começa</small></label>${sw('autoLaunch', c.autoLaunch)}</div>
      ${isIsland ? `<div class="field"><label>Iniciar com o computador</label>${sw('login', false)}</div>` : ''}
    </div>
    <div class="card"><h3>Widgets</h3>
      <div class="field"><label>Cidade (tempo)</label><input type="text" id="city" placeholder="ex.: São Paulo" value="${esc(c.weather.city)}"></div>
      ${Object.entries(W).map(([k, l]) => `<div class="field"><label>${l}</label>${sw('w.' + k, c.widgets[k])}</div>`).join('')}
    </div>
    <div class="card"><h3>Celular <span>mesma rede Wi‑Fi</span></h3>
      ${c.lanAccess ? `<div class="qr" id="qr">${pairInfo ? pairInfo.svg : ''}</div><div class="link" id="pairLink">${pairInfo ? esc(pairInfo.url) : 'gerando…'}</div>
        <div class="note">Aponte a câmera do celular. O link tem uma chave secreta: não compartilhe.</div>` : '<div class="muted">Acesso pela rede desligado.</div>'}
      <div class="field" style="margin-top:6px"><label>Permitir acesso pela rede<small>reinicie o app para aplicar</small></label>${sw('lanAccess', c.lanAccess)}</div>
    </div>
    ${isIsland ? `<div class="actions" style="padding-bottom:6px"><button class="btn" id="openBrowser">Abrir no navegador</button><button class="btn danger" id="quit">Sair</button></div>
      <div class="note" style="text-align:center;padding-bottom:8px">Atalho: Ctrl+Alt+Espaço abre e fecha a ilha</div>` : ''}`;
    if (c.lanAccess && !pairInfo) api('/api/pair').then(r => { pairInfo = r; const q = $('#qr'); if (q) { q.innerHTML = r.svg; $('#pairLink').textContent = r.url; } });
  }

  const saveCfg = body => api('/api/config', body).then(r => { if (r.error) alert(r.error); else { S.config = { ...S.config, ...r }; render(true); } });
  $('#vSettings').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'plan') saveCfg({ plan: t.value });
    else if (t.id === 'limBlock') saveCfg({ plan: 'custom', limits: { block: Number(t.value) * 1e6 } });
    else if (t.id === 'limWeekly') saveCfg({ plan: 'custom', limits: { weekly: Number(t.value) * 1e6 } });
    else if (t.id === 'wait') saveCfg({ permissionWaitSeconds: Number(t.value) });
    else if (t.id === 'city') saveCfg({ city: t.value });
    else if (t.dataset.k === 'login') window.islandBridge?.setLoginItem(t.checked);
    else if (t.dataset.k?.startsWith('w.')) saveCfg({ widgets: { [t.dataset.k.slice(2)]: t.checked } });
    else if (t.dataset.k) saveCfg({ [t.dataset.k]: t.checked });
  });
  $('#vSettings').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'calBlock' || id === 'calWeekly') {
      if (confirm('Usar o consumo atual como seu limite real?')) api('/api/usage/calibrate', { which: id === 'calBlock' ? 'block' : 'weekly' }).then(r => { S.config = { ...S.config, ...r }; render(true); });
    }
    if (id === 'openBrowser') window.islandBridge.openExternal();
    if (id === 'quit') window.islandBridge.quit();
  });
  $('#vWidgets').addEventListener('click', e => {
    const b = e.target.closest('[data-m]');
    if (b) api('/api/media', { cmd: b.dataset.m }).then(m => { S.media = m; renderWidgets(); });
  });

  // decisões de permissão (lista e alerta)
  function decide(id, decision) {
    S.permissions = S.permissions.filter(p => p.id !== id);
    render(); renderAlert();
    api(`/api/permissions/${encodeURIComponent(id)}`, { decision });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const card = b.closest('[data-id]'); if (card) decide(card.dataset.id, b.dataset.d);
  });

  // ---------- alerta (estilo "chamada recebida") ----------
  let alertTimer;
  function renderAlert() {
    const el = $('#alert');
    const p = S.permissions[0];
    clearInterval(alertTimer);
    if (!p) { if (islandMode === 'alert') setMode('compact'); return; }
    el.innerHTML = `<div class="head" data-id="${esc(p.id)}"><div class="ico">${TOOL_ICON[p.tool] || TOOL_ICON.default}</div>
      <div style="flex:1;min-width:0"><div class="t">Claude quer usar ${esc(p.tool)}</div><div class="s">${esc(p.project || '')}${S.permissions.length > 1 ? ` · 1 de ${S.permissions.length}` : ''}${p.description ? ' · ' + esc(p.description) : ''}</div></div></div>
      <code>${esc(p.detail)}</code>
      <div class="timer"><i id="alertBar"></i></div>
      <div class="actions" data-id="${esc(p.id)}"><button class="btn danger" data-d="deny">Negar</button><button class="btn ghost" data-d="ask">Terminal</button><button class="btn primary" data-d="allow">Permitir</button></div>`;
    const tick = () => { const b = $('#alertBar'); if (b) b.style.width = Math.max(0, (p.expires - Date.now()) / (p.expires - p.at) * 100) + '%'; };
    tick(); alertTimer = setInterval(tick, 1000);
    if (islandMode !== 'expanded') setMode('alert');
  }

  // ---------- pílula ----------
  function renderPill() {
    const s = S.system, c = S.claude;
    if (s) { const el = $('#pillCpu'); el.textContent = `${s.cpu.load}%`; el.style.color = level(s.cpu.load); }
    let status = 'idle', label = 'Claude Island';
    if (c) {
      const act = c.sessions.filter(x => x.status === 'working' || x.status === 'waiting');
      if (S.permissions.length) { status = 'waiting'; label = 'Precisa de você'; }
      else if (act.some(x => x.status === 'waiting')) { status = 'waiting'; label = act.find(x => x.status === 'waiting').project; }
      else if (act.length) { status = 'working'; label = act.length > 1 ? `${act.length} sessões` : act[0].project; }
      else if (c.block.active) label = `Claude · ${c.block.pct}%`;
      else label = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    $('#pillDot').className = 'dot ' + status;
    $('#pillLabel').textContent = label;
    $('#pillWave').classList.toggle('on', status === 'working');
  }

  // ---------- render ----------
  function render(force) {
    renderPill();
    const badge = $('#permBadge'); badge.textContent = S.permissions.length; badge.classList.toggle('on', S.permissions.length > 0);
    if (isIsland && islandMode !== 'expanded' && !force) return;
    if (tab === 'system') renderSystem();
    if (tab === 'claude') renderClaude();
    if (tab === 'widgets') renderWidgets();
    if (tab === 'settings') renderSettings();
  }
  function clock() {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const bc = $('#bigClock'); if (bc) bc.textContent = $('#clock').textContent;
  }
  setInterval(clock, 1000); clock();

  // aviso no celular: vibração + bip
  function ping() {
    if (isIsland) return;
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch {}
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(.08, a.currentTime); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + .35);
      o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + .35);
    } catch {}
    document.title = `(${S.permissions.length}) Claude precisa de você`;
  }

  // ---------- tempo real ----------
  function connect() {
    if (!token) { $('#vSystem').innerHTML = '<div class="empty">Abra pelo link com a chave (QR code no app do PC).</div>'; return; }
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('open', () => $('#conn').classList.add('ok'));
    es.addEventListener('error', () => $('#conn').classList.remove('ok'));
    es.addEventListener('snapshot', e => {
      Object.assign(S, JSON.parse(e.data));
      $('#hostLine').textContent = `${S.config?.host || ''}${isIsland ? '' : ' · remoto'}`;
      render(true); renderAlert();
    });
    es.addEventListener('system', e => { S.system = JSON.parse(e.data); renderPill(); if (tab === 'system') render(); });
    es.addEventListener('claude', e => { S.claude = JSON.parse(e.data); renderPill(); if (tab === 'claude') render(); });
    es.addEventListener('media', e => { S.media = JSON.parse(e.data); if (tab === 'widgets') render(); });
    es.addEventListener('weather', e => { S.weather = JSON.parse(e.data); if (tab === 'widgets') render(); });
    es.addEventListener('config', e => { S.config = { ...S.config, ...JSON.parse(e.data) }; if (tab === 'settings' || tab === 'widgets') render(); });
    es.addEventListener('permissions', e => {
      const prev = S.permissions.length;
      S.permissions = JSON.parse(e.data);
      if (S.permissions.length > prev) ping();
      if (!S.permissions.length && !isIsland) document.title = 'Claude Island';
      render(true); renderAlert();
    });
  }
  connect();
})();
