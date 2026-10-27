const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { parseVdf } = require('./valve');

function value(object, ...names) {
  if (!object || typeof object !== 'object') return '';
  const key = Object.keys(object).find(candidate => names.some(name => candidate.toLowerCase() === name.toLowerCase()));
  return key ? String(object[key] ?? '') : '';
}

function steamRoots(roots = []) {
  const candidates = roots.length ? [...roots] : [];
  if (!roots.length && process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) if (base) candidates.push(path.join(base, 'Steam'));
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Steam'));
  } else if (!roots.length) {
    candidates.push(path.join(os.homedir(), '.steam', 'steam'));
    candidates.push(path.join(os.homedir(), '.local', 'share', 'Steam'));
    if (process.platform === 'darwin') candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'Steam'));
  }
  return [...new Map(candidates.filter(Boolean).map(root => [path.resolve(root).toLowerCase(), path.resolve(root)])).values()];
}

function readAccounts(root) {
  const file = path.join(root, 'config', 'loginusers.vdf');
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = parseVdf(fs.readFileSync(file, 'utf8'));
    const users = parsed.users || parsed.Users || {};
    return Object.entries(users).filter(([, item]) => item && typeof item === 'object').map(([steamId, item]) => {
      const accountName = value(item, 'AccountName');
      const personaName = value(item, 'PersonaName');
      return {
      steamId,
      name: personaName || accountName || steamId,
      accountName,
      personaName,
      mostRecent: value(item, 'MostRecent') === '1',
      timestamp: Number(value(item, 'Timestamp')) || 0,
      wantsOffline: value(item, 'WantsOfflineMode') === '1',
      root,
      };
    }).filter(account => /^7656119\d{10}$/.test(account.steamId));
  } catch {
    return [];
  }
}

function processRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const output = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 2500 });
    return /(?:^|\s)steam\.exe(?:\s|$)/i.test(output);
  } catch {
    return false;
  }
}

function readLocalSteamState({ roots = [], running = processRunning } = {}) {
  const accounts = steamRoots(roots).flatMap(readAccounts);
  const account = [...accounts].sort((a, b) => Number(b.mostRecent) - Number(a.mostRecent) || b.timestamp - a.timestamp)[0] || null;
  return {
    available: accounts.length > 0,
    running: Boolean(running()),
    account: account ? { steamId: account.steamId, name: account.name, accountName: account.accountName, personaName: account.personaName } : null,
    accounts: accounts.map(({ root, ...entry }) => entry),
    root: account?.root || steamRoots(roots).find(candidate => fs.existsSync(path.join(candidate, 'steam.exe'))) || '',
  };
}

module.exports = { readLocalSteamState, readAccounts, steamRoots };
