const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// Keep the development runtime in the per-user cache. The checkout can inherit
// a Low mandatory label, which would make Chromium unable to write AppData.
// Sources stay in the checkout; the cached executable inherits normal user ACLs.
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`运行时包含不支持的链接：${entry.name}`);
  }
}
function runtime() {
  if (process.env.SAFEHOUSE_ELECTRON_BIN) return path.resolve(process.env.SAFEHOUSE_ELECTRON_BIN);
  const source = require('electron');
  if (process.platform !== 'win32') return source;
  const version = require('electron/package.json').version;
  const parent = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Safehouse', 'runtime');
  const destination = path.join(parent, `electron-${version}-${process.arch}`);
  const executable = path.join(destination, 'electron.exe');
  const marker = path.join(destination, '.safehouse-ready');
  if (fs.existsSync(executable) && fs.existsSync(marker)) return executable;
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, '.preparing-'));
  try {
    copyTree(path.dirname(source), stage);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const check = spawnSync(path.join(stage, 'electron.exe'), ['--version'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (check.status !== 0 || !check.stdout.includes(`v${version}`)) throw new Error('Electron 运行时无法启动，请检查本机应用目录是否可用');
    fs.writeFileSync(path.join(stage, '.safehouse-ready'), version);
    if (fs.existsSync(destination) && !fs.existsSync(marker)) fs.rmSync(destination, { recursive: true, force: true });
    try { fs.renameSync(stage, destination); }
    catch (error) { if (!fs.existsSync(marker)) throw error; }
    return executable;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
module.exports = { runtime, copyTree };
