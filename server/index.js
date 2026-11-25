// Servidor local do L3 Island: API + eventos em tempo real (SSE) + arquivos da interface.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const config = require('./config');
const system = require('./system');
const claude = require('./claude');
const permissions = require('./permissions');
const media = require('./media');
const weather = require('./weather');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function lanIp() {
  const all = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal);
  const pick = all.find(i => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address)) || all[0];
  return pick ? pick.address : '127.0.0.1';
}

function start() {
  const cfg = config.load();
  const bus = new EventEmitter();
  const clients = new Set();
  const store = { system: null, claude: null, media: null, weather: null, permissions: [] };

  const send = (type, data) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
    bus.emit(type, data);
  };
  const publicCfg = () => ({
    plan: cfg.plan, limits: cfg.limits, presets: config.PLAN_PRESETS, weather: { city: cfg.weather.city },
    widgets: cfg.widgets, permissionWaitSeconds: cfg.permissionWaitSeconds, autoLaunch: cfg.autoLaunch,
    lanAccess: cfg.lanAccess, host: os.hostname(),
  });

  // --- coletores -----------------------------------------------------------
  system.start(s => { store.system = s; send('system', s); });

  const refreshClaude = () => { claude.scan(); store.claude = claude.snapshot(cfg); send('claude', store.claude); };
  refreshClaude();
  setInterval(refreshClaude, 3000);

  permissions.bus.on('change', list => { store.permissions = list; send('permissions', list); });
  permissions.bus.on('new', req => bus.emit('permission-new', req));

  let lastMedia = '';
  const refreshMedia = async (cmd) => {
    if (!cfg.widgets.music) return;
    const m = await media.command(cmd);
    const key = JSON.stringify(m);
    if (key !== lastMedia || cmd) { lastMedia = key; store.media = m; send('media', m); }
  };
  refreshMedia();
  setInterval(() => refreshMedia(), 4000);

  const refreshWeather = async () => {
    if (!cfg.widgets.weather) return;
    try { store.weather = await weather.fetchWeather(cfg.weather); send('weather', store.weather); } catch { /* sem internet */ }
  };
  refreshWeather();
  setInterval(refreshWeather, 15 * 60e3);

  // --- http ----------------------------------------------------------------
  let tokenBuf = Buffer.from(cfg.token);
  const authed = (req, url) => {
    const h = req.headers.authorization || '';
    const t = (h.startsWith('Bearer ') ? h.slice(7) : '') || req.headers['x-island-token'] || url.searchParams.get('token') || '';
    const b = Buffer.from(String(t));
    return b.length === tokenBuf.length && crypto.timingSafeEqual(b, tokenBuf);
  };
  const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const body = req => new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) { req.destroy(); reject(new Error('too large')); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (!p.startsWith('/api/')) {
        const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
        if (!file.startsWith(PUBLIC)) return json(res, 403, {});
        return fs.readFile(file, (err, data) => {
          if (err) { res.writeHead(404); return res.end(); }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
          res.end(data);
        });
      }
      if (p === '/api/health') return json(res, 200, { ok: true, app: 'l3-island' });
      if (!authed(req, url)) return json(res, 401, { error: 'token inválido' });

      if (p === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`event: snapshot\ndata: ${JSON.stringify({ ...store, config: publicCfg() })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (p === '/api/state') return json(res, 200, { ...store, config: publicCfg() });

      if (p === '/api/pair') {
        const link = `http://${lanIp()}:${cfg.port}/?token=${cfg.token}`;
        const svg = await require('qrcode').toString(link, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
        return json(res, 200, { url: link, svg, lanAccess: cfg.lanAccess });
      }
      if (req.method !== 'POST') return json(res, 404, {});
      const data = await body(req);

      if (p === '/api/hook/event') {
        claude.hookEvent(data);
        if (data.hook_event_name === 'Notification') bus.emit('notification', data);
        refreshClaude();
        return json(res, 200, { ok: true });
      }
      if (p === '/api/hook/permission') {
        claude.hookEvent({ ...data, hook_event_name: 'PermissionRequest' });
        refreshClaude();
        const wait = Math.max(10, cfg.permissionWaitSeconds) * 1000;
        const { id, promise } = permissions.request(data, wait);
        req.on('close', () => { if (!res.writableEnded) permissions.cancel(id); });
        res.on('close', () => { if (!res.writableEnded) permissions.cancel(id); });
        const result = await promise;
        refreshClaude();
        return json(res, 200, result);
      }
      if (p.startsWith('/api/permissions/')) {
        const id = p.split('/').pop();
        const decision = ['allow', 'deny', 'ask'].includes(data.decision) ? data.decision : 'ask';
        const ok = permissions.finish(id, { decision, message: decision === 'deny' ? (data.message || 'Negado pelo L3 Island.') : undefined });
        return json(res, ok ? 200 : 404, { ok });
      }
      if (p === '/api/quit') {
        json(res, 200, { ok: true });
        setTimeout(() => (bus.listenerCount('quit') ? bus.emit('quit') : process.exit(0)), 200);
        return;
      }
      if (p === '/api/token/rotate') {
        // só no próprio computador: o celular não pode trocar a chave (e trancar o PC para fora)
        const ip = req.socket.remoteAddress || '';
        if (!/^(127\.|::1$|::ffff:127\.)/.test(ip)) return json(res, 403, { error: 'Gere uma nova chave no computador.' });
        cfg.token = crypto.randomBytes(24).toString('hex');
        tokenBuf = Buffer.from(cfg.token);
        config.save(cfg);
        json(res, 200, { token: cfg.token });
        for (const c of clients) c.end(); // derruba conexões com a chave antiga (celulares)
        clients.clear();
        return;
      }
      if (p === '/api/media') { await refreshMedia(String(data.cmd || 'get')); return json(res, 200, store.media); }
      if (p === '/api/usage/calibrate') {
        const snap = claude.snapshot(cfg);
        if (data.which === 'weekly' && snap.weekly.tokens > 0) cfg.limits.weekly = snap.weekly.tokens;
        else if (snap.block.tokens > 0) cfg.limits.block = snap.block.tokens;
        cfg.plan = 'custom';
        config.save(cfg); refreshClaude(); send('config', publicCfg());
        return json(res, 200, publicCfg());
      }
      if (p === '/api/config') {
        if (data.plan && config.PLAN_PRESETS[data.plan]) {
          cfg.plan = data.plan;
          if (data.plan !== 'custom') cfg.limits = { block: config.PLAN_PRESETS[data.plan].block, weekly: config.PLAN_PRESETS[data.plan].weekly };
        }
        if (data.limits) for (const k of ['block', 'weekly']) if (Number(data.limits[k]) > 0) cfg.limits[k] = Number(data.limits[k]);
        if (data.widgets) for (const k of Object.keys(cfg.widgets)) if (k in data.widgets) cfg.widgets[k] = !!data.widgets[k];
        if (Number(data.permissionWaitSeconds) >= 10) cfg.permissionWaitSeconds = Math.min(3600, Number(data.permissionWaitSeconds));
        if ('autoLaunch' in data) cfg.autoLaunch = !!data.autoLaunch;
        if ('lanAccess' in data) cfg.lanAccess = !!data.lanAccess;
        if (typeof data.city === 'string') {
          if (data.city.trim()) { Object.assign(cfg.weather, await weather.geocode(data.city.trim())); }
          else cfg.weather = { city: '', lat: null, lon: null };
          refreshWeather();
        }
        config.save(cfg); refreshClaude(); send('config', publicCfg());
        return json(res, 200, publicCfg());
      }
      return json(res, 404, {});
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });

  const host = cfg.lanAccess ? '0.0.0.0' : '127.0.0.1';
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, host, () => resolve());
  });
  return { cfg, bus, server, ready, get localUrl() { return `http://127.0.0.1:${cfg.port}/?token=${cfg.token}`; }, stop: () => { media.stop(); server.close(); } };
}

module.exports = { start };

if (require.main === module) {
  const s = start();
  s.ready.then(() => {
    console.log(`L3 Island rodando em ${s.localUrl}`);
    if (s.cfg.lanAccess) console.log(`No celular (mesma rede Wi‑Fi): http://${lanIp()}:${s.cfg.port}/?token=${s.cfg.token}`);
  }).catch(e => { console.error('Não consegui iniciar:', e.message); process.exit(1); });
}
