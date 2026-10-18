const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Backend } = require('../backend');

test('construction does not install or start the song server', () => {
  const backend = new Backend('/unused', '/unused', () => {});
  assert.equal(backend.proc, null);
  assert.equal(backend.startPromise, null);
});

test('concurrent callers wait for the same startup', async () => {
  const backend = new Backend('/unused', '/unused', () => {});
  let resolve;
  let calls = 0;
  backend.startOnce = () => { calls++; return new Promise((done) => { resolve = done; }); };
  const first = backend.start();
  const second = backend.start();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve();
  await first;
  assert.equal(backend.startPromise, null);
});

test('failed startup can be retried', async () => {
  const backend = new Backend('/unused', '/unused', () => {});
  backend.startOnce = async () => { throw new Error('network'); };
  await assert.rejects(backend.start(), /network/);
  assert.equal(backend.startPromise, null);
  backend.startOnce = async () => {};
  await backend.start();
});

test('dependency installation is refreshed when requirements change', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pupitre-backend-test-'));
  try {
    const api = path.join(tmp, 'api');
    fs.mkdirSync(api);
    fs.writeFileSync(path.join(api, 'requirements.txt'), 'fastapi>=0.115\n');
    const backend = new Backend(tmp, api, () => {});
    const python = process.platform === 'win32'
      ? path.join(backend.root, 'venv/Scripts/python.exe') : path.join(backend.root, 'venv/bin/python');
    fs.mkdirSync(path.dirname(python), {recursive: true});
    fs.writeFileSync(python, '');
    let installs = 0;
    backend.runUv = async () => { installs++; };
    await backend.ensureEnv('/unused');
    await backend.ensureEnv('/unused');
    assert.equal(installs, 1);
    fs.appendFileSync(path.join(api, 'requirements.txt'), 'numpy>=1.26\n');
    await backend.ensureEnv('/unused');
    assert.equal(installs, 2);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});
