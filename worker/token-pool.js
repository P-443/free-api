// ═══════════════════════════════════════════════════════════════
//  Token Pool Worker — pre-solves captchas into Redis
//  Keeps the pool full so /get-*-token returns instantly.
//  Supports BOTH hCaptcha AND Turnstile pools.
// ═══════════════════════════════════════════════════════════════

import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { solveHCaptchaBatch } from '../clients/hcaptchaClient.js';
import { solveTurnstile } from '../clients/turnstileClient.js';
import { solveReCaptcha } from '../clients/recaptchaClient.js';

// ── Configuration — from central config module ────────────────
import { REDIS_URL, HCAPTCHA_SITEKEY, HCAPTCHA_SITEURL, TURNSTILE_SITEKEY, TURNSTILE_SITEURL, RECAPTCHA_SITEKEY, RECAPTCHA_SITEURL, TARGET_POOL, LOW_POOL, BATCH_SIZE } from '../config/index.js';
if (!REDIS_URL) {
  console.error('[Worker] REDIS_URL not set. Worker needs Redis. Exiting.');
  process.exit(1);
}

const redis = new Redis(REDIS_URL, { socketTimeout: 30000, socketKeepalive: true });

// ── Load proxies ──────────────────────────────────────────────
function loadProxies() {
  try {
    const data = readFileSync(new URL('./proxies.txt', import.meta.url), 'utf-8');
    return data
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(line => {
        const [auth, hostPort] = line.split('@');
        if (!auth || !hostPort) return null;
        const [username, password] = auth.split(':');
        const [host, port] = hostPort.split(':');
        if (!host || !port) return null;
        return { server: `http://${host}:${port}`, username, password };
      })
      .filter(Boolean);
  } catch (e) {
    console.error('[Worker] Failed to load proxies:', e.message);
    return [];
  }
}

const PROXIES = loadProxies();
console.log(`[Worker] Loaded ${PROXIES.length} proxies`);

function pickBatch(count) {
  if (!PROXIES.length) return [];
  const shuffled = [...PROXIES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ═══════════════════════════════════════════════════════════════
//  HCAPTCHA POOL FILLER
// ═══════════════════════════════════════════════════════════════
async function fillHCaptchaPool() {
  if (!HCAPTCHA_SITEKEY || !HCAPTCHA_SITEURL) return;

  const count = await redis.llen('hcaptcha_tokens');
  if (count >= TARGET_POOL) return;

  const needed = Math.min(BATCH_SIZE, TARGET_POOL - count);
  const batch = pickBatch(needed);
  const urgency = count < LOW_POOL ? 'URGENT' : '';

  console.log(`[Worker] hCaptcha batch: ${batch.length} parallel (pool: ${count}/${TARGET_POOL}) ${urgency}`);

  const startTime = Date.now();
  const tokens = await solveHCaptchaBatch(HCAPTCHA_SITEKEY, HCAPTCHA_SITEURL, batch, batch.length);
  const elapsed = Date.now() - startTime;

  if (tokens.length > 0) {
    for (const token of tokens) {
      await redis.rpush('hcaptcha_tokens', token);
    }
    await redis.expire('hcaptcha_tokens', 110);
    const newCount = await redis.llen('hcaptcha_tokens');
    const rate = (tokens.length / (elapsed / 1000)).toFixed(1);
    console.log(`[Worker] +${tokens.length} hCaptcha tokens in ${elapsed}ms (${rate}/s) | Pool: ${newCount}/${TARGET_POOL}`);
  } else {
    console.log('[Worker] hCaptcha batch failed, will retry...');
  }
}

// ═══════════════════════════════════════════════════════════════
//  TURNSTILE POOL FILLER
// ═══════════════════════════════════════════════════════════════
async function fillTurnstilePool() {
  if (!TURNSTILE_SITEKEY || !TURNSTILE_SITEURL) return;

  const count = await redis.llen('turnstile_tokens');
  if (count >= TARGET_POOL) return;

  const needed = Math.min(BATCH_SIZE, TARGET_POOL - count);
  console.log(`[Worker] Turnstile pool: ${count}/${TARGET_POOL}, solving ${needed}...`);

  // Turnstile is solved one-at-a-time (persistent browser with single context is better)
  const startTime = Date.now();
  let solved = 0;
  for (let i = 0; i < needed; i++) {
    try {
      const proxy = PROXIES.length > 0 ? PROXIES[Math.floor(Math.random() * PROXIES.length)] : null;
      const token = await solveTurnstile(TURNSTILE_SITEKEY, TURNSTILE_SITEURL, 45, proxy);
      if (token) {
        await redis.rpush('turnstile_tokens', token);
        solved++;
      }
    } catch (e) {
      // continue
    }
  }
  const elapsed = Date.now() - startTime;

  if (solved > 0) {
    await redis.expire('turnstile_tokens', 300); // Turnstile tokens last longer
    const newCount = await redis.llen('turnstile_tokens');
    const rate = (solved / (elapsed / 1000)).toFixed(1);
    console.log(`[Worker] +${solved} Turnstile tokens in ${elapsed}ms (${rate}/s) | Pool: ${newCount}/${TARGET_POOL}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  RECAPTCHA POOL FILLER
// ═══════════════════════════════════════════════════════════════
async function fillRecaptchaPool() {
  if (!RECAPTCHA_SITEKEY || !RECAPTCHA_SITEURL) return;

  const count = await redis.llen('recaptcha_tokens');
  if (count >= TARGET_POOL) return;

  const needed = Math.min(BATCH_SIZE, TARGET_POOL - count);
  console.log(`[Worker] reCAPTCHA pool: ${count}/${TARGET_POOL}, solving ${needed}...`);

  const startTime = Date.now();
  let solved = 0;
  for (let i = 0; i < needed; i++) {
    try {
      const proxy = PROXIES.length > 0 ? PROXIES[Math.floor(Math.random() * PROXIES.length)] : null;
      const result = await solveReCaptcha(RECAPTCHA_SITEKEY, RECAPTCHA_SITEURL, {
        timeout: 60,
        headless: true,
        proxy: proxy ? `http://${proxy.username}:${proxy.password}@${proxy.server.replace('http://', '')}` : null,
      });
      if (result.token) {
        await redis.rpush('recaptcha_tokens', result.token);
        solved++;
      }
    } catch (e) {
      // continue
    }
  }
  const elapsed = Date.now() - startTime;

  if (solved > 0) {
    await redis.expire('recaptcha_tokens', 110);
    const newCount = await redis.llen('recaptcha_tokens');
    const rate = (solved / (elapsed / 1000)).toFixed(1);
    console.log(`[Worker] +${solved} reCAPTCHA tokens in ${elapsed}ms (${rate}/s) | Pool: ${newCount}/${TARGET_POOL}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════════════════
async function run() {
  console.log(`[Worker ${process.pid}] Started — Target: ${TARGET_POOL} tokens per pool`);
  console.log(`[Worker ${process.pid}] hCaptcha: ${HCAPTCHA_SITEKEY ? 'ENABLED' : 'disabled'}`);
  console.log(`[Worker ${process.pid}] Turnstile: ${TURNSTILE_SITEKEY ? 'ENABLED' : 'disabled'}`);
  console.log(`[Worker ${process.pid}] reCAPTCHA: ${RECAPTCHA_SITEKEY ? 'ENABLED' : 'disabled'}`);
  console.log(`[Worker ${process.pid}] Proxies: ${PROXIES.length} | Batch: ${BATCH_SIZE}`);

  while (true) {
    try {
      await fillHCaptchaPool();
      await fillTurnstilePool();
      await fillRecaptchaPool();

      // If all pools are full, wait before checking again
      const hcCount = await redis.llen('hcaptcha_tokens').catch(() => 0);
      const tsCount = await redis.llen('turnstile_tokens').catch(() => 0);
      const rcCount = await redis.llen('recaptcha_tokens').catch(() => 0);

      if (hcCount >= TARGET_POOL && tsCount >= TARGET_POOL && rcCount >= TARGET_POOL) {
        await new Promise(r => setTimeout(r, 2000));
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {
      console.error(`[Worker ${process.pid}] Error:`, e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

run();
