const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Translator, chunks, languageForBing } = require('../core/translator');

const page = () => new Response('<html data-iid="translator.fixture"><script>var _G={IG:"fixture-ig"};var params_AbusePreventionHelper = [12345,"fixture-token",3600000];</script></html>');
const bing = text => new Response(JSON.stringify([{ detectedLanguage: { language: 'en' }, translations: [{ text, to: 'zh-Hans' }] }]));
const google = text => new Response(JSON.stringify([[[text]], null, 'en']));
function setup(t, fetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-translator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  return new Translator({ file: path.join(root, 'cache.json'), fetch });
}
test('Bing translates public text, maps Chinese locales, deduplicates requests and persists only completed results', async t => {
  const calls = [];
  const translator = setup(t, async (url, options) => {
    calls.push({ url, options });
    if (new URL(url).pathname === '/translator') return page();
    assert.equal(options.method, 'POST');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('to'), 'zh-Hans'); assert.equal(body.get('text'), 'Hiding Gnome');
    return bing('隐藏侏儒');
  });
  const [a, b] = await Promise.all([translator.translate('Hiding Gnome', 'zh-CN'), translator.translate('Hiding Gnome', 'zh-CN')]);
  assert.deepEqual(a, b); assert.equal(a.text, '隐藏侏儒'); assert.equal(a.provider, 'Bing'); assert.equal(calls.length, 2);
  await translator.translate('Hiding Gnome', 'zh-CN'); assert.equal(calls.length, 2);
  const restored = new Translator({ file: translator.file, fetch: () => { throw new Error('must use saved result'); } });
  assert.deepEqual(await restored.translate('Hiding Gnome', 'zh-CN'), a);
  assert.ok(!fs.readFileSync(translator.file, 'utf8').includes('fixture-token'));
  assert.equal(languageForBing('zh-TW'), 'zh-Hant'); assert.equal(languageForBing('en-US'), 'en');
});
test('an unavailable Bing service falls back to Google without hiding the actual provider', async t => {
  const hosts = [];
  const translator = setup(t, async url => { hosts.push(new URL(url).hostname); return url.includes('cn.bing.com') ? new Response('', { status: 503 }) : google('测试译文'); });
  const result = await translator.translate('test', 'zh-CN');
  assert.equal(result.text, '测试译文'); assert.equal(result.provider, 'Google');
  assert.deepEqual(hosts, ['cn.bing.com', 'translate.googleapis.com']);
});
test('failures are not cached; cooldown avoids repeated failed calls and explicit retry recovers', async t => {
  let working = false, calls = 0;
  const translator = setup(t, async url => { calls++; if (!working) return new Response('', { status: 503 }); return new URL(url).pathname === '/translator' ? page() : bing('已恢复'); });
  await assert.rejects(translator.translate('first', 'zh-CN'), /必应：HTTP 503.*Google：HTTP 503/);
  await assert.rejects(translator.translate('another', 'zh-CN'), /暂不可用/); assert.equal(calls, 2);
  assert.equal(Object.keys(translator.cache).length, 0); assert.equal(translator.pending.size, 0);
  working = true;
  assert.equal((await translator.translate('first', 'zh-CN', { retry: true })).text, '已恢复'); assert.equal(calls, 4);
});
test('total deadline stops a transport that ignores AbortSignal instead of waiting forever', async t => {
  const translator = setup(t, () => new Promise(() => {})), start = Date.now();
  await assert.rejects(translator.translate('never resolves', 'zh-CN', { timeoutMs: 50 }), /超过等待时限/);
  assert.ok(Date.now() - start < 600); assert.equal(translator.pending.size, 0); assert.equal(Object.keys(translator.cache).length, 0);
  translator.fetch = async url => new URL(url).pathname === '/translator' ? page() : bing('超时后重试恢复');
  assert.equal((await translator.translate('never resolves', 'zh-CN', { retry: true })).text, '超时后重试恢复');
});
test('total deadline also includes stalled response bodies', async t => {
  const translator = setup(t, async url => new URL(url).pathname === '/translator' ? page() : { ok: true, json: () => new Promise(() => {}) });
  const start = Date.now(); await assert.rejects(translator.translate('body stalls', 'zh-CN', { timeoutMs: 50 }), /超过等待时限/);
  assert.ok(Date.now() - start < 600); assert.equal(Object.keys(translator.cache).length, 0);
});
test('long text uses two bounded workers, preserves paragraph breaks and never splits a Unicode surrogate pair', async t => {
  const text = ('An English paragraph with words.\n\n').repeat(90) + '😀'.repeat(620);
  const parts = chunks(text); assert.equal(parts.join(''), text); assert.ok(parts.every(part => part.length <= 1000));
  assert.ok(parts.every(part => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part)));
  let active = 0, maximum = 0;
  const translator = setup(t, async (url, options) => {
    if (new URL(url).pathname === '/translator') return page();
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return bing(new URLSearchParams(options.body).get('text').trimEnd());
  });
  const result = await translator.translate(text, 'zh-CN'); assert.equal(result.text, text); assert.equal(maximum, 2);
});
test('long text shares one deadline across every chunk, without partial cache writes', async t => {
  const translator = setup(t, async url => {
    if (new URL(url).pathname === '/translator') return page();
    await new Promise(resolve => setTimeout(resolve, 35)); return bing('一段译文');
  });
  const start = Date.now(); await assert.rejects(translator.translate('word '.repeat(1800), 'zh-CN', { timeoutMs: 60 }), /超过等待时限/);
  assert.ok(Date.now() - start < 600); assert.equal(Object.keys(translator.cache).length, 0);
});
test('expired Bing authorization clears its token and retry acquires a fresh one', async t => {
  let expired = true, pages = 0;
  const translator = setup(t, async url => {
    if (new URL(url).pathname === '/translator') { pages++; return page(); }
    return expired ? new Response('', { status: 401 }) : bing('重试成功');
  });
  // Prevent the Google fixture from being mistaken for a successful fallback.
  const fetch = translator.fetch; translator.fetch = (url, options) => url.includes('googleapis') ? Promise.resolve(new Response('', { status: 503 })) : fetch(url, options);
  await assert.rejects(translator.translate('expired', 'zh-CN'), /401/); assert.equal(translator.bingToken, null);
  expired = false; assert.equal((await translator.translate('expired', 'zh-CN', { retry: true })).text, '重试成功'); assert.equal(pages, 2);
});
test('malformed service results remain explicit failures rather than invented translations', async t => {
  const translator = setup(t, async url => new URL(url).pathname === '/translator' ? page() : new Response('{}'));
  await assert.rejects(translator.translate('malformed', 'zh-CN'), /暂不可用/); assert.equal(Object.keys(translator.cache).length, 0);
});
test('cache write failures do not discard a successful translation', async t => {
  const translator = setup(t, async url => new URL(url).pathname === '/translator' ? page() : bing('译文仍显示'));
  translator.file = path.join(path.dirname(translator.file), 'missing-directory', 'cache.json');
  const result = await translator.translate('test', 'zh-CN'); assert.equal(result.text, '译文仍显示'); assert.match(result.warning, /缓存未能保存/);
});
