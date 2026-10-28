const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Updates, releaseInfo } = require('../core/updates');
function setup(options = {}) {
  const engine = Object.assign(new EventEmitter(), { checkForUpdates: async () => null, downloadUpdate: async () => [], quitAndInstall() {} });
  const states = [], token = () => ({ cancelled: false, cancel() { this.cancelled = true; } });
  const updates = new Updates({ engine, version: '0.1.15', changed: value => states.push(value), token, ...options });
  return { updates, engine, states };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('updates are manual and never install on ordinary app exit or allow downgrade', () => {
  const { updates, engine } = setup(); assert.equal(updates.snapshot().status, 'idle');
  for (const key of ['autoDownload', 'autoInstallOnAppQuit', 'allowDowngrade', 'allowPrerelease']) assert.equal(engine[key], false);
  assert.equal(engine.disableDifferentialDownload, true); assert.equal(engine.disableWebInstaller, true);
  assert.throws(() => updates.download(), /先检查/); assert.throws(() => updates.install(), /校验/);
});
test('checking returns immediately, coalesces clicks and exposes safe release metadata', async () => {
  const { updates, engine } = setup(); let calls = 0;
  engine.checkForUpdates = async () => { calls++; engine.emit('update-available', { version: '0.1.16', releaseNotes: 'fixture notes', downloadedFile: 'private-path' }); return {}; };
  assert.equal(updates.check().status, 'checking'); updates.check(); await tick(); assert.equal(calls, 1);
  assert.equal(updates.snapshot().status, 'available'); assert.equal(updates.snapshot().latestVersion, '0.1.16');
  assert.equal(updates.snapshot().downloadedFile, undefined);
});
test('no update and network failure are explicit and can be retried', async () => {
  const { updates, engine } = setup(); engine.checkForUpdates = async () => { throw new Error('fixture-private-url'); };
  updates.check(); await tick(); assert.equal(updates.snapshot().status, 'error'); assert.ok(!updates.snapshot().message.includes('fixture-private-url'));
  engine.checkForUpdates = async () => { engine.emit('update-not-available', { version: '0.1.14' }); return {}; };
  updates.check(); await tick(); assert.equal(updates.snapshot().status, 'latest');
});
test('download reports bounded real progress and only a verified downloaded event enables install', async () => {
  const { updates, engine } = setup(); updates.set({ status: 'available', latestVersion: '0.1.16' });
  let finish; engine.downloadUpdate = async () => new Promise(resolve => { finish = resolve; });
  assert.equal(updates.download().status, 'downloading'); await tick();
  engine.emit('download-progress', { percent: 150, transferred: -20, total: 100 });
  assert.equal(updates.snapshot().progress, 100); assert.equal(updates.snapshot().transferred, 0); assert.throws(() => updates.install());
  engine.emit('update-downloaded', { version: '0.1.16', downloadedFile: 'fixture.exe' }); finish(); await tick();
  let install; engine.quitAndInstall = (...args) => { install = args; }; updates.install(); assert.deepEqual(install, [false, true]);
});
test('cancelling download ignores stale progress, errors and completion; retry uses a fresh token', async () => {
  const { updates, engine } = setup(); updates.set({ status: 'available', latestVersion: '0.1.16' }); let reject, firstToken;
  engine.downloadUpdate = async token => { firstToken = token; return new Promise((_, no) => { reject = no; }); };
  updates.download(); await tick(); updates.cancel(); assert.ok(firstToken.cancelled);
  engine.emit('download-progress', { percent: 100 }); engine.emit('update-downloaded', { version: '0.1.16' }); engine.emit('error', Error('cancelled')); reject(Error('cancelled')); await tick();
  assert.equal(updates.snapshot().status, 'available'); assert.equal(updates.snapshot().progress, 0);
  engine.downloadUpdate = async token => { assert.notEqual(token, firstToken); }; updates.download(); await tick(); updates.close();
});
test('a failed checksum cannot trigger installation and retry remains available', async () => {
  const { updates, engine } = setup(); updates.set({ status: 'available', latestVersion: '0.1.16' });
  engine.downloadUpdate = async () => { const error = Object.assign(Error('sha512 mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' }); engine.emit('error', error); throw error; };
  updates.download(); await tick(); assert.equal(updates.snapshot().status, 'error'); assert.match(updates.snapshot().message, /校验失败/); assert.throws(() => updates.install());
  assert.equal(updates.download().status, 'downloading'); await tick();
});
test('release notes are bounded text and shutdown cancels an active download', async () => {
  assert.equal(releaseInfo({ releaseNotes: 'x'.repeat(20000) }).releaseNotes.length, 16000);
  assert.equal(releaseInfo({ releaseNotes: [{ note: 'first' }, {}, { note: 'second' }] }).releaseNotes, 'first\n\nsecond');
  const { updates, engine, states } = setup(); updates.set({ status: 'available', latestVersion: '0.1.16' }); let token;
  engine.downloadUpdate = async value => { token = value; }; updates.download(); await tick(); const count = states.length; updates.close();
  assert.ok(token.cancelled); engine.emit('update-downloaded', {}); assert.equal(states.length, count);
});
