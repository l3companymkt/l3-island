// Atualiza a ilha: baixa a versão nova do GitHub, instala dependências e reabre a ilha.
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const run = cmd => execSync(cmd, { cwd: appDir, stdio: 'inherit' });

run('git pull --ff-only');
run('npm install --no-audit --no-fund');

const cfg = require('../server/config').load();
const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/api/quit', method: 'POST', timeout: 1500,
  headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' } }, res => { res.resume(); setTimeout(reopen, 1500); });
req.on('error', reopen);
req.on('timeout', () => req.destroy());
req.end('{}');

function reopen() {
  console.log('Atualizado.');
  require('./launch');
}
