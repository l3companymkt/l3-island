// Configuração local do Claude Island: ~/.claude-island/config.json
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(os.homedir(), '.claude-island');
const FILE = path.join(DIR, 'config.json');

// Limites por janela são ESTIMATIVAS: a Anthropic não publica limites em tokens.
// Use o botão "Bati o limite agora" no painel para calibrar com o seu uso real.
const PLAN_PRESETS = {
  pro:   { label: 'Pro',      block: 19000000,  weekly: 300000000 },
  max5:  { label: 'Max 5x',   block: 88000000,  weekly: 1500000000 },
  max20: { label: 'Max 20x',  block: 220000000, weekly: 3500000000 },
  custom:{ label: 'Personalizado', block: 50000000, weekly: 1000000000 },
};

const DEFAULTS = {
  port: 4777,
  lanAccess: true,             // permite abrir no celular pela mesma rede Wi‑Fi
  permissionWaitSeconds: 300,  // quanto tempo o Claude espera sua resposta na ilha antes de voltar ao terminal
  plan: 'max5',
  limits: { block: PLAN_PRESETS.max5.block, weekly: PLAN_PRESETS.max5.weekly },
  autoLaunch: true,            // abre a ilha quando uma sessão do Claude Code começa
  weather: { city: '', lat: null, lon: null },
  widgets: { clock: true, weather: true, music: true, network: true, disks: true, processes: true },
  appDir: path.resolve(__dirname, '..'),
};

function load() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* primeira execução */ }
  const merged = {
    ...DEFAULTS, ...cfg,
    limits: { ...DEFAULTS.limits, ...(cfg.limits || {}) },
    weather: { ...DEFAULTS.weather, ...(cfg.weather || {}) },
    widgets: { ...DEFAULTS.widgets, ...(cfg.widgets || {}) },
  };
  if (!merged.token) merged.token = crypto.randomBytes(24).toString('hex');
  merged.appDir = DEFAULTS.appDir;
  save(merged);
  return merged;
}

function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

module.exports = { load, save, FILE, DIR, PLAN_PRESETS };
