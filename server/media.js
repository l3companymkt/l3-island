// "Tocando agora" do sistema, sem nuvem:
//  - Windows: controles de mídia do sistema (Spotify, navegador, etc.) via PowerShell/WinRT
//  - macOS:   Spotify / Music via osascript
//  - Linux:   playerctl (MPRIS)
const { execFile, spawn } = require('child_process');

let ps = null, psQueue = [], psBuf = '';

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
Function Await($t, $type) { $a = $asTaskGeneric.MakeGenericMethod($type); $n = $a.Invoke($null, @($t)); $n.Wait(-1) | Out-Null; $n.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
while ($true) {
  $cmd = [Console]::In.ReadLine()
  if ($cmd -eq $null) { break }
  $s = $mgr.GetCurrentSession()
  if (-not $s) { [Console]::Out.WriteLine('{}'); [Console]::Out.Flush(); continue }
  if ($cmd -eq 'toggle') { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
  elseif ($cmd -eq 'next') { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }
  elseif ($cmd -eq 'prev') { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }
  if ($cmd -ne 'get') { Start-Sleep -Milliseconds 300 }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $i = $s.GetPlaybackInfo()
  $o = @{ title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; app = $s.SourceAppUserModelId; playing = ($i.PlaybackStatus -eq 'Playing') }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush()
}`;

function winCmd(cmd) {
  return new Promise(resolve => {
    if (!ps) {
      ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
      ps.stdin.write(PS_SCRIPT.replace(/\r?\n/g, '\r\n') + '\r\n');
      ps.stdout.on('data', d => {
        psBuf += d.toString('utf8');
        let i;
        while ((i = psBuf.indexOf('\n')) >= 0) {
          const line = psBuf.slice(0, i).trim(); psBuf = psBuf.slice(i + 1);
          if (!line.startsWith('{')) continue;
          const cb = psQueue.shift();
          if (cb) { try { cb(JSON.parse(line)); } catch { cb(null); } }
        }
      });
      ps.on('exit', () => { ps = null; psQueue.splice(0).forEach(cb => cb(null)); });
    }
    const t = setTimeout(() => { const k = psQueue.indexOf(done); if (k >= 0) psQueue.splice(k, 1); resolve(null); }, 6000);
    function done(v) { clearTimeout(t); resolve(v && v.title ? v : null); }
    psQueue.push(done);
    ps.stdin.write(cmd + '\r\n');
  });
}

const run = (bin, args) => new Promise(r => execFile(bin, args, { timeout: 4000 }, (e, out) => r(e ? null : out.trim())));

async function macCmd(cmd) {
  for (const app of ['Spotify', 'Music']) {
    const running = await run('osascript', ['-e', `application "${app}" is running`]);
    if (running !== 'true') continue;
    const verb = { toggle: 'playpause', next: 'next track', prev: 'previous track' }[cmd];
    if (verb) await run('osascript', ['-e', `tell application "${app}" to ${verb}`]);
    const out = await run('osascript', ['-e',
      `tell application "${app}" to (name of current track) & "||" & (artist of current track) & "||" & (album of current track) & "||" & (player state as string)`]);
    if (!out) continue;
    const [title, artist, album, st] = out.split('||');
    return { title, artist, album, app, playing: st === 'playing' };
  }
  return null;
}

async function linuxCmd(cmd) {
  const verb = { toggle: 'play-pause', next: 'next', prev: 'previous' }[cmd];
  if (verb) await run('playerctl', [verb]);
  const out = await run('playerctl', ['metadata', '--format', '{{title}}||{{artist}}||{{album}}||{{status}}||{{playerName}}']);
  if (!out) return null;
  const [title, artist, album, st, app] = out.split('||');
  return title ? { title, artist, album, app, playing: st === 'Playing' } : null;
}

function command(cmd = 'get') {
  if (process.platform === 'win32') return winCmd(cmd);
  if (process.platform === 'darwin') return macCmd(cmd);
  return linuxCmd(cmd);
}

function stop() { if (ps) ps.kill(); }

module.exports = { command, stop };
