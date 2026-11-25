// Janela flutuante estilo "ilha" no topo da tela.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, globalShortcut, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// "Iniciar com o computador". No Mac usa um LaunchAgent, porque o app roda direto da pasta (sem .app instalado).
const AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.l3-island.plist');
const OLD_AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claude-island.plist');
try { if (fs.existsSync(OLD_AGENT)) fs.unlinkSync(OLD_AGENT); } catch {} // nome antigo
const APP_DIR = path.resolve(__dirname, '..');
function getLogin() {
  if (process.platform === 'darwin') return fs.existsSync(AGENT);
  return app.getLoginItemSettings({ args: [APP_DIR] }).openAtLogin;
}
function setLogin(on) {
  if (process.platform === 'darwin') {
    if (!on) { try { fs.unlinkSync(AGENT); } catch {} return; }
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    fs.mkdirSync(path.dirname(AGENT), { recursive: true });
    fs.writeFileSync(AGENT, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.l3-island</string>
  <key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(APP_DIR)}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`);
    return;
  }
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: [APP_DIR] });
}

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win, tray, srv, mode = 'compact';
const SIZES = { compact: [300, 64], expanded: [460, 660], alert: [440, 240], hidden: [300, 64] };

function place(m) {
  const [w, h] = SIZES[m] || SIZES.compact;
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - w) / 2);
  win.setBounds({ x, y: workArea.y + 6, width: w, height: h }, false);
}

function setMode(m) {
  mode = m;
  if (m === 'hidden') { win.hide(); return; }
  place(m);
  if (!win.isVisible()) win.showInactive();
  if (m === 'expanded') win.focus();
}

function trayIcon() {
  const s = 32, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4, dx = x - 15.5, dy = y - 15.5;
    const pill = Math.abs(dy) < 8 && (Math.abs(dx) < 6 || Math.hypot(Math.abs(dx) - 6, dy) < 8);
    const dot = Math.hypot(dx + 5, dy) < 3.2;
    if (dot) { buf[i] = 0xe8; buf[i + 1] = 0x7a; buf[i + 2] = 0x3b; buf[i + 3] = 255; }      // azul (BGRA)
    else if (pill) { buf[i] = 0x22; buf[i + 1] = 0x1c; buf[i + 2] = 0x1a; buf[i + 3] = 255; }
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s }).resize({ width: 16, height: 16 });
}

function send(cmd) { if (win) win.webContents.send('island:command', cmd); }

async function boot() {
  srv = require('../server').start();
  try { await srv.ready; }
  catch (e) {
    // a porta já está em uso: provavelmente o servidor já roda separado (npm run server)
    if (e.code !== 'EADDRINUSE') throw e;
  }

  win = new BrowserWindow({
    width: SIZES.compact[0], height: SIZES.compact[1], frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  place('compact');
  win.loadURL(srv.localUrl);
  win.once('ready-to-show', () => win.showInactive());
  win.on('blur', () => { if (mode === 'expanded') send('collapse'); });

  ipcMain.on('island:mode', (_e, m) => setMode(m));
  ipcMain.on('island:browser', () => shell.openExternal(srv.localUrl));
  ipcMain.on('island:quit', () => app.quit());
  ipcMain.on('island:login', (_e, on) => { setLogin(on); tray && tray.setContextMenu(menu()); });
  ipcMain.on('island:login-get', e => { e.returnValue = getLogin(); });

  const HOTKEY = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Alt+Space';
  globalShortcut.register(HOTKEY, () => send(mode === 'expanded' ? 'collapse' : 'expand'));

  tray = new Tray(trayIcon());
  tray.setToolTip('L3 Island');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => send('expand') },
    { label: 'Mostrar / ocultar ilha', click: () => (win.isVisible() ? setMode('hidden') : setMode('compact')) },
    { label: 'Abrir no navegador', click: () => shell.openExternal(srv.localUrl) },
    { label: 'Conectar celular', click: () => send('pair') },
    { type: 'separator' },
    { label: 'Iniciar com o computador', type: 'checkbox', checked: getLogin(),
      click: (i) => setLogin(i.checked) },
    { label: 'Sair', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => send(mode === 'expanded' ? 'collapse' : 'expand'));

  srv.bus.on('quit', () => app.quit());

  // notificação nativa quando o Claude pede permissão
  srv.bus.on('permission-new', req => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: `Claude quer usar ${req.tool}`, body: `${req.project ? req.project + ' · ' : ''}${req.detail}`.slice(0, 180), silent: false });
    n.on('click', () => send('expand'));
    n.show();
  });
  srv.bus.on('notification', ev => {
    if (!Notification.isSupported() || !ev.message || /permission/i.test(ev.message)) return;
    new Notification({ title: 'Claude Code', body: String(ev.message).slice(0, 180), silent: true }).show();
  });
}

app.on('second-instance', () => send('expand'));
app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (srv) srv.stop(); });
if (process.platform === 'darwin' && app.dock) app.dock.hide();
if (process.platform === 'win32') app.setAppUserModelId('L3 Island');
app.whenReady().then(boot);
