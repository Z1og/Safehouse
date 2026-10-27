const test = require('node:test');
const assert = require('node:assert/strict');
const { PROJECT, projectLink } = require('../core/project');

test('community links open only the fixed public project destinations', () => {
  assert.equal(PROJECT.group, '1002677414');
  assert.equal(projectLink('repository'), 'https://github.com/Z1og/Safehouse');
  for (const key of ['https://example.com', 'file:///C:/Windows', 'constructor', '__proto__', null]) assert.throws(() => projectLink(key));
});
