// Atualiza a ilha e reabre.
// - Se a pasta veio do git: baixa com "git pull".
// - Se veio do ZIP: usa o claude-island-main.zip (ou a pasta claude-island-main) que estiver em Downloads.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, execSync } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const sh = (cmd) => execSync(cmd, { cwd: appDir, stdio: 'inherit' });

if (fs.existsSync(path.join(appDir, '.git'))) {
  sh('git pull --ff-only');
} else {
  const dl = path.join(os.homedir(), 'Downloads');
  const items = fs.readdirSync(dl).filter(n => /^claude-island-main/.test(n))
    .map(n => ({ n, p: path.join(dl, n), t: fs.statSync(path.join(dl, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const pick = items[0];
  if (!pick) {
    console.error('Não achei o claude-island-main.zip em Downloads.\nBaixe em github.com/l3companymkt/claude-island → Code → Download ZIP e rode de novo.');
    process.exit(1);
  }
  let src = pick.p;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'island-'));
  if (pick.n.endsWith('.zip')) {
    if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', src, tmp]);
    else execFileSync('unzip', ['-q', src, '-d', tmp]);
    const inner = fs.readdirSync(tmp).find(n => n.startsWith('claude-island'));
    src = inner ? path.join(tmp, inner) : tmp;
  }
  if (!fs.existsSync(path.join(src, 'package.json')) || !fs.existsSync(path.join(src, 'electron', 'main.js'))) {
    console.error(`${pick.n} não parece ser o Claude Island. Nada foi alterado.`);
    process.exit(1);
  }
  for (const name of fs.readdirSync(src)) {
    if (name === 'node_modules' || name === '.git') continue;
    fs.rmSync(path.join(appDir, name), { recursive: true, force: true });
    fs.cpSync(path.join(src, name), path.join(appDir, name), { recursive: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const it of items) fs.rmSync(it.p, { recursive: true, force: true });
  console.log(`Arquivos atualizados a partir de ${pick.n} (removido de Downloads).`);
}

sh('npm install --no-audit --no-fund');

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
