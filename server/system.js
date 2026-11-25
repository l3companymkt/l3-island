// Monitoramento do computador via systeminformation (100% local).
const si = require('systeminformation');
const os = require('os');
const { execFile } = require('child_process');

const HISTORY = 60;
const state = {
  static: null,
  cpu: { load: 0, cores: [], temp: null, speed: null },
  mem: { used: 0, total: 0, pct: 0, swapPct: 0 },
  gpu: null,
  net: { rx: 0, tx: 0 },
  disks: [],
  battery: null,
  processes: [],
  uptime: 0,
  history: { cpu: [], mem: [], rx: [], tx: [] },
};

const push = (arr, v) => { arr.push(v); if (arr.length > HISTORY) arr.shift(); };
const safe = async (fn) => { try { return await fn(); } catch { return null; } };

async function fast() {
  const [load, mem, net, temp] = await Promise.all([
    safe(() => si.currentLoad()), safe(() => si.mem()),
    safe(() => si.networkStats()), safe(() => si.cpuTemperature()),
  ]);
  if (load) {
    state.cpu.load = Math.round(load.currentLoad);
    state.cpu.cores = load.cpus.map(c => Math.round(c.load));
  }
  if (temp && temp.main) state.cpu.temp = Math.round(temp.main);
  if (mem) {
    const used = mem.active || mem.used;
    state.mem = { used, total: mem.total, pct: Math.round(used / mem.total * 100),
      swapPct: mem.swaptotal ? Math.round(mem.swapused / mem.swaptotal * 100) : 0 };
  }
  if (net) {
    const rx = net.reduce((s, n) => s + (n.rx_sec > 0 ? n.rx_sec : 0), 0);
    const tx = net.reduce((s, n) => s + (n.tx_sec > 0 ? n.tx_sec : 0), 0);
    state.net = { rx: Math.round(rx), tx: Math.round(tx) };
  }
  state.uptime = os.uptime();
  push(state.history.cpu, state.cpu.load);
  push(state.history.mem, state.mem.pct);
  push(state.history.rx, state.net.rx);
  push(state.history.tx, state.net.tx);
}

async function medium() {
  const procs = await safe(() => si.processes());
  if (procs) {
    state.processes = procs.list
      .filter(p => p.name && !/^(System Idle Process|Idle)$/i.test(p.name))
      .sort((a, b) => b.cpu - a.cpu).slice(0, 6)
      .map(p => ({ name: p.name, cpu: Math.round(p.cpu * 10) / 10, mem: Math.round(p.mem * 10) / 10 }));
  }
  const g = await safe(() => si.graphics());
  const c = g && g.controllers && g.controllers.find(x => x.utilizationGpu != null) || (g && g.controllers && g.controllers[0]);
  if (c) state.gpu = { model: c.model, load: c.utilizationGpu ?? null, temp: c.temperatureGpu ?? null,
    memPct: c.memoryTotal && c.memoryUsed ? Math.round(c.memoryUsed / c.memoryTotal * 100) : null };
  // Apple Silicon: o uso da GPU vem do ioreg (não precisa de senha de administrador)
  if (process.platform === 'darwin') {
    const load = await appleGpuLoad();
    if (load != null) state.gpu = { ...(state.gpu || { model: 'GPU Apple' }), load };
  }
}

function appleGpuLoad() {
  return new Promise(resolve => {
    execFile('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator'], { timeout: 3000, maxBuffer: 4e6 }, (err, out) => {
      const m = !err && /"Device Utilization %"\s*=\s*(\d+)/.exec(out || '');
      resolve(m ? Math.min(100, Number(m[1])) : null);
    });
  });
}

async function slow() {
  const [fsz, bat] = await Promise.all([safe(() => si.fsSize()), safe(() => si.battery())]);
  if (fsz) {
    let list = fsz.filter(d => d.size > 1e9);
    if (process.platform === 'darwin') {
      // No macOS os volumes do sistema dividem o mesmo disco; seus arquivos ficam em /System/Volumes/Data
      const data = list.find(d => d.mount === '/System/Volumes/Data');
      list = list.filter(d => d.mount.startsWith('/Volumes/') && !/^\/Volumes\/(Recovery|Preboot|Update|VM|xarts|iSCPreboot|Hardware)$/i.test(d.mount));
      list.unshift(data ? { ...data, mount: 'Macintosh HD' } : fsz.find(d => d.mount === '/'));
      list = list.filter(Boolean);
    }
    const seen = new Set();
    state.disks = list.filter(d => !seen.has(d.size + d.fs) && seen.add(d.size + d.fs))
      .slice(0, 4).map(d => ({ name: d.mount || d.fs, size: d.size, used: d.used, pct: Math.round(d.use) }));
  }
  if (bat && bat.hasBattery) state.battery = { pct: bat.percent, charging: bat.isCharging };
}

async function start(onUpdate) {
  const [cpu, osi] = await Promise.all([safe(() => si.cpu()), safe(() => si.osInfo())]);
  state.static = {
    cpu: cpu ? `${cpu.manufacturer} ${cpu.brand}`.trim() : os.cpus()[0]?.model,
    cores: cpu ? cpu.cores : os.cpus().length,
    os: osi ? `${osi.distro} ${osi.release}` : `${os.type()} ${os.release()}`,
    host: os.hostname(),
  };
  await Promise.all([fast(), slow()]);
  medium();
  setInterval(async () => { await fast(); onUpdate(state); }, 2000);
  setInterval(medium, 8000);
  setInterval(slow, 30000);
  onUpdate(state);
}

module.exports = { start, state };
