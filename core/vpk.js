const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseVdf } = require('./valve');
const { classify } = require('./classification');

function readVpk(file, { install = false } = {}) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(descriptor).size, header = Buffer.alloc(28);
    if (size < 12) throw new Error('VPK 文件不完整');
    fs.readSync(descriptor, header, 0, 28, 0);
    const version = header.readUInt32LE(4), treeSize = header.readUInt32LE(8), headerSize = version === 1 ? 12 : 28;
    if (header.readUInt32LE(0) !== 0x55aa1234 || ![1, 2].includes(version) || !treeSize || treeSize > 32 * 1024 ** 2 || headerSize + treeSize > size) throw new Error('无效的 VPK 文件头或目录');
    const dataEnd = version === 2 ? headerSize + treeSize + header.readUInt32LE(12) : size;
    if (dataEnd > size) throw new Error('VPK 数据区不完整');
    const tree = Buffer.alloc(treeSize);
    if (fs.readSync(descriptor, tree, 0, treeSize, headerSize) !== treeSize) throw new Error('VPK 目录读取不完整');
    const entries = [];
    let image = '';
    let cursor = 0;
    function string() {
      const end = tree.indexOf(0, cursor);
      if (end < 0) throw new Error('VPK 目录字符串损坏');
      const value = tree.subarray(cursor, end).toString('utf8'); cursor = end + 1; return value;
    }
    for (let extension = string(); extension; extension = string()) {
      for (let directory = string(); directory; directory = string()) {
        for (let name = string(); name; name = string()) {
          if (cursor + 18 > tree.length) throw new Error('VPK 文件记录不完整');
          const crc = tree.readUInt32LE(cursor), preload = tree.readUInt16LE(cursor + 4), archive = tree.readUInt16LE(cursor + 6), offset = tree.readUInt32LE(cursor + 8), length = tree.readUInt32LE(cursor + 12);
          if (tree.readUInt16LE(cursor + 16) !== 0xffff || cursor + 18 + preload > tree.length) throw new Error('VPK 文件记录损坏');
          const resource = `${directory === ' ' ? '' : directory + '/'}${name}${extension === ' ' ? '' : '.' + extension}`.replace(/\\/g, '/').toLowerCase();
          if (resource.split('/').some(part => part === '..') || /^[a-z]:|^\//.test(resource)) throw new Error('VPK 资源路径无效');
          if (install && /\.(exe|dll|bat|cmd|ps1|sh|so)$/i.test(resource)) throw new Error('安装包包含可执行文件');
          if (archive !== 0x7fff && length) {
            if (install) throw new Error('拖入安装暂不支持分卷 VPK，请使用完整 VPK 或 ZIP');
            const segment = file.replace(/_dir\.vpk$/i, `_${String(archive).padStart(3, '0')}.vpk`);
            if (segment === file || !fs.existsSync(segment) || offset + length > fs.statSync(segment).size) throw new Error('VPK 缺少分卷文件');
          } else if (length && headerSize + treeSize + offset + length > dataEnd) throw new Error('VPK 资源超出数据区');
          const preloadData = tree.subarray(cursor + 18, cursor + 18 + preload);
          const entry = { path: resource, crc, size: length + preload, signature: `${crc}:${length + preload}:${crypto.createHash('sha1').update(preloadData).digest('hex')}` };
          if (resource === 'addoninfo.txt' && length + preload <= 512 * 1024 && archive === 0x7fff) {
            const content = Buffer.alloc(length);
            fs.readSync(descriptor, content, 0, length, headerSize + treeSize + offset);
            entry.text = Buffer.concat([preloadData, content]).toString('utf8');
          }
          if (/^addonimage\.(jpg|jpeg|png|webp)$/.test(resource) && length + preload <= 512 * 1024 && archive === 0x7fff) {
            const content = Buffer.alloc(length);
            fs.readSync(descriptor, content, 0, length, headerSize + treeSize + offset);
            const format = /\.png$/.test(resource) ? 'png' : /\.webp$/.test(resource) ? 'webp' : 'jpeg';
            image = `data:image/${format};base64,${Buffer.concat([preloadData, content]).toString('base64')}`;
          }
          entries.push(entry); cursor += 18 + preload;
          if (entries.length > 250000) throw new Error('VPK 资源数量超出限制');
        }
      }
    }
    if (!entries.length) throw new Error('VPK 没有资源');
    let metadata = {};
    const info = entries.find(entry => entry.path === 'addoninfo.txt');
    if (info?.text) {
      const parsed = parseVdf(info.text);
      const infoKey = Object.keys(parsed).find(key => key.toLowerCase() === 'addoninfo');
      metadata = Object.fromEntries(Object.entries(parsed[infoKey] || {}).map(([key, value]) => [key.toLowerCase(), value]));
    }
    return { entries, ...classify(entries, metadata), title: metadata.addontitle || path.basename(file, '.vpk'), author: metadata.addonauthor || '本地作者', description: metadata.addondescription || metadata.addontagline || '', image, size };
  } finally { fs.closeSync(descriptor); }
}
module.exports = { readVpk };
