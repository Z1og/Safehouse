const test = require('node:test');
const assert = require('node:assert/strict');
const { Collections, parseParents } = require('../core/collections');

const row = (id, extra = {}) => ({ publishedfileid: id, consumer_appid: 550, file_type: 2, title: `Collection ${id}`, children: [{ publishedfileid: '88' }], num_children: 1, ...extra });
function html(items = [row('200')], options = {}) {
  const key = { appid: 550, section: 'collections', childpublishedfileid: '88', page: 1, ...options.key };
  const result = { eresult: 1, current_page: 1, total_pages: 2, total_count: 31, results: items, ...options.result };
  return `<script id="valve-ssr-data">${JSON.stringify({ renderContext: { queryData: JSON.stringify({ queries: [{ queryKey: ['workshop_browse', key, 1], state: { data: result } }] }) } })}</script>`;
}
test('parent collection parsing verifies reverse lookup, game, collection type and identity', () => {
  const result = parseParents(html([row('200'), row('200'), row('201', { consumer_appid: 440 }), row('202', { file_type: 0 }), row('203', { banned: true })]), '88', 1);
  assert.deepEqual(result.items.map(item => item.id), ['200']);
  assert.equal(result.items[0].isCollection, true); assert.equal(result.hasMore, true); assert.equal(result.totalPages, 2);
  assert.throws(() => parseParents(html([row('200', { children: [{ publishedfileid: '99' }] })]), '88', 1), /不匹配/);
  assert.throws(() => parseParents(html(), '99', 1), /无法读取/);
  assert.throws(() => parseParents(html(), '88', 2), /无法读取/);
  assert.throws(() => parseParents(html([], { key: { section: 'readytouseitems' } }), '88', 1), /无法读取/);
});
test('empty public collection list is distinct from blocked, malformed and failed Steam responses', () => {
  assert.equal(parseParents(html([], { result: { total_pages: 0, total_count: 0 } }), '88', 1).items.length, 0);
  for (const body of ['<div>captcha</div>', '{}', html([], { result: { eresult: 2 } }), html([], { result: { total_pages: -1 } })]) assert.throws(() => parseParents(body, '88', 1));
});
test('parent requests use only the official child filter, validate input and coalesce concurrent work', async () => {
  let calls = 0, now = 0;
  const collections = new Collections({ now: () => now, community: { request: async value => { calls++; const url = new URL(value); assert.equal(url.hostname, 'steamcommunity.com'); assert.equal(url.searchParams.get('childpublishedfileid'), '88'); assert.equal(url.searchParams.get('section'), 'collections'); return html(); } } });
  await Promise.all([collections.parents('88'), collections.parents('88')]); assert.equal(calls, 1);
  await collections.parents('88'); assert.equal(calls, 1);
  now = 180001; await collections.parents('88'); assert.equal(calls, 2);
  for (const page of [0, 1.5, 1001, '1']) await assert.rejects(collections.parents('88', page), /页码/);
  await assert.rejects(collections.parents('https://evil.example/?id=88'));
  assert.equal(calls, 2);
});
test('failed requests are not cached and can be retried', async () => {
  let calls = 0;
  const collections = new Collections({ community: { request: async () => { if (++calls === 1) throw Error('offline'); return html(); } } });
  await assert.rejects(collections.parents('88'), /offline/); await collections.parents('88'); assert.equal(calls, 2);
});
function memberFixture(children, details) {
  const calls = [];
  const community = { details: async id => ({ id, title: 'Fixture Collection' }), request: async (url, options) => {
    const body = new URLSearchParams(options.body); calls.push({ url, body });
    return JSON.stringify({ response: url.includes('GetCollectionDetails') ? { collectiondetails: [{ publishedfileid: '200', result: 1, children }] } : { publishedfiledetails: typeof details === 'function' ? details(body) : details } });
  } };
  return { collections: new Collections({ community }), calls };
}
test('members preserve author order and nested collection type, deduplicate and align metadata by ID', async () => {
  const { collections, calls } = memberFixture([{ publishedfileid: '89', sortorder: 2, filetype: 0 }, { publishedfileid: '88', sortorder: 0, filetype: 0 }, { publishedfileid: '201', sortorder: 1, filetype: 2 }, { publishedfileid: '88' }, { publishedfileid: 'bad' }, { publishedfileid: '200' }], ['89', '201', '88'].map(id => ({ publishedfileid: id, result: 1, consumer_app_id: 550, title: `Item ${id}` })));
  const result = await collections.members('200');
  assert.deepEqual(result.items.map(item => item.id), ['88', '201', '89']);
  assert.equal(result.items[1].isCollection, true); assert.equal(result.items[0].title, 'Item 88'); assert.equal(result.collection.memberCount, 3);
  assert.equal(calls[1].body.get('itemcount'), '3');
});
test('member pagination loads at most 30 metadata records and reuses collection membership', async () => {
  const children = Array.from({ length: 35 }, (_, i) => ({ publishedfileid: String(1000 + i), sortorder: i }));
  const { collections, calls } = memberFixture(children, body => Array.from({ length: Number(body.get('itemcount')) }, (_, i) => ({ publishedfileid: body.get(`publishedfileids[${i}]`), consumer_app_id: 550, result: 1, title: 'Mod' })));
  const first = await collections.members('200'), last = await collections.members('200', 2);
  assert.equal(first.items.length, 30); assert.equal(first.hasMore, true); assert.equal(last.items.length, 5); assert.equal(last.items[0].id, '1030'); assert.equal(last.hasMore, false);
  assert.equal(calls.filter(call => call.url.includes('GetCollectionDetails')).length, 1);
  assert.equal(calls.filter(call => call.url.includes('GetPublishedFileDetails')).length, 2);
});
test('missing, foreign and banned members remain visible as unavailable without usable metadata', async () => {
  const { collections } = memberFixture(['88', '89', '90'].map(publishedfileid => ({ publishedfileid })), [{ publishedfileid: '89', result: 1, consumer_app_id: 440 }, { publishedfileid: '90', result: 1, consumer_app_id: 550, banned: true }]);
  const result = await collections.members('200'); assert.equal(result.items.length, 3); assert.ok(result.items.every(item => item.unavailable));
});
test('private, mismatched, excessive and malformed collections fail explicitly', async () => {
  for (const collection of [{ publishedfileid: '200', result: 9 }, { publishedfileid: '201', result: 1, children: [] }, { publishedfileid: '200', result: 1, children: new Array(10001).fill({}) }]) {
    const collections = new Collections({ community: { details: async () => ({}), request: async () => JSON.stringify({ response: { collectiondetails: [collection] } }) } });
    await assert.rejects(collections.members('200'));
  }
  const { collections } = memberFixture([{ publishedfileid: '88' }], null); await assert.rejects(collections.members('200'), /详情读取失败/);
});
test('cache stays bounded', async () => {
  const collections = new Collections({ community: {} });
  for (let i = 0; i < 140; i++) await collections.cached(String(i), async () => i);
  assert.equal(collections.cache.size, 120); assert.equal(collections.cache.has('0'), false);
});
