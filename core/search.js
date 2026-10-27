const { aliases, direct } = require('../renderer/search-catalog');

class SearchPlanner {
  constructor(translator) { this.translator = translator; this.cache = new Map(); }
  async plan(value) {
    if (typeof value !== 'string' || value.length > 200) throw new Error('搜索内容需要在 200 个字符以内');
    const query = value.trim();
    if (!query || direct(query)) return { original: query, queries: [query], warning: '' };
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.time < 5 * 60 * 1000) return cached.promise;
    const promise = this.expand(query);
    this.cache.set(query, { time: Date.now(), promise });
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    return promise;
  }
  async expand(query) {
    const queries = aliases(query), chinese = /[\u3400-\u9fff]/u.test(query);
    let warning = '';
    // Complete domain aliases work offline; arbitrary phrases use a short, cached translation.
    if (!(chinese && queries.length > 1 && !/[\u3400-\u9fff]/u.test(queries[1]))) {
      try {
        const translated = await this.translator.translate(query, chinese ? 'en' : 'zh-CN', { timeoutMs: 4500 });
        if (translated.text.trim().length <= 200) queries.push(translated.text.trim());
      } catch { warning = '在线关键词翻译暂不可用，已使用原词和本地中英文词库'; }
    }
    return { original: query, queries: [...new Set(queries)].slice(0, 3), warning };
  }
}

class BilingualSearch {
  constructor(community, planner) { this.community = community; this.planner = planner; this.sessions = new Map(); }
  async search(query = '', page = 1, category = 'all', subcategory = 'all') {
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('页码无效');
    const plan = await this.planner.plan(query);
    if (plan.queries.length === 1) return { ...await this.community.search(plan.queries[0], page, category, subcategory), search: plan };
    const key = JSON.stringify([plan.queries, category, subcategory]);
    let state = this.sessions.get(key);
    if (!state || Date.now() - state.created > 10 * 60 * 1000) {
      state = { created: Date.now(), sources: plan.queries.map(query => ({ query, page: 0, queue: [], more: true })), seen: new Set(), pages: [], pending: Promise.resolve(), cursor: 0 };
      this.sessions.set(key, state);
      if (this.sessions.size > 8) this.sessions.delete(this.sessions.keys().next().value);
    }
    const run = state.pending.then(async () => {
      if (page > state.pages.length + 10) throw new Error('请依次浏览双语搜索结果页');
      while (state.pages.length < page) {
        if (state.pages.length && !state.pages.at(-1).hasMore) return { items: [], page, hasMore: false, search: plan };
        const items = [], warnings = [];
        let failures = 0;
        while (items.length < 30) {
          const empty = state.sources.filter(source => source.more && !source.queue.length);
          const fetched = await Promise.allSettled(empty.map(async source => {
            const result = await this.community.search(source.query, source.page + 1, category, subcategory);
            source.page++; source.queue = [...result.items]; source.more = !!result.hasMore;
          }));
          fetched.forEach((result, index) => {
            if (result.status === 'rejected') { failures++; empty[index].more = false; warnings.push(`「${empty[index].query}」查询失败：${result.reason.message}`); }
          });
          let found = false;
          for (let index = 0; index < state.sources.length && items.length < 30; index++) {
            const source = state.sources[state.cursor++ % state.sources.length];
            while (source.queue.length) {
              const item = source.queue.shift();
              if (state.seen.has(item.id)) continue;
              state.seen.add(item.id); items.push(item); found = true; break;
            }
          }
          if (!found && !state.sources.some(source => source.queue.length || source.more)) break;
        }
        if (!items.length && failures === state.sources.length) { this.sessions.delete(key); throw new Error(warnings.join('；')); }
        const hasMore = state.sources.some(source => source.more || source.queue.some(item => !state.seen.has(item.id)));
        state.pages.push({ items, page: state.pages.length + 1, hasMore, search: { ...plan, warning: [plan.warning, ...warnings].filter(Boolean).join('；') } });
      }
      return state.pages[page - 1];
    });
    state.pending = run.catch(() => {});
    return run;
  }
}
module.exports = { SearchPlanner, BilingualSearch };
