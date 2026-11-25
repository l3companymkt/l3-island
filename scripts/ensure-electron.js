// O npm 11+ pode pular o script que baixa o Electron. Se ele não estiver baixado, baixa agora.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'node_modules', 'electron');
if (!fs.existsSync(dir)) { console.error('Rode "npm install" primeiro.'); process.exit(1); }
if (!fs.existsSync(path.join(dir, 'path.txt'))) {
  console.log('Baixando o Electron (só na primeira vez, ~100 MB)...');
  const r = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(path.join(dir, 'path.txt'))) {
    console.error('Não consegui baixar o Electron. Apague a pasta node_modules e rode "npm install" de novo.');
    process.exit(1);
  }
}
