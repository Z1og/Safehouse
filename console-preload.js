// A narrow adapter for the panel's existing download-helper message protocol.
// No host API, file paths, Node objects or generic IPC are exposed to the page.
const { ipcRenderer } = require('electron');
if (process.isMainFrame) {
  window.addEventListener('message', async event => {
    const value = event.data;
    if (event.source !== window || event.origin !== location.origin || value?.source !== 'l4d2-control' || !['status', 'download'].includes(value.action) || typeof value.requestId !== 'string' || value.requestId.length > 100) return;
    const request = { action: value.action, name: value.name, size: value.size, url: value.url };
    let result;
    try { result = await ipcRenderer.invoke('safehouse:panelDownload', request); }
    catch { result = { ok: false, error: '客户端下载连接失败，请重新连接面板' }; }
    window.postMessage({ ...result, source: 'l4d2-download-helper', requestId: value.requestId }, location.origin);
  });
  window.addEventListener('DOMContentLoaded', () => {
    let lastConnection, connectionTimer;
    const reportConnection = (force = false) => {
      const field = document.querySelector('#serverConnectCommand');
      const raw = field && typeof field.value === 'string' ? field.value : document.querySelector('[data-game-address]')?.textContent || '';
      const value = typeof raw === 'string' && raw.length <= 512 ? raw : '';
      if (force || value !== lastConnection) { lastConnection = value; ipcRenderer.send('safehouse:panelConnection', value); }
    };
    ipcRenderer.on('safehouse:refreshPanelConnection', () => reportConnection(true));
    // The panel sets textarea.value programmatically. Observe its text mirrors
    // and also poll that property; neither requires reading page globals or auth.
    const scheduleConnection = () => { clearTimeout(connectionTimer); connectionTimer = setTimeout(reportConnection, 100); };
    const adapt = () => {
      const button = document.querySelector('#browserDirectDownload');
      if (button && !button.dataset.safehouseNative) { button.dataset.safehouseNative = '1'; button.textContent = '下载到客户端'; button.title = '由 Safehouse 直接下载，在上方下载任务中查看进度'; }
      const message = document.querySelector('#cloudDownloadMessage');
      if (message?.textContent.includes('需要下载助手')) message.textContent = 'Safehouse 已内置下载助手，点击“下载到客户端”即可直接下载，并在下载任务中安装到模组管理。';
      else if (message?.textContent === '正在检查下载助手是否已绑定…') message.textContent = '正在连接 Safehouse 下载任务…';
      else if (message?.textContent.includes('正在由本机扩展验证地图文件')) message.textContent = '正在由 Safehouse 验证地图文件，文件将直连下载到本机…';
      else if (message?.textContent.includes('地图内容检查通过，已交给浏览器下载')) message.textContent = '地图内容检查通过，已交给客户端下载。请在上方模组任务中查看进度并安装。';
      const toast = document.querySelector('#toast');
      if (toast?.textContent === '已提交浏览器下载，可在浏览器下载列表查看进度') toast.textContent = '已交给 Safehouse 下载，请在上方模组任务中查看进度';
    };
    adapt(); reportConnection();
    new MutationObserver(() => { adapt(); scheduleConnection(); }).observe(document.body, { childList: true, characterData: true, subtree: true });
    const interval = setInterval(reportConnection, 1000);
    window.addEventListener('pagehide', () => { clearTimeout(connectionTimer); clearInterval(interval); });
  });
}
