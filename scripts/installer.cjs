const path = require('node:path');
function installerConfiguration({ output, version, test = false }) {
  return {
    appId: test ? 'com.z1og.safehouse.integration-test' : 'com.z1og.safehouse',
    productName: test ? 'Safehouse Update Test' : 'Safehouse',
    executableName: test ? 'SafehouseUpdateTest' : 'Safehouse',
    extraMetadata: { version },
    directories: { output, buildResources: path.join(__dirname, '../docs') },
    artifactName: test ? `Safehouse-Test-Setup-${version}.exe` : 'Safehouse-Setup-${version}-x64.exe',
    publish: [{ provider: 'github', owner: 'Z1og', repo: 'Safehouse', releaseType: 'release' }],
    win: { target: [{ target: 'nsis', arch: ['x64'] }], signAndEditExecutable: false },
    nsis: {
      oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
      include: path.join(__dirname, 'installer.nsh'), installerLanguages: ['zh_CN', 'en_US'],
      displayLanguageSelector: false, language: '2052',
      createStartMenuShortcut: true, createDesktopShortcut: !test, shortcutName: test ? 'Safehouse Update Test' : 'Safehouse',
      deleteAppDataOnUninstall: false, runAfterFinish: true, differentialPackage: false,
      uninstallDisplayName: test ? 'Safehouse Update Test' : 'Safehouse',
    },
  };
}
module.exports = { installerConfiguration };
