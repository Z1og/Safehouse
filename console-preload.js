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
    // A visible opt-in applies only to the panel's two existing login forms.
    // No password is collected from ordinary logins or exposed to page globals.
    if (['/login', '/login.html'].includes(location.pathname)) {
      const forms = [
        { form: document.querySelector('#authorizedForm'), endpoint: '/api/auth/login', account: '#adminUsername', password: '#adminPassword', field: 'username' },
        { form: document.querySelector('#ordinaryForm'), endpoint: '/api/auth/guest', account: '#profileLink', password: '#ordinaryPassword', field: 'profile' },
      ].filter(item => item.form && document.querySelector(item.account) && document.querySelector(item.password));
      if (forms.length) {
        const request = value => ipcRenderer.invoke('safehouse:panelLogin', value);
        const message = text => {
          let element = document.querySelector('#safehouse-login-message') || document.querySelector('#loginMessage');
          if (!element) { element = document.createElement('p'); element.id = 'safehouse-login-message'; element.setAttribute('role', 'status'); element.style.cssText = 'font-size:13px;line-height:1.6;overflow-wrap:anywhere'; forms[0].form.parentElement.parentElement.append(element); }
          element.textContent = text;
        };
        let busy = false;
        const submitButtons = forms.flatMap(item => [...item.form.querySelectorAll('button[type="submit"]')]);
        submitButtons.forEach(button => { button.disabled = true; });
        for (const item of forms) {
          const label = document.createElement('label'), checkbox = document.createElement('input'), caption = document.createElement('span');
          label.className = 'safehouse-remember'; label.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.6;margin:12px 0';
          checkbox.type = 'checkbox'; checkbox.disabled = true; checkbox.setAttribute('aria-label', '记住登录（仅本机加密保存）'); checkbox.style.cssText = 'width:16px;height:16px;flex:none;margin:0';
          caption.textContent = '记住登录（仅本机加密保存）'; label.append(checkbox, caption);
          item.form.querySelector('button[type="submit"]')?.before(label);
          if (!label.isConnected) item.form.append(label);
          const hint = document.createElement('small'); hint.style.cssText = 'display:block;font-size:12px;line-height:1.6;opacity:.75;margin:6px 0';
          hint.textContent = '勾选后可在更新或会话过期后自动重新登录；主动退出会清除保存。' + (location.protocol === 'http:' ? ' 当前面板使用 HTTP，传输不加密。' : ''); label.after(hint);
          item.checkbox = checkbox;
          checkbox.addEventListener('change', () => {
            if (!checkbox.checked) request({ action: 'forget' }).then(result => { if (!result.ok) message(result.error); }).catch(() => message('清除保存失败，请使用客户端“忘记登录”重试'));
          });
          const registration = () => { const registering = document.querySelector(item.password).autocomplete === 'new-password'; label.style.display = registering ? 'none' : 'flex'; hint.hidden = registering; };
          registration(); new MutationObserver(registration).observe(document.querySelector(item.password), { attributes: true, attributeFilter: ['autocomplete'] });
          item.form.addEventListener('submit', async event => {
            if (!checkbox.checked || document.querySelector(item.password).autocomplete === 'new-password') {
              // A different manual account must not leave an older saved login behind.
              request({ action: 'forget' }).catch(() => {}); return;
            }
            event.preventDefault(); event.stopImmediatePropagation(); if (busy) return; busy = true;
            const buttons = [...item.form.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; }); checkbox.disabled = true;
            message('正在登录并加密保存到本机…');
            try {
              const result = await request({ action: 'login', remember: true, credentials: { endpoint: item.endpoint, [item.field]: document.querySelector(item.account).value.trim(), password: document.querySelector(item.password).value } });
              if (!result.ok) throw new Error(result.error);
              document.querySelector(item.password).value = ''; sessionStorage.removeItem('l4d2-panel-view'); location.replace('/');
            } catch (error) { message(error.message || '登录失败，请重试'); }
            finally { busy = false; buttons.forEach(button => { button.disabled = false; }); checkbox.disabled = false; }
          }, true);
        }
        request({ action: 'prepare' }).then(result => {
          if (!result.ok) { message(result.error); forms.forEach(item => { item.checkbox.disabled = false; }); return; }
          if (result.restored) { message('已恢复保存的面板登录…'); location.replace('/'); return; }
          forms.forEach(item => { item.checkbox.disabled = !result.available; item.checkbox.checked = result.remembered; });
          if (result.message) message(result.message);
          else if (!result.available) message('本机加密保存暂不可用；仍可正常使用面板登录。');
        }).catch(() => message('记住登录暂不可用；仍可正常使用面板登录。')).finally(() => submitButtons.forEach(button => { button.disabled = false; }));
      }
    }
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
