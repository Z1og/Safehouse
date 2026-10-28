const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { packager } = require('@electron/packager');
const { build, Platform } = require('electron-builder');
const { installerConfiguration } = require('./installer.cjs');
const yazl = require('yazl');
const { copyTree } = require('./runtime.cjs');

function normalUserExecutable(file) {
  // Some development workspaces carry an inheritable Low mandatory label.
  // Windows starts an executable with that label at Low integrity even from
  // an ordinary Medium Explorer process, preventing writes to user AppData.
  // Normalize only our emitted EXEs, without changing directory ACLs or UAC.
  const result = spawnSync('icacls.exe', [file, '/setintegritylevel', 'M'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `无法设置发布程序的普通用户完整性级别：${file}`);
}

async function cacheElectronZip(version) {
  const source = path.join(path.dirname(require.resolve('electron')), 'dist');
  if (!fs.existsSync(path.join(source, 'electron.exe'))) throw new Error('本地 Electron Windows 运行时不存在');
  const cache = path.join(process.env.LOCALAPPDATA, 'Safehouse', 'electron-zips');
  const fileName = `electron-v${version}-win32-x64.zip`;
  const zipPath = path.join(cache, fileName);
  if (fs.existsSync(zipPath)) return cache;
  fs.mkdirSync(cache, { recursive: true });
  const zip = new yazl.ZipFile();
  function addDirectory(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(directory, entry.name);
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) addDirectory(fullPath, name);
      else if (entry.isFile()) zip.addFile(fullPath, name);
      else throw new Error(`Electron 运行时包含不支持的链接：${name}`);
    }
  }
  addDirectory(source);
  zip.end();
  await pipeline(zip.outputStream, fs.createWriteStream(zipPath));
  return cache;
}

(async () => {
  if (process.platform !== 'win32') throw new Error('此发布脚本需要 Windows；核心模块测试支持其他平台');
  const project = path.join(__dirname, '..'), metadata = require('../package.json');
  const licenses = spawnSync(process.execPath, [path.join(__dirname, 'licenses.cjs')], { cwd: project, encoding: 'utf8', windowsHide: true });
  if (licenses.status !== 0) throw new Error(licenses.stderr || licenses.stdout || '依赖许可收集失败');
  const hash = crypto.createHash('sha256');
  function fingerprint(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) fingerprint(file);
      else { hash.update(path.relative(project, file)); hash.update(fs.readFileSync(file)); }
    }
  }
  for (const dir of ['core', 'renderer', 'scripts']) fingerprint(path.join(project, dir));
  for (const file of ['main.js', 'preload.js', 'console-preload.js', 'package.json', 'package-lock.json']) hash.update(fs.readFileSync(path.join(project, file)));
  const buildId = hash.digest('hex').slice(0, 16);
  const buildRoot = path.join(process.env.LOCALAPPDATA, 'Safehouse', 'builds', buildId);
  const electronZipDir = await cacheElectronZip(metadata.devDependencies.electron);
  const [appDir] = await packager({
    dir: project, name: 'Safehouse', platform: 'win32', arch: 'x64',
    electronVersion: metadata.devDependencies.electron, out: buildRoot,
    electronZipDir, overwrite: true, asar: { unpack: '**/node_modules/steamworks.js/dist/**' }, prune: true,
    ignore: [/^\/(?:tests|scripts|output|docs|TODO\.md|package-lock\.json)(\/|$)/],
    win32metadata: { ProductName: 'Safehouse', FileDescription: metadata.description, InternalName: 'Safehouse' },
  });
  const output = path.resolve(project, '../outputs/desktop');
  fs.mkdirSync(output, { recursive: true });
  const release = path.join(output, `Safehouse-${metadata.version}-win-x64`);
  // A release folder can be open in Explorer. Only replace the app tree after
  // resolving the exact, owned output path; never operate on a caller's path.
  if (fs.existsSync(release)) {
    const expected = path.join(output, `Safehouse-${metadata.version}-win-x64`);
    if (path.resolve(release) !== expected || path.dirname(release) !== output) throw new Error('发布路径校验失败');
    fs.rmSync(release, { recursive: true, force: true });
  }
  fs.mkdirSync(release, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'resources', 'app-update.yml'), 'provider: github\nowner: Z1og\nrepo: Safehouse\nupdaterCacheDirName: safehouse-l4d2-updater\n');
  copyTree(appDir, path.join(release, 'app'));
  fs.writeFileSync(path.join(appDir, 'resources', 'safehouse-installed.json'), JSON.stringify({ kind: 'nsis', appId: 'com.z1og.safehouse' }));
  await build({ projectDir: project, prepackaged: appDir, targets: Platform.WINDOWS.createTarget('nsis'), publish: 'never', config: installerConfiguration({ output, version: metadata.version }) });
  const installer = path.join(output, `Safehouse-Setup-${metadata.version}-x64.exe`);
  normalUserExecutable(installer);
  const installerSha256 = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
  fs.writeFileSync(installer + '.sha256', `${installerSha256}  ${path.basename(installer)}\n`);
  const toolsRoot = path.join(process.env.LOCALAPPDATA, 'Safehouse', 'build-tools');
  const compiler = process.env.SAFEHOUSE_ZIG_BIN || (fs.existsSync(toolsRoot) ? fs.readdirSync(toolsRoot).map(name => path.join(toolsRoot, name, 'zig.exe')).find(file => fs.existsSync(file)) : '');
  if (!compiler || !fs.existsSync(compiler)) throw new Error('缺少 Zig 原生编译器；请设置 SAFEHOUSE_ZIG_BIN 为 zig.exe 的绝对路径');
  const resourceFile = path.join(buildRoot, 'launcher.res');
  const resource = spawnSync(compiler, ['rc', '/fo', resourceFile, 'Launcher.rc'], { cwd: __dirname, encoding: 'utf8', windowsHide: true });
  if (resource.status !== 0) throw new Error(resource.stderr || resource.stdout || '启动器应用清单编译失败');
  const launcher = spawnSync(compiler, ['cc', '-target', 'x86_64-windows-gnu', '-O2', '-s', '-municode', '-Wl,--subsystem,windows', path.join(__dirname, 'Launcher.c'), resourceFile, '-o', path.join(release, 'Safehouse.exe'), '-luser32', '-lshell32'], {
    encoding: 'utf8', windowsHide: true,
  });
  if (launcher.status !== 0) throw new Error(launcher.stderr || launcher.stdout || '发布启动器编译失败');
  normalUserExecutable(path.join(release, 'Safehouse.exe'));
  normalUserExecutable(path.join(release, 'app', 'Safehouse.exe'));
  fs.copyFileSync(path.join(project, 'README.md'), path.join(release, 'README.md'));
  copyTree(path.join(project, 'docs'), path.join(release, 'docs'));
  for (const file of ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.txt']) fs.copyFileSync(path.join(project, file), path.join(release, file));
  fs.writeFileSync(path.join(release, 'build-id.txt'), buildId + '\n');
  fs.writeFileSync(path.join(release, 'Start Safehouse.cmd'), '@echo off\r\nstart "" "%~dp0Safehouse.exe"\r\n');
  const archive = release + '.zip';
  const command = '$ErrorActionPreference="Stop"; Compress-Archive -LiteralPath $env:SAFEHOUSE_RELEASE -DestinationPath $env:SAFEHOUSE_ARCHIVE -Force -CompressionLevel Optimal';
  const zip = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, SAFEHOUSE_RELEASE: release, SAFEHOUSE_ARCHIVE: archive }, encoding: 'utf8', windowsHide: true,
  });
  if (zip.status !== 0) throw new Error(zip.stderr || 'ZIP 打包失败');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive + '.sha256', `${sha256}  ${path.basename(archive)}\n`);
  console.log(JSON.stringify({ buildId, appDir, release, archive, bytes: fs.statSync(archive).size, sha256, installer, installerSha256, updateFeed: path.join(output, 'latest.yml') }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
