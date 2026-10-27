const path = require('node:path');
const { spawn } = require('node:child_process');
const { runtime } = require('./runtime.cjs');

try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(runtime(), [path.join(__dirname, '..')], { env, stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
