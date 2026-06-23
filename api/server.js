// ═══════════════════════════════════════════════════════════════
//  Unified Captcha API Server — Fastify
//  Endpoints: Turnstile + hCaptcha + Token Pool + Health
// ═══════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { solveTurnstile } from '../solver/turnstile.js';
import { solveHCaptcha } from '../solver/hcaptcha.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Read the panel HTML at startup (served at /)
const PANEL_HTML = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf-8');

// Redis — optional. If REDIS_URL not set, pool features are disabled.
const REDIS_URL = process.env.REDIS_URL || '';
let redis = null;
if (REDIS_URL) {
  redis = new Redis(REDIS_URL, { socketTimeout: 30000, socketKeepalive: true });
  console.log('[API] Redis connected — token pool enabled');
} else {
  console.log('[API] No REDIS_URL set — token pool disabled, direct solve only');
}

export async function buildServer() {
  const app = Fastify({ logger: false });

  // ═══════════════════════════════════════════════════════════
  //  HOME — HC Panel Dashboard
  // ═══════════════════════════════════════════════════════════
  app.get('/', async (_req, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-cache');
    return PANEL_HTML;
  });

  // ═══════════════════════════════════════════════════════════
  //  API DOCS — JSON endpoint list
  // ═══════════════════════════════════════════════════════════
  app.get('/docs', async (_req, reply) => {
    const poolSize = redis ? await redis.llen('hcaptcha_tokens').catch(() => 0) : 0;
    return {
      name: 'Free Captcha API v3',
      description: 'Unified solver for Cloudflare Turnstile & hCaptcha — any site, any key',
      endpoints: {
        '/': 'GET — This documentation',
        '/health': 'GET — Service health & pool status',
        '/solve/turnstile': 'POST — Solve Cloudflare Turnstile (direct)',
        '/solve/hcaptcha': 'POST — Solve hCaptcha (direct, with optional proxy)',
        '/get-hcaptcha-token': 'GET — Get pre-solved hCaptcha token from pool (Redis required)',
        '/get-turnstile-token': 'GET — Get pre-solved Turnstile token from pool (Redis required)',
      },
      pool: {
        enabled: !!redis,
        hcaptcha_size: poolSize,
      },
      usage_examples: {
        turnstile: {
          method: 'POST',
          url: '/solve/turnstile',
          body: {
            sitekey: '0x4AAAAAAActoBfh_En8yr3T',
            siteurl: 'https://example.com/',
            timeout: 45,
          },
          response: { status: 'success', token: '0.abc123...', elapsed: 4.23 },
        },
        hcaptcha: {
          method: 'POST',
          url: '/solve/hcaptcha',
          body: {
            sitekey: '463b917e-e264-403f-ad34-34af0ee10294',
            siteurl: 'https://example.com/',
            proxy: { server: 'http://ip:port', username: 'user', password: 'pass' },
          },
          response: { status: 'success', token: 'P0_abc123...', elapsed: 5.67 },
        },
      },
    };
  });

  // ═══════════════════════════════════════════════════════════
  //  HEALTH
  // ═══════════════════════════════════════════════════════════
  app.get('/health', async (_req, reply) => {
    const poolSize = redis ? await redis.llen('hcaptcha_tokens').catch(() => 0) : 0;
    return { status: 'ok', redis: !!redis, hcaptcha_pool_size: poolSize };
  });

  // ═══════════════════════════════════════════════════════════
  //  SOLVE TURNSTILE — direct solve, any site
  // ═══════════════════════════════════════════════════════════
  app.post('/solve/turnstile', async (req, reply) => {
    const { sitekey, siteurl, timeout, proxy } = req.body || {};

    if (!sitekey || !siteurl) {
      return reply.code(400).send({ status: 'error', detail: 'sitekey and siteurl are required' });
    }

    const t0 = Date.now();
    try {
      console.log(`[API] Turnstile solve: sitekey=${sitekey.slice(0, 20)}... url=${siteurl}`);
      const token = await solveTurnstile(sitekey, siteurl, timeout || 45, proxy || null);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.log(`[API] Turnstile solved in ${elapsed}s  token=${token.slice(0, 20)}...`);
      return { status: 'success', token, elapsed: parseFloat(elapsed) };
    } catch (e) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.error(`[API] Turnstile error after ${elapsed}s:`, e.message);
      return reply.code(500).send({ status: 'error', detail: e.message, elapsed: parseFloat(elapsed) });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  SOLVE HCAPTCHA — direct solve, any site, optional proxy
  // ═══════════════════════════════════════════════════════════
  app.post('/solve/hcaptcha', async (req, reply) => {
    const { sitekey, siteurl, proxy } = req.body || {};

    if (!sitekey || !siteurl) {
      return reply.code(400).send({ status: 'error', detail: 'sitekey and siteurl are required' });
    }

    const proxies = proxy ? [proxy] : [];
    const t0 = Date.now();
    try {
      console.log(`[API] hCaptcha solve: sitekey=${sitekey.slice(0, 20)}... url=${siteurl}`);
      const token = await solveHCaptcha(sitekey, siteurl, proxies);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      if (token) {
        console.log(`[API] hCaptcha solved in ${elapsed}s  token=${token.slice(0, 20)}...`);
        return { status: 'success', token, elapsed: parseFloat(elapsed) };
      }
      return reply.code(500).send({ status: 'error', detail: 'All attempts failed to solve hCaptcha', elapsed: parseFloat(elapsed) });
    } catch (e) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.error(`[API] hCaptcha error after ${elapsed}s:`, e.message);
      return reply.code(500).send({ status: 'error', detail: e.message, elapsed: parseFloat(elapsed) });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  GET HCAPTCHA TOKEN FROM POOL — instant (Redis required)
  // ═══════════════════════════════════════════════════════════
  app.get('/get-hcaptcha-token', async (_req, reply) => {
    if (!redis) {
      return reply.code(503).send({ status: 'error', detail: 'Token pool disabled. Set REDIS_URL and run workers.' });
    }
    // BLPOP: waits up to 20s for a token
    const result = await redis.blpop('hcaptcha_tokens', 20);
    if (result) {
      return { status: 'success', token: result[1] };
    }
    return reply.code(504).send({ status: 'error', detail: 'All workers are currently overloaded. Please retry.' });
  });

  // ═══════════════════════════════════════════════════════════
  //  GET TURNSTILE TOKEN FROM POOL — instant (Redis required)
  // ═══════════════════════════════════════════════════════════
  app.get('/get-turnstile-token', async (_req, reply) => {
    if (!redis) {
      return reply.code(503).send({ status: 'error', detail: 'Token pool disabled. Set REDIS_URL and run workers.' });
    }
    const result = await redis.blpop('turnstile_tokens', 20);
    if (result) {
      return { status: 'success', token: result[1] };
    }
    return reply.code(504).send({ status: 'error', detail: 'All workers are currently overloaded. Please retry.' });
  });

  return app;
}
