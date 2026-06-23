// ═══════════════════════════════════════════════════════════════
//  Free Captcha API v3 — Unified Entry Point
//  Cloudflare Turnstile + hCaptcha solver in one service.
//  Any site, any key.
// ═══════════════════════════════════════════════════════════════

import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { buildServer } from './api/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '9000', 10);
const POOL_WORKERS = parseInt(process.env.POOL_WORKERS || '0', 10); // 0 = no token pool workers
const REDIS_URL = process.env.REDIS_URL || '';

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  Free Captcha API v3');
  console.log('  Turnstile + hCaptcha — any site, any key');
  console.log('══════════════════════════════════════════════════');

  // Start API server first
  const app = await buildServer();
  await app.listen({ host: '0.0.0.0', port: PORT });
  console.log(`[Main] API server running on http://0.0.0.0:${PORT}`);
  console.log(`[Main] Docs: http://0.0.0.0:${PORT}/`);
  console.log(`[Main] Health: http://0.0.0.0:${PORT}/health`);

  // Start token pool workers if Redis is configured and POOL_WORKERS > 0
  if (REDIS_URL && POOL_WORKERS > 0) {
    console.log(`[Main] Starting ${POOL_WORKERS} token pool worker(s)...`);
    const workers = [];

    for (let i = 0; i < POOL_WORKERS; i++) {
      const worker = fork(path.join(__dirname, 'worker', 'token-pool.js'), [], {
        stdio: 'inherit',
        env: { ...process.env }, // Pass all env vars (sitekeys, redis, etc.)
      });
      workers.push(worker);

      worker.on('exit', (code) => {
        console.log(`[Main] Worker ${worker.pid} exited (${code}), restarting in 3s...`);
        setTimeout(() => {
          const newWorker = fork(path.join(__dirname, 'worker', 'token-pool.js'), [], {
            stdio: 'inherit',
            env: { ...process.env },
          });
          const idx = workers.indexOf(worker);
          if (idx >= 0) workers[idx] = newWorker;
        }, 3000);
      });
    }

    // Graceful shutdown
    const shutdown = async () => {
      console.log('[Main] Shutting down...');
      workers.forEach(w => w.kill());
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
