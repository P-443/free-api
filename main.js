// ═══════════════════════════════════════════════════════════════
//  Free Captcha API v3 — Unified Entry Point
//  Auto-starts Python Turnstile solver + Node.js API server.
// ═══════════════════════════════════════════════════════════════

import { fork, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync } from 'fs';
import { buildServer } from './api/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '9000', 10);
const POOL_WORKERS = parseInt(process.env.POOL_WORKERS || '0', 10);
const REDIS_URL = process.env.REDIS_URL || '';
const PYTHON_SOLVER_DIR = path.join(__dirname, 'python_solver');

async function startPythonSolver() {
  const servicePy = path.join(PYTHON_SOLVER_DIR, 'service.py');
  if (!existsSync(servicePy)) {
    console.log('[Main] Python solver not found, skipping (Turnstile will use built-in fallback)');
    return null;
  }

  console.log('[Main] Starting Python Turnstile solver (nodriver)...');

  // Start Xvfb if on Linux
  const isLinux = process.platform === 'linux';
  if (isLinux && !process.env.DISPLAY) {
    try {
      spawn('Xvfb', [':99', '-screen', '0', '1280x900x24'], { stdio: 'ignore', detached: true });
      process.env.DISPLAY = ':99';
      console.log('[Main] Xvfb started on :99');
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log('[Main] Xvfb failed (may already be running):', e.message);
    }
  }

  const py = spawn('python3', [servicePy], {
    cwd: PYTHON_SOLVER_DIR,
    stdio: 'inherit',
    env: { ...process.env, PORT: '8191' },
  });

  py.on('exit', (code) => {
    console.log(`[Main] Python solver exited (${code}), restarting in 3s...`);
    setTimeout(() => startPythonSolver(), 3000);
  });

  // Wait for Python solver to be ready
  console.log('[Main] Waiting for Python solver on :8191...');
  for (let i = 0; i < 15; i++) {
    try {
      await fetch('http://127.0.0.1:8191/health');
      console.log('[Main] Python solver ready!');
      return py;
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log('[Main] Python solver not responding — Turnstile will use built-in fallback');
  return py; // Return process anyway, might still be starting
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  Free Captcha API v3');
  console.log('  Turnstile + hCaptcha — any site, any key');
  console.log('══════════════════════════════════════════════════');

  // Start Python Turnstile solver FIRST
  const pyProcess = await startPythonSolver();

  // Start API server
  const app = await buildServer();
  await app.listen({ host: '0.0.0.0', port: PORT });
  console.log(`[Main] API server running on http://0.0.0.0:${PORT}`);
  console.log(`[Main] Panel: http://0.0.0.0:${PORT}/`);
  console.log(`[Main] Docs:  http://0.0.0.0:${PORT}/docs`);
  console.log(`[Main] Health: http://0.0.0.0:${PORT}/health`);

  // Token pool workers (optional)
  if (REDIS_URL && POOL_WORKERS > 0) {
    console.log(`[Main] Starting ${POOL_WORKERS} token pool worker(s)...`);
    const workers = [];
    for (let i = 0; i < POOL_WORKERS; i++) {
      const worker = fork(path.join(__dirname, 'worker', 'token-pool.js'), [], {
        stdio: 'inherit', env: { ...process.env },
      });
      workers.push(worker);
      worker.on('exit', (code) => {
        console.log(`[Main] Worker ${worker.pid} exited (${code}), restarting...`);
        const newWorker = fork(path.join(__dirname, 'worker', 'token-pool.js'), [], {
          stdio: 'inherit', env: { ...process.env },
        });
        const idx = workers.indexOf(worker);
        if (idx >= 0) workers[idx] = newWorker;
      });
    }
    const shutdown = async () => {
      console.log('[Main] Shutting down...');
      workers.forEach(w => w.kill());
      if (pyProcess) pyProcess.kill();
      await app.close();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } else {
    const shutdown = async () => {
      console.log('[Main] Shutting down...');
      if (pyProcess) pyProcess.kill();
      await app.close();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

main().catch(e => {
  console.error('[Main] Fatal error:', e);
  process.exit(1);
});
