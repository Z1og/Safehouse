// Public project metadata only. No local account or server credentials.
const PROJECT = Object.freeze({
  name: 'Safehouse',
  repository: 'https://github.com/Z1og/Safehouse',
  group: '1002677414',
});
function projectLink(key) {
  if (key !== 'repository') throw new Error('未知的项目链接');
  return PROJECT[key];
}
module.exports = { PROJECT, projectLink };
