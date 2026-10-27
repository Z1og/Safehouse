const fs = require('node:fs');
const path = require('node:path');
function vpk(resources) {
  const groups = new Map();
  for (const [name, value] of Object.entries(resources)) {
    const extension = path.posix.extname(name).slice(1) || ' ', directory = path.posix.dirname(name) === '.' ? ' ' : path.posix.dirname(name), stem = path.posix.basename(name, path.posix.extname(name));
    if (!groups.has(extension)) groups.set(extension, new Map());
    const directories = groups.get(extension); if (!directories.has(directory)) directories.set(directory, []);
    directories.get(directory).push({ stem, data: Buffer.from(value) });
  }
  const tree = [], zero = Buffer.from([0]);
  for (const [extension, directories] of groups) {
    tree.push(Buffer.from(extension + '\0'));
    for (const [directory, files] of directories) {
      tree.push(Buffer.from(directory + '\0'));
      for (const { stem, data } of files) {
        const record = Buffer.alloc(18); record.writeUInt16LE(data.length, 4); record.writeUInt16LE(0x7fff, 6); record.writeUInt16LE(0xffff, 16);
        tree.push(Buffer.from(stem + '\0'), record, data);
      }
      tree.push(zero);
    }
    tree.push(zero);
  }
  tree.push(zero);
  const directory = Buffer.concat(tree), header = Buffer.alloc(12);
  header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(directory.length, 8);
  return Buffer.concat([header, directory]);
}
function game(root) {
  const gameRoot = path.join(root, 'steamapps', 'common', 'Left 4 Dead 2');
  const addons = path.join(gameRoot, 'left4dead2', 'addons'); fs.mkdirSync(addons, { recursive: true });
  fs.writeFileSync(path.join(gameRoot, 'left4dead2', 'gameinfo.txt'), '"GameInfo" { "game" "Left 4 Dead 2" }');
  fs.writeFileSync(path.join(root, 'steamapps', 'appmanifest_550.acf'), '"AppState" { "appid" "550" "installdir" "Left 4 Dead 2" }');
  return { gameRoot, addons };
}
module.exports = { vpk, game };
