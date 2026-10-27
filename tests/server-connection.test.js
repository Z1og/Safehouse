const test = require('node:test');
const assert = require('node:assert/strict');
const { CenterConsole, gameConnection } = require('../core/console');

test('game connection preserves each explicit game port for IP, domain and bracketed IPv6', () => {
  for (const address of ['192.0.2.7:27025', 'game.example.com:28016', 'localhost:27501', '[2001:db8::7]:29015']) {
    assert.deepEqual(gameConnection(address), { address, command: `connect ${address}` });
    assert.deepEqual(gameConnection(` connect ${address} `), { address, command: `connect ${address}` });
  }
  for (const invalid of ['', null, 27015, 'connect example.com', 'https://example.com:4174/', 'example.com:0', 'example.com:65536', '999.2.3.4:27015', 'bad..host:27015', '[bad::ip]:27015', 'example.com:27015;quit', 'example.com:27015\nquit', 'example.com:27015 +exec x', 'user@host:27015']) assert.equal(gameConnection(invalid), null, String(invalid));
});
test('server address reports are tied to the current trusted top frame and copy requires a fresh valid endpoint', () => {
  const writes = [], changes = [], sender = {}, top = { url: 'https://panel-a.example/maps' }; top.top = top;
  const panel = Object.create(CenterConsole.prototype);
  Object.assign(panel, { electron: { clipboard: { writeText: value => writes.push(value) } }, view: { webContents: sender }, url: 'https://panel-a.example/', state: { status: 'ready' }, changed: value => changes.push(value), zoomMode: 'auto', present() {} });
  const event = { sender, senderFrame: top };
  panel.updateConnection(event, 'connect game-a.example:28025'); assert.equal(panel.copyConnection(), 'connect game-a.example:28025');
  assert.deepEqual(writes, ['connect game-a.example:28025']);
  panel.updateConnection(event, 'connect game-a.example:28025'); assert.equal(changes.length, 1);
  for (const invalid of [{ sender: {}, senderFrame: top }, { sender }, { sender, senderFrame: { url: top.url, top } }]) assert.throws(() => panel.updateConnection(invalid, 'other.example:27015'), /来源/);
  panel.url = 'https://panel-b.example/'; assert.throws(() => panel.updateConnection(event, 'old.example:27015'), /来源/);
  panel.setState('loading', 'switching'); assert.equal(panel.snapshot().serverConnection, null); assert.throws(() => panel.copyConnection());
  const next = { url: panel.url }; next.top = next;
  panel.updateConnection({ sender, senderFrame: next }, 'new.example:27111'); assert.equal(panel.snapshot().serverConnection, null);
  panel.setState('ready', 'connected'); panel.updateConnection({ sender, senderFrame: next }, 'new.example:27111'); assert.equal(panel.copyConnection(), 'connect new.example:27111');
  panel.updateConnection({ sender, senderFrame: next }, 'new.example:27111;quit'); assert.equal(panel.snapshot().serverConnection, null); assert.throws(() => panel.copyConnection());
  panel.updateConnection({ sender, senderFrame: next }, 'new.example:27111'); panel.setState('error', 'offline'); assert.equal(panel.snapshot().serverConnection, null); assert.throws(() => panel.copyConnection());
});
