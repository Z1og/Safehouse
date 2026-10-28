const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const metadata = require('../package.json');
const visited = new Set(), notices = ['Safehouse — Third-party notices\n\nOriginal project license: LICENSE. Dependency licenses remain independent.\n'];
function visit(name, parent) {
  const file = createRequire(path.join(parent, 'package.json')).resolve.paths(name)
    .map(dir => path.join(dir, name, 'package.json')).find(value => fs.existsSync(value));
  if (!file) throw new Error(`Missing installed package: ${name}`);
  const dir = path.dirname(file);
  if (visited.has(dir)) return;
  visited.add(dir);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  notices.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license || 'See upstream license'}\n`);
  const files = fs.readdirSync(dir).filter(value => /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(value) && fs.statSync(path.join(dir, value)).isFile());
  if (!files.length) {
    const fallback = path.join(root, 'docs', 'licenses', `${pkg.name.replace('/', '-')}-LICENSE`);
    if (!fs.existsSync(fallback)) throw new Error(`Missing license text: ${pkg.name}`);
    notices.push(`\n--- License text / attribution (not included in the npm archive) ---\n${fs.readFileSync(fallback, 'utf8')}\n`);
  }
  for (const value of files) notices.push(`\n--- ${value} ---\n${fs.readFileSync(path.join(dir, value), 'utf8')}\n`);
  for (const dependency of Object.keys(pkg.dependencies || {}).sort()) visit(dependency, dir);
}
for (const name of Object.keys(metadata.dependencies).sort()) visit(name, root);
notices.push('\nElectron and Chromium notices are shipped alongside the application executable as LICENSE and LICENSES.chromium.html.\n');
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), notices.join('').replace(/[ \t]+$/gm, ''));
console.log(`Collected license texts for ${visited.size} production packages.`);
