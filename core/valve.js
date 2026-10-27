const fs = require('node:fs');

// Valve KeyValues uses quoted strings, nested objects and // comments.
function parseVdf(text) {
  const tokens = text.replace(/^\uFEFF/, '').match(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|[{}]|[^\s{}"]+/g) || [];
  let position = 0;
  const string = token => token.startsWith('"') ? token.slice(1, -1).replace(/\\(["\\])/g, '$1') : token;
  function object(nested = false) {
    const result = {};
    while (position < tokens.length) {
      let token = tokens[position++];
      if (token.startsWith('//')) continue;
      if (token === '}') { if (!nested) throw new Error('KeyValues 多余的右括号'); return result; }
      if (token === '{') throw new Error('KeyValues 缺少键名');
      const key = string(token);
      while (tokens[position]?.startsWith('//')) position++;
      token = tokens[position++];
      if (token === undefined || token === '}') throw new Error('KeyValues 缺少值');
      result[key] = token === '{' ? object(true) : string(token);
    }
    if (nested) throw new Error('KeyValues 对象未闭合');
    return result;
  }
  return object();
}
function stringifyVdf(value, depth = 0) {
  const escape = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return Object.entries(value).map(([key, item]) => `${'\t'.repeat(depth)}${escape(key)}${typeof item === 'object' && item !== null ? `\n${'\t'.repeat(depth)}{\n${stringifyVdf(item, depth + 1)}${'\t'.repeat(depth)}}` : `\t\t${escape(item)}`}\n`).join('');
}
function atomicWrite(file, content) {
  const temporary = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, content, { mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
function readJson(file, defaults) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(defaults); throw error; }
}
module.exports = { parseVdf, stringifyVdf, atomicWrite, readJson };
