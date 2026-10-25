// Старые сценарии не меняем; их относительные PNG остаются в кеше.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { startVite, toolsRoot, tool, webRoot } from './lib/browser.mjs';

let vite;
let child;
const forward = signal => child?.kill(signal);
const sigint = () => forward('SIGINT');
const sigterm = () => forward('SIGTERM');
try {
  const [script, ...rest] = process.argv.slice(2);
  if (!script || !/^[\w-]+\.cjs$/.test(script) || rest.length) throw new Error('Использование: run-legacy.mjs <скрипт.cjs>');
  await tool('puppeteer-core');
  const base = join(homedir(), '.cache/pupitre/e2e');
  await mkdir(base, { recursive: true });
  const cwd = await mkdtemp(join(base, 'legacy-'));
  console.log(`Артефакты: ${cwd}`);
  vite = await startVite({ port: 5173 });
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);
  process.exitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [join(webRoot, 'e2e', script)], { cwd, stdio: 'inherit',
      env: { ...process.env, NODE_PATH: [toolsRoot, process.env.NODE_PATH].filter(Boolean).join(delimiter) },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)));
  });
} catch (error) {
  console.log(`E2E_FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  await vite?.close();
  process.off('SIGINT', sigint);
  process.off('SIGTERM', sigterm);
}
