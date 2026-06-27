// ═══════════════════════════════════════════════════════════════
//  Unified Captcha API Server — Fastify
//  Endpoints: Turnstile + hCaptcha + Token Pool + Health
// ═══════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { solveTurnstile } from '../clients/turnstileClient.js';
import { solveHCaptcha } from '../clients/hcaptchaClient.js';
import { solveReCaptcha } from '../clients/recaptchaClient.js';
import { REDIS_URL, REDIS_ENABLED, TURNSTILE_SOLVER_URL } from '../config/index.js';
import { buildDocsHTML, buildMethodHTML, buildHealthHTML } from '../shared/htmlTemplates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Read static files at startup
const PANEL_HTML = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf-8');
const FAVICON_SVG = readFileSync(join(__dirname, '..', 'public', 'favicon.svg'), 'utf-8');
const LOGO_SVG = readFileSync(join(__dirname, '..', 'public', 'logo.svg'), 'utf-8');

// Redis — optional
let redis = null;
if (REDIS_ENABLED) {
  redis = new Redis(REDIS_URL, { socketTimeout: 30000, socketKeepalive: true });
  console.log('[API] Redis connected — token pool enabled');
} else {
  console.log('[API] No REDIS_URL set — token pool disabled, direct solve only');
}

// ── Server-side stats (shared across all devices) ────────────
let totalSolved = 0;
let solveTimes = [];
const solveHistory = [];

function recordSolve(type, token, elapsed, status) {
  totalSolved++;
  solveTimes.push(elapsed);
  if (solveTimes.length > 100) solveTimes = solveTimes.slice(-100);
  solveHistory.unshift({ type, token, elapsed, status, time: new Date().toISOString() });
  if (solveHistory.length > 100) solveHistory.length = 100;
}

function getAvgSpeed() {
  if (solveTimes.length === 0) return null;
  return parseFloat((solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length).toFixed(1));
}

export async function buildServer() {
  const app = Fastify({ logger: false });

  // ═══════════════════════════════════════════════════════════
  //  STATS — server-side counters (shared across all devices)
  // ═══════════════════════════════════════════════════════════
  app.get('/stats', async (_req, reply) => {
    return {
      totalSolved,
      avgSpeed: getAvgSpeed(),
      history: solveHistory.slice(0, 50),
    };
  });

  // ═══════════════════════════════════════════════════════════
  //  HOME — HC Panel Dashboard
  // ═══════════════════════════════════════════════════════════
  app.get('/', async (_req, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-cache');
    return PANEL_HTML;
  });

  // ═══════════════════════════════════════════════════════════
  //  STATIC FILES — favicon & logo
  // ═══════════════════════════════════════════════════════════
  app.get('/favicon.svg', async (_req, reply) => {
    reply.header('Content-Type', 'image/svg+xml');
    reply.header('Cache-Control', 'public, max-age=86400');
    return FAVICON_SVG;
  });
  app.get('/logo.svg', async (_req, reply) => {
    reply.header('Content-Type', 'image/svg+xml');
    reply.header('Cache-Control', 'public, max-age=86400');
    return LOGO_SVG;
  });

  // ═══════════════════════════════════════════════════════════
  //  API DOCS — Beautiful HTML page
  // ═══════════════════════════════════════════════════════════
  app.get('/docs', async (req, reply) => {
    const poolSize = redis ? await redis.llen('hcaptcha_tokens').catch(() => 0) : 0;
    // JSON for machines (?json=1) — HTML for humans
    if (req.query.json !== undefined) {
      return {
        name: 'Free Captcha API v3',
        description: 'Unified solver for Cloudflare Turnstile & hCaptcha — any site, any key',
        endpoints: {
          '/': 'GET — HC Panel Dashboard',
          '/docs': 'GET — API Documentation',
          '/health': 'GET — Service health & pool status',
          '/solve/turnstile': 'POST — Solve Cloudflare Turnstile (direct)',
          '/solve/hcaptcha': 'POST — Solve hCaptcha (direct, with optional proxy)',
          '/solve/recaptcha': 'POST — Solve reCAPTCHA v2 (direct, optional proxy) [NEW]',
          '/get-hcaptcha-token': 'GET — Pre-solved hCaptcha token from Redis pool',
          '/get-turnstile-token': 'GET — Pre-solved Turnstile token from Redis pool',
        },
        pool: { enabled: !!redis, hcaptcha_size: poolSize },
      };
    }
    const host = `${req.protocol}://${req.hostname}`;
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return buildDocsHTML(poolSize, host);
  });

  // ═══════════════════════════════════════════════════════════
  //  HEALTH — Beautiful HTML page (or JSON with ?json=1)
  // ═══════════════════════════════════════════════════════════
  app.get('/health', async (req, reply) => {
    const poolSize = redis ? await redis.llen('hcaptcha_tokens').catch(() => 0) : 0;
    if (req.query.json !== undefined) {
      return { status: 'ok', redis: !!redis, hcaptcha_pool_size: poolSize };
    }
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return buildHealthHTML(poolSize, process.uptime());
  });

  // ═══════════════════════════════════════════════════════════
  //  SOLVE TURNSTILE — uses Python nodriver solver (proven)
  //  Falls back to built-in Playwright solver if Python unavailable
  // ═══════════════════════════════════════════════════════════
  app.post('/solve/turnstile', async (req, reply) => {
    const { sitekey, siteurl, timeout, proxy } = req.body || {};

    if (!sitekey || !siteurl) {
      return reply.code(400).send({ status: 'error', detail: 'sitekey and siteurl are required' });
    }

    const t0 = Date.now();
    const PYTHON_SOLVER = TURNSTILE_SOLVER_URL;

    // Try Python nodriver solver first (proven working)
    try {
      console.log(`[API] Turnstile via Python: sitekey=${sitekey.slice(0, 20)}... url=${siteurl}`);
      const pyResp = await fetch(PYTHON_SOLVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sitekey, siteurl, timeout: timeout || 45 }),
        signal: AbortSignal.timeout((timeout || 45) * 1000 + 30000),
      });
      const pyData = await pyResp.json();
      if (pyResp.ok && (pyData.token || pyData.status === 'success')) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
        const tok = pyData.token || pyData;
        const finalToken = typeof tok === 'string' ? tok : tok.token;
        console.log(`[API] Python solved in ${elapsed}s`);
        recordSolve('turnstile', finalToken?.slice(0, 20) || '—', parseFloat(elapsed), 'success');
        return { status: 'success', token: finalToken, elapsed: parseFloat(elapsed) };
      }
      console.log('[API] Python solver failed, trying built-in...');
    } catch (pyErr) {
      console.log('[API] Python solver unreachable, using built-in:', pyErr.message);
    }

    // Fallback: built-in Playwright solver
    try {
      console.log(`[API] Turnstile built-in: sitekey=${sitekey.slice(0, 20)}... url=${siteurl}`);
      const token = await solveTurnstile(sitekey, siteurl, timeout || 45, proxy || null);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.log(`[API] Built-in solved in ${elapsed}s`);
      recordSolve('turnstile', token?.slice(0, 20) || '—', parseFloat(elapsed), 'success');
      return { status: 'success', token, elapsed: parseFloat(elapsed) };
    } catch (e) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.error(`[API] Turnstile error after ${elapsed}s:`, e.message);
      recordSolve('turnstile', '—', parseFloat(elapsed), 'failed');
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
        recordSolve('hcaptcha', token?.slice(0, 20) || '—', parseFloat(elapsed), 'success');
        return { status: 'success', token, elapsed: parseFloat(elapsed) };
      }
      recordSolve('hcaptcha', '—', parseFloat(elapsed), 'failed');
      return reply.code(500).send({ status: 'error', detail: 'All attempts failed to solve hCaptcha', elapsed: parseFloat(elapsed) });
    } catch (e) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.error(`[API] hCaptcha error after ${elapsed}s:`, e.message);
      recordSolve('hcaptcha', '—', parseFloat(elapsed), 'failed');
      return reply.code(500).send({ status: 'error', detail: e.message, elapsed: parseFloat(elapsed) });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  GET handlers — helpful messages when visiting from browser
  // ═══════════════════════════════════════════════════════════
  app.get('/solve/turnstile', async (req, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return buildMethodHTML(`${req.protocol}://${req.hostname}`, '/solve/turnstile', 'POST', 'Cloudflare Turnstile Solver');
  });
  app.get('/solve/hcaptcha', async (req, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return buildMethodHTML(`${req.protocol}://${req.hostname}`, '/solve/hcaptcha', 'POST', 'hCaptcha Solver');
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

  // ═══════════════════════════════════════════════════════════
  //  SOLVE RECAPTCHA V2 — Playwright real Chrome, any site key
  // ═══════════════════════════════════════════════════════════
  app.post('/solve/recaptcha', async (req, reply) => {
    const { sitekey, siteurl, proxy, headless } = req.body || {};

    if (!sitekey || !siteurl) {
      return reply.code(400).send({ status: 'error', detail: 'sitekey and siteurl are required' });
    }

    const t0 = Date.now();

    try {
      console.log(`[API] reCAPTCHA: sitekey=${sitekey.slice(0, 20)}... proxy=${!!proxy}`);
      const result = await solveReCaptcha(sitekey, siteurl, {
        timeout: 60,
        headless: headless !== false,
        proxy: proxy || null,
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

      if (result.error) {
        console.error(`[API] reCAPTCHA error after ${elapsed}s:`, result.error);
        recordSolve('recaptcha', '—', parseFloat(elapsed), 'failed');
        return reply.code(500).send({
          status: 'error', detail: result.error, elapsed: parseFloat(elapsed),
          proxy: proxy ? `${proxy.slice(0, 30)}...` : 'none',
          proxyUsed: !!proxy,
        });
      }

      console.log(`[API] reCAPTCHA solved in ${elapsed}s token=${result.token?.slice(0, 20)}... proxy=${!!proxy}`);
      recordSolve('recaptcha', result.token?.slice(0, 20) || '—', parseFloat(elapsed), 'success');
      return {
        status: 'success', token: result.token, elapsed: parseFloat(elapsed),
        proxy: proxy ? `${proxy.slice(0, 30)}...` : 'none',
        proxyUsed: !!proxy,
        tokenLen: result.token?.length || 0,
      };
    } catch (e) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.error(`[API] reCAPTCHA error after ${elapsed}s:`, e.message);
      recordSolve('recaptcha', '—', parseFloat(elapsed), 'failed');
      return reply.code(500).send({ status: 'error', detail: e.message, elapsed: parseFloat(elapsed) });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  SOLVE /ire — Max stealth reCAPTCHA v2 solver
  //  Same as /solve/recaptcha but with quality guarantee
  // ═══════════════════════════════════════════════════════════
  app.post('/solve/ire', async (req, reply) => {
    const { sitekey, siteurl, proxy } = req.body || {};

    if (!sitekey || !siteurl) {
      return reply.code(400).send({ status: 'error', detail: 'sitekey and siteurl are required' });
    }

    const t0 = Date.now();
    let lastError = null;
    let bestToken = null;

    // Try up to 3 times for a high-quality token
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[ire] Attempt ${attempt}/3: sitekey=${sitekey.slice(0, 20)}...`);
        const result = await solveReCaptcha(sitekey, siteurl, {
          timeout: 60,
          headless: false,
          proxy: proxy || null,
        });

        const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

        if (result.error) {
          lastError = result.error;
          console.log(`[ire] Attempt ${attempt} failed: ${result.error}`);
          continue;
        }

        if (result.token && result.token.length > 1500 && result.token.startsWith('0cAFcWeA')) {
          console.log(`[ire] HIGH quality token on attempt ${attempt}! len=${result.token.length}`);
          recordSolve('ire', result.token.slice(0, 20), parseFloat(elapsed), 'success');
          return {
            status: 'success', token: result.token, elapsed: parseFloat(elapsed),
            proxy: proxy ? `${proxy.slice(0, 30)}...` : 'none',
            proxyUsed: !!proxy,
            tokenLen: result.token.length,
            quality: 'high',
            attempts: attempt,
          };
        }

        if (result.token && result.token.length > 500) {
          bestToken = result.token;
          console.log(`[ire] Token on attempt ${attempt}, quality: standard`);
        }
      } catch (e) {
        lastError = e.message;
        console.log(`[ire] Attempt ${attempt} error: ${e.message}`);
      }
    }

    // Return best available token
    if (bestToken) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      recordSolve('ire', bestToken.slice(0, 20), parseFloat(elapsed), 'success');
      return {
        status: 'success', token: bestToken, elapsed: parseFloat(elapsed),
        quality: 'standard',
        proxyUsed: !!proxy,
        tokenLen: bestToken.length,
      };
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    recordSolve('ire', '—', parseFloat(elapsed), 'failed');
    return reply.code(500).send({ status: 'error', detail: lastError || 'no_token', elapsed: parseFloat(elapsed) });
  });

  return app;
}
