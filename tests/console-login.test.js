const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { ConsoleLoginStore, ConsoleLogin, credentials } = require('../core/console-login');
const origin = 'https://panel.example:4174';
const login = { endpoint: '/api/auth/login', username: 'fixture-admin', password: 'fixture-private-password' };
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-login-unit-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const key = randomBytes(32);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decryptStringAsync: async bytes => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return { result: Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString() }; },
  };
  const store = new ConsoleLoginStore({ directory, safeStorage });
  return { store, directory, safeStorage };
}
const response = (authenticated, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ authenticated }) });

test('vault encrypts account, password and origin and survives a new store instance', async t => {
  const { store, directory, safeStorage } = setup(t); await store.save(origin, login);
  const text = fs.readFileSync(store.file, 'utf8');
  for (const value of [origin, login.username, login.password]) assert.ok(!text.includes(value));
  const restored = new ConsoleLoginStore({ directory, safeStorage }); assert.deepEqual(await restored.get(origin), login);
  for (const other of ['http://panel.example:4174', 'https://panel.example:4175', 'https://another.example:4174']) assert.equal(await restored.get(other), null);
});
test('unavailable encryption, invalid payloads and damaged vault cannot create plaintext or discard existing records', async t => {
  const { store, safeStorage } = setup(t); safeStorage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(store.save(origin, login), /加密/); assert.ok(!fs.existsSync(store.file));
  for (const value of [{ ...login, endpoint: 'https://other.example' }, { ...login, password: '' }, { ...login, username: {} }]) assert.throws(() => credentials(value));
  fs.writeFileSync(store.file, 'broken'); const damaged = new ConsoleLoginStore({ directory: path.dirname(store.file), safeStorage });
  await assert.rejects(damaged.save(origin, login)); assert.equal(fs.readFileSync(store.file, 'utf8'), 'broken');
});
test('normal navigation with no opt-in neither posts credentials nor creates a vault', async t => {
  const { store } = setup(t), service = new ConsoleLogin({ store, fetch: () => { throw new Error('must not fetch'); } });
  assert.equal((await service.prepare(origin)).restored, false); assert.ok(!fs.existsSync(store.file));
});
test('remember saves only after a successful login and confirmed cookie session', async t => {
  const { store } = setup(t), calls = [];
  const service = new ConsoleLogin({ store, fetch: async (url, options) => { calls.push({ url, options }); return response(true); } });
  assert.equal((await service.login(origin, login)).remembered, true); assert.deepEqual(await store.get(origin), login);
  assert.equal(calls.length, 2); assert.equal(calls[0].url, origin + '/api/auth/login'); assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].options.body), { username: login.username, password: login.password });
});
test('failed login and missing cookie session never store new credentials or keep the old account', async t => {
  const { store } = setup(t); await store.save(origin, login);
  const denied = new ConsoleLogin({ store, fetch: async () => response(false, 401) });
  await assert.rejects(denied.login(origin, { ...login, username: 'replacement' })); assert.equal(store.has(origin), false);
  let count = 0; const missing = new ConsoleLogin({ store, fetch: async () => response(++count === 1) });
  await assert.rejects(missing.login(origin, login), /有效登录会话/); assert.equal(store.has(origin), false);
});
test('valid server cookie is reused without sending the saved password again', async t => {
  const { store } = setup(t); await store.save(origin, login); const calls = [];
  const service = new ConsoleLogin({ store, fetch: async (url, options) => { calls.push(options.method); return response(true); } });
  assert.equal((await service.prepare(origin)).restored, true); assert.deepEqual(calls, ['GET']);
});
test('server restart or expiry performs one opted-in login, without bypassing authentication', async t => {
  const { store } = setup(t); await store.save(origin, login); const calls = [];
  const service = new ConsoleLogin({ store, fetch: async (url, options) => { calls.push(options.method); return response(options.method === 'POST'); } });
  assert.equal((await service.prepare(origin)).restored, true); assert.deepEqual(calls, ['GET', 'POST']);
  assert.equal((await service.prepare(origin)).restored, false); assert.deepEqual(calls, ['GET', 'POST']);
});
test('changed password removes saved login; transient failure retains it without a retry loop', async t => {
  const { store } = setup(t); await store.save(origin, login); let calls = 0;
  const service = new ConsoleLogin({ store, fetch: async () => response(false, ++calls === 1 ? 200 : 401) });
  await assert.rejects(service.prepare(origin)); assert.equal(store.has(origin), false);
  await store.save(origin, login); const offline = new ConsoleLogin({ store, fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.prepare(origin), /offline/); assert.ok(store.has(origin));
  assert.equal((await offline.prepare(origin)).restored, false);
});
test('forget during an in-flight login prevents a late encrypted save and later auto login', async t => {
  const { store } = setup(t); let release, called;
  const started = new Promise(resolve => { called = resolve; });
  const service = new ConsoleLogin({ store, fetch: async () => { called(); return new Promise(resolve => { release = () => resolve(response(true)); }); } });
  const pending = service.login(origin, login); await started; service.forget(origin); release();
  await assert.rejects(pending); assert.equal(store.has(origin), false); assert.equal((await service.prepare(origin)).restored, false);
});
test('wrong-key encrypted data is forgotten without revealing the encrypted account', async t => {
  const { store, safeStorage } = setup(t); await store.save(origin, login);
  safeStorage.decryptStringAsync = async () => { throw new Error(login.password); };
  await assert.rejects(store.get(origin), error => !error.message.includes(login.password)); assert.equal(store.has(origin), false);
});
test('login bridge accepts only the current top frame, recognized login path and explicit opt-in', async () => {
  const { CenterConsole } = require('../core/console');
  const panel = Object.create(CenterConsole.prototype), top = { url: origin + '/login' }; top.top = top;
  const sender = {}, calls = []; panel.url = origin; panel.view = { webContents: sender };
  panel.login = { login: async (...args) => { calls.push(args); return { restored: true }; } };
  const event = { sender, senderFrame: top };
  await assert.rejects(panel.loginRequest({ ...event, sender: {} }, { action: 'login', remember: true, credentials: login }));
  await assert.rejects(panel.loginRequest({ ...event, senderFrame: { top, url: top.url } }, { action: 'prepare' }));
  top.url = origin + '/'; await assert.rejects(panel.loginRequest(event, { action: 'prepare' }));
  top.url = origin + '/login'; await assert.rejects(panel.loginRequest(event, { action: 'login', credentials: login }));
  await panel.loginRequest(event, { action: 'login', remember: true, credentials: login }); assert.equal(calls.length, 1);
});
test('a logout cookie from an older release invalidates saved credentials without a login request', async t => {
  const { store } = setup(t); await store.save(origin, login);
  const service = new ConsoleLogin({ store, signedOut: async () => true, fetch: () => { throw new Error('must not fetch'); } });
  assert.equal((await service.prepare(origin)).restored, false); assert.equal(store.has(origin), false);
});
