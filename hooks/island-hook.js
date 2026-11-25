#!/usr/bin/env node
// Hook do Claude Code -> Claude Island. Usa só módulos nativos do Node.
// - SessionStart: abre a ilha se ela não estiver aberta (autoLaunch)
// - PermissionRequest: espera você permitir/negar na ilha ou no celular
// - Demais eventos: atualiza o status das sessões
// Se a ilha estiver fechada ou der erro, o hook sai sem resposta e o Claude segue normal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CFG_FILE = path.join(os.homedir(), '.claude-island', 'config.json');

function readStdin() {
  return new Promise(resolve => {
    let b = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => b += c);
    process.stdin.on('end', () => resolve(b));
    setTimeout(() => resolve(b), 3000);
  });
}

function post(cfg, p, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(data));
    const req = http.request({
      host: '127.0.0.1', port: cfg.port, path: p, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, Authorization: `Bearer ${cfg.token}` },
    }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

function health(cfg) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: cfg.port, path: '/api/health', timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function launch(cfg) {
  try {
    const electron = require(path.join(cfg.appDir, 'node_modules', 'electron'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    spawn(electron, [cfg.appDir], { detached: true, stdio: 'ignore', env, windowsHide: false }).unref();
  } catch { /* app não instalado */ }
}

(async () => {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch { process.exit(0); }
  let ev;
  try { ev = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const name = ev.hook_event_name;

  if (name === 'SessionStart') {
    if (cfg.autoLaunch !== false && !(await health(cfg))) {
      launch(cfg);
      for (let i = 0; i < 20 && !(await health(cfg)); i++) await new Promise(r => setTimeout(r, 400));
    }
  }

  if (name === 'PermissionRequest') {
    try {
      const wait = (cfg.permissionWaitSeconds || 300) * 1000 + 5000;
      const r = await post(cfg, '/api/hook/permission', ev, wait);
      if (r && (r.decision === 'allow' || r.decision === 'deny')) {
        const decision = { behavior: r.decision };
        if (r.decision === 'deny') decision.message = r.message || 'Negado pelo Claude Island.';
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
      }
    } catch { /* ilha fechada: o Claude mostra a pergunta normal no terminal */ }
    process.exit(0);
  }

  // nunca escrever no stdout aqui: no SessionStart isso entraria no contexto do Claude
  try { await post(cfg, '/api/hook/event', ev, 1500); } catch {}
  process.exit(0);
})();
