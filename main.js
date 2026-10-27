const { app, BrowserWindow, ipcMain, dialog, shell, session, nativeTheme, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Library, discover } = require('./core/library');
const { Downloads } = require('./core/downloads');
const { PanelDownloads } = require('./core/panel-downloads');
const { Localizations } = require('./core/localization');
const { Community, Translator } = require('./core/community');
const { readLocalSteamState } = require('./core/steam');
const { Workshop } = require('./core/workshop');
const { unsubscribeAndUninstall } = require('./core/subscriptions');
const { atomicWrite, readJson } = require('./core/valve');
const { SearchPlanner, BilingualSearch } = require('./core/search');
const { PROJECT, projectLink } = require('./core/project');
const { CenterConsole, consoleUrl, configuredConsoleUrl, DEFAULT_CONSOLE_URL } = require('./core/console');

app.setName('Safehouse');
if (process.env.SAFEHOUSE_DATA_DIR) app.setPath('userData', path.resolve(process.env.SAFEHOUSE_DATA_DIR));
if (!app.requestSingleInstanceLock()) app.quit();
let mainWindow, library, downloads, community, translator, settings, settingsFile, discovery, workshop;
let operation = false;
let searchPlanner, bilingualSearch, centerConsole, panelDownloads, localizations;
const rendererPath = path.join(__dirname, 'renderer', 'index.html');
const rendererUrl = pathToFileURL(rendererPath).href;
const notify = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('safehouse:changed'); };
function bind(name, handler) {
  ipcMain.handle(`safehouse:${name}`, async (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame.url !== rendererUrl) throw new Error('未知窗口请求');
    try { return { ok: true, data: await handler(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
async function exclusive(action) {
  if (operation || downloads.active) throw new Error('正在处理安装或文件操作，请完成后再试');
  operation = true; try { return await action(); } finally { operation = false; }
}
function currentState() {
  const inventory = localizations.decorate(library.scan()); downloads.syncWorkshop(inventory.items);
  const steam = readLocalSteamState({ roots: discovery.steamRoots }), ugc = workshop.status();
  if (ugc.ready) {
    steam.account = ugc.account; steam.available = true;
    // Steam can retain an unsubscribed item's download cache. It is no longer
    // a managed mod after its addons copies have been uninstalled.
    inventory.items = inventory.items.filter(item => item.source !== 'cache' || ugc.subscribedIds.includes(item.workshopId));
  }
  return { ...inventory, downloads: downloads.list(), steam: { ...steam, ugc }, settings, language: app.getLocale(), version: app.getVersion(), discoveryWarnings: discovery.warnings };
}
function officialUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['steamcommunity.com', 'store.steampowered.com', 'compose-miuix-ui.github.io'].includes(url.hostname)) throw new Error('只能打开官方 Steam 或 Miuix 页面');
  return url.href;
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1400, height: 940, minWidth: 980, minHeight: 700, backgroundColor: '#f7f7f7', title: 'Safehouse · 求生之路 2', titleBarStyle: 'hidden', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false } });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { try { shell.openExternal(officialUrl(url)); } catch { /* Unknown links stay blocked. */ } return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(rendererPath);
  centerConsole = new CenterConsole({ electron: require('electron'), window: mainWindow, url: settings.consoleUrl || DEFAULT_CONSOLE_URL, zoom: settings.consoleZoom || 'auto', directDownloads: panelDownloads, changed: value => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('safehouse:consoleChanged', value); } });
}
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.whenReady().then(async () => {
  const stateDir = app.getPath('userData'); fs.mkdirSync(stateDir, { recursive: true });
  settingsFile = path.join(stateDir, 'settings.json');
  settings = readJson(settingsFile, { gameRoot: '', theme: 'system', autoTranslate: true, language: app.getLocale() });
  const panelUrl = configuredConsoleUrl(settings.consoleUrl);
  if (settings.consoleUrl !== panelUrl) { settings.consoleUrl = panelUrl; atomicWrite(settingsFile, JSON.stringify(settings, null, 2)); }
  discovery = discover();
  library = new Library({ gameRoot: settings.gameRoot || discovery.games[0] || '', steamRoots: discovery.steamRoots });
  // Stale saved paths remain visible in settings, but never permit a file operation.
  if (settings.gameRoot && !fs.existsSync(path.join(settings.gameRoot, 'left4dead2', 'gameinfo.txt'))) { discovery.warnings.push('保存的游戏路径已失效，请重新选择'); library.root = ''; }
  localizations = new Localizations({ stateDir, library });
  downloads = new Downloads({
    stateDir,
    library,
    changed: notify,
    progress: value => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('safehouse:downloadsChanged', value);
    },
  });
  const directSession = session.fromPartition('safehouse-direct-files');
  panelDownloads = new PanelDownloads({ downloads, directory: process.env.SAFEHOUSE_DATA_DIR ? path.join(stateDir, 'panel-downloads') : path.join(app.getPath('downloads'), 'Safehouse'), fetch: (...args) => directSession.fetch(...args) });
  ipcMain.handle('safehouse:panelDownload', async (event, value) => {
    try { return { ok: true, ...await centerConsole.helperRequest(event, value) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.on('safehouse:panelConnection', (event, value) => { try { centerConsole?.updateConnection(event, value); } catch { /* Ignore unrelated frames. */ } });
  workshop = new Workshop({ disabled: process.env.SAFEHOUSE_DISABLE_STEAMWORKS === '1' });
  community = new Community({ session: session.defaultSession, workshop });
  translator = new Translator({ file: path.join(stateDir, 'translations.json'), fetch: (...args) => session.defaultSession.fetch(...args) });
  searchPlanner = new SearchPlanner(translator);
  bilingualSearch = new BilingualSearch(community, searchPlanner);
  nativeTheme.themeSource = settings.theme;
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  bind('state', currentState);
  bind('scan', () => exclusive(() => { discovery = discover(); if (!library.root && discovery.games[0]) library.configure(discovery.games[0], discovery.steamRoots); else library.steamRoots = discovery.steamRoots; return currentState(); }));
  bind('chooseGame', () => exclusive(async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择 Left 4 Dead 2 游戏目录', properties: ['openDirectory'] });
    if (!result.canceled) { library.configure(result.filePaths[0]); settings.gameRoot = library.root; atomicWrite(settingsFile, JSON.stringify(settings, null, 2)); }
    return currentState();
  }));
  bind('chooseImports', async () => {
    if (operation) throw new Error('正在处理文件操作');
    const result = await dialog.showOpenDialog(mainWindow, { title: '导入地图 / Mod', properties: ['openFile', 'multiSelections'], filters: [{ name: 'VPK / ZIP 内容包', extensions: ['vpk', 'zip'] }] });
    return result.canceled ? downloads.list() : downloads.enqueue(result.filePaths);
  });
  bind('import', files => { if (operation) throw new Error('正在处理文件操作'); return downloads.enqueue(files); });
  bind('enable', (ids, enabled) => exclusive(() => library.setEnabled(ids, enabled)));
  bind('uninstall', ids => exclusive(async () => {
    const selected = library.selected(ids);
    const workshop = selected.some(item => item.source === 'workshop');
    const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: '卸载所选内容', message: `将 ${selected.length} 项内容移至系统回收站？`, detail: `${selected.slice(0, 5).map(item => item.title).join('\n')}${selected.length > 5 ? '\n…' : ''}\n\n可从回收站恢复。原始导入文件不受影响。${workshop ? '其中包含 Steam 工坊文件；Steam 可能在客户端同步时重新下载。' : ''}游戏运行时请先退出，以免文件被占用。`, buttons: ['取消', '移至回收站'], defaultId: 0, cancelId: 0 });
    return result.response === 1 ? library.uninstall(ids, file => shell.trashItem(file)) : { cancelled: true };
  }));
  bind('search', (query, page, category, subcategory) => bilingualSearch.search(query, page, category, subcategory));
  bind('searchPlan', query => searchPlanner.plan(query));
  bind('consoleShow', bounds => centerConsole.show(bounds));
  bind('consoleHide', () => centerConsole.hide());
  bind('consoleBounds', bounds => centerConsole.layout(bounds));
  bind('consoleConnect', value => {
    const url = configuredConsoleUrl(value);
    settings.consoleUrl = url; atomicWrite(settingsFile, JSON.stringify(settings, null, 2));
    return centerConsole.load(url);
  });
  bind('consoleReload', () => centerConsole.load());
  bind('consoleAuth', (username, password) => centerConsole.authenticate(username, password));
  bind('consoleOpen', () => shell.openExternal(consoleUrl(centerConsole.url)));
  bind('consoleZoom', mode => { const result = centerConsole.setZoom(mode); settings.consoleZoom = mode; atomicWrite(settingsFile, JSON.stringify(settings, null, 2)); return result; });
  bind('consoleCopyConnection', () => centerConsole.copyConnection());
  bind('panelInstall', id => { if (operation) throw new Error('正在处理文件操作'); return panelDownloads.install(id); });
  bind('panelReveal', id => shell.showItemInFolder(panelDownloads.file(id)));
  bind('details', async id => { const item = await community.details(id); let subscription = {}; try { subscription = workshop.snapshot(item.id); } catch { } return { ...item, ...subscription }; });
  bind('subscribe', async id => {
    if (operation) throw new Error('正在处理文件操作，请稍候');
    library.addonDir;
    const item = await workshop.subscribe(id);
    downloads.trackWorkshop(item.id, item.title);
    if (!item.accepted) downloads.updateWorkshop(item.id, { status: 'steam', error: '订阅成功，Steam 尚未接受下载请求。可以在此重试下载。' });
    notify(); return { ...item, downloads: downloads.list() };
  });
  bind('unsubscribe', async id => {
    if (operation) throw new Error('正在处理文件操作，请稍候');
    operation = true;
    try { return await unsubscribeAndUninstall({ id, workshop, downloads, library, localizations, trash: file => shell.trashItem(file) }); }
    finally { operation = false; notify(); }
  });
  bind('localize', ids => exclusive(async () => {
    try { return await localizations.localize(ids); }
    finally { notify(); }
  }));
  bind('translate', text => translator.translate(text, settings.language || app.getLocale()));
  bind('settings', value => {
    if (typeof value !== 'object' || !value) throw new Error('设置无效');
    if (value.theme !== undefined) { if (!['system', 'light', 'dark'].includes(value.theme)) throw new Error('主题无效'); settings.theme = value.theme; nativeTheme.themeSource = value.theme; }
    if (value.autoTranslate !== undefined) { if (typeof value.autoTranslate !== 'boolean') throw new Error('翻译开关无效'); settings.autoTranslate = value.autoTranslate; }
    if (value.language !== undefined) { if (typeof value.language !== 'string' || !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(value.language)) throw new Error('语言无效'); settings.language = value.language; }
    atomicWrite(settingsFile, JSON.stringify(settings, null, 2)); return settings;
  });
  bind('cancel', id => downloads.jobs.some(job => job.id === id && job.kind === 'panel') ? panelDownloads.cancel(id) : downloads.cancel(id));
  bind('retry', id => { if (operation) throw new Error('正在处理文件操作'); return downloads.retry(id); });
  bind('deleteDownload', id => exclusive(() => downloads.jobs.find(job => job.id === id)?.kind === 'panel' ? panelDownloads.remove(id, file => shell.trashItem(file)) : downloads.remove(id)));
  bind('clearDownloads', () => downloads.clear());
  bind('open', value => shell.openExternal(officialUrl(value)));
  bind('projectLink', key => shell.openExternal(projectLink(key)));
  bind('copyGroup', () => { clipboard.writeText(PROJECT.group); return PROJECT.group; });
  bind('reveal', id => {
    if (id === 'addons') return shell.openPath(library.addonDir).then(error => { if (error) throw new Error(error); });
    const item = library.scan().items.find(item => item.id === id); if (!item) throw new Error('文件不存在'); shell.showItemInFolder(item.file);
  });
  bind('launch', () => shell.openExternal('steam://rungameid/550'));
  bind('openSteam', () => shell.openExternal('steam://open/main'));
  bind('steamDownloads', () => shell.openExternal('steam://open/downloads'));
  bind('window', action => { if (action === 'minimize') mainWindow.minimize(); else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); else if (action === 'close') mainWindow.close(); });
  createWindow();
  const watcher = setInterval(() => {
    if (!operation) {
      for (const job of downloads.jobs.filter(job => job.kind === 'workshop' && ['steam', 'downloading'].includes(job.status))) {
        try {
          const progress = workshop.snapshot(job.workshopId);
          if (!progress.subscribed) { downloads.cancelWorkshop(job.workshopId); continue; }
          if (progress.installed && progress.folder) downloads.installWorkshop(job.workshopId, progress.folder);
          else downloads.updateWorkshop(job.workshopId, { status: progress.downloading ? 'downloading' : 'steam', bytes: progress.bytes, total: progress.total, error: '' });
        } catch (error) { downloads.updateWorkshop(job.workshopId, { error: error.message }); }
      }
    }
  }, 2000); watcher.unref();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { dialog.showErrorBox('Safehouse 启动失败', error.stack || error.message); app.quit(); });
let flushingSession = false;
app.on('before-quit', event => {
  panelDownloads?.close(); downloads?.active?.controller.abort();
  if (!flushingSession && centerConsole?.panelSession) {
    event.preventDefault(); flushingSession = true;
    centerConsole.flush().catch(() => {}).finally(() => app.quit());
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
