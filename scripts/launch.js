// Abre a ilha "solta" do Terminal: depois disso pode fechar o Terminal.
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
require('./ensure-electron');

const appDir = path.resolve(__dirname, '..');
const cfg = require('../server/config').load();

http.get({ host: '127.0.0.1', port: cfg.port, path: '/api/health', timeout: 800 }, res => {
  res.resume();
  console.log('A ilha já está aberta.');
}).on('error', start).on('timeout', function () { this.destroy(); });

function start() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  spawn(require(path.join(appDir, 'node_modules', 'electron')), [appDir], { detached: true, stdio: 'ignore', env }).unref();
  console.log('Ilha aberta. Pode fechar o Terminal.');
}
