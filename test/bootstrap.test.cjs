const { it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');

it(
  'starts the production entrypoint and shuts down on SIGTERM with an active simulator',
  { timeout: 15000 },
  async (t) => {
    // A temporary working directory prevents this test from reading the real .env.
    const child = spawn(process.execPath, [path.resolve(__dirname, '../dist/main.js')], {
      cwd: tmpdir(),
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    let output = '';
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Production bootstrap timed out')), 7000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = /Server is running on (http:\/\/[^\s\u001b]+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Server exited before startup'));
      });
    });
    const base = await started;
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'UP');
    const simulated = await fetch(base + '/live/simulate/start', { method: 'POST' });
    assert.equal(simulated.status, 200);
    child.kill('SIGTERM');
    const result = await exited;
    assert.ok(result.code === 0 || result.signal === 'SIGTERM');
  },
);
