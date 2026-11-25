// Instala (ou remove com --remove) os hooks do L3 Island em ~/.claude/settings.json.
// Faz backup do arquivo antes de alterar e preserva os hooks que você já tem.
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../server/config');

const remove = process.argv.includes('--remove');
const cfg = config.load();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const file = path.join(claudeDir, 'settings.json');
const hookPath = path.resolve(__dirname, '..', 'hooks', 'island-hook.js').replace(/\\/g, '/');
const command = `node "${hookPath}"`;
const MARK = 'island-hook.js';

let settings = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8');
  try { settings = JSON.parse(raw); } catch { console.error(`Não consegui ler ${file} (JSON inválido). Nada foi alterado.`); process.exit(1); }
  const backup = `${file}.island-backup-${Date.now()}`;
  fs.writeFileSync(backup, raw);
  console.log(`Backup: ${backup}`);
}
settings.hooks = settings.hooks || {};

// remove versões anteriores do nosso hook
for (const ev of Object.keys(settings.hooks)) {
  settings.hooks[ev] = (settings.hooks[ev] || [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !(h.command || '').includes(MARK)) }))
    .filter(g => g.hooks.length);
  if (!settings.hooks[ev].length) delete settings.hooks[ev];
}

if (!remove) {
  const add = (ev, timeout, matcher) => {
    const group = { hooks: [{ type: 'command', command, timeout }] };
    if (matcher) group.matcher = matcher;
    (settings.hooks[ev] = settings.hooks[ev] || []).push(group);
  };
  add('SessionStart', 15);
  add('UserPromptSubmit', 5);
  add('Stop', 5);
  add('Notification', 5);
  add('SessionEnd', 5);
  add('PermissionRequest', 3660, '*'); // o tempo real de espera é controlado pela ilha
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2));
console.log(remove ? 'Hooks do L3 Island removidos.' : `Hooks instalados em ${file}\nToken e porta em ${config.FILE}`);
