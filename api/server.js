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
          '/get-hcaptcha-token': 'GET — Get pre-solved hCaptcha token from Redis pool',
          '/get-turnstile-token': 'GET — Get pre-solved Turnstile token from Redis pool',
        },
        pool: { enabled: !!redis, hcaptcha_size: poolSize },
      };
    }
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return buildDocsHTML(poolSize);
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
    return buildHealthHTML(poolSize);
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

// ═══════════════════════════════════════════════════════════════
//  HTML TEMPLATES — Styled pages for /docs and /health
// ═══════════════════════════════════════════════════════════════

const baseCSS = `
:root{--bg:#0a0a0f;--surface:#13131a;--surface2:#1a1a25;--border:#252535;--primary:#6c5ce7;--primary-glow:rgba(108,92,231,0.3);--success:#00d2a0;--success-glow:rgba(0,210,160,0.3);--warning:#f9a825;--danger:#ff4757;--text:#e8e8f0;--text2:#9090a0;--radius:14px;--radius-sm:8px;--font:'Segoe UI',system-ui,sans-serif;--mono:'Cascadia Code','Fira Code',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;background-image:radial-gradient(ellipse at 20% 0%,rgba(108,92,231,0.08) 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,rgba(0,210,160,0.05) 0%,transparent 50%)}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 32px;height:60px;display:flex;align-items:center;justify-content:space-between}
.header a{font-size:1.3rem;font-weight:800;background:linear-gradient(135deg,var(--primary),#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-decoration:none}
.header-btns{display:flex;gap:8px}
.header-btns a{padding:7px 18px;border-radius:6px;font-size:.78rem;font-weight:600;border:1px solid var(--border);background:var(--surface2);color:var(--text2);text-decoration:none;transition:.2s}
.header-btns a:hover,.header-btns a.active{color:var(--text);border-color:var(--primary)}
.container{max-width:1000px;margin:0 auto;padding:32px 24px}
h1{font-size:1.8rem;margin-bottom:6px}
h2{font-size:1.15rem;font-weight:700;margin:24px 0 12px;color:var(--primary)}
p.sub{color:var(--text2);font-size:.85rem;margin-bottom:24px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px;margin-bottom:16px}
.card-row{display:flex;justify-content:space-between;align-items:center}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:700}
.badge-ok{background:rgba(0,210,160,0.15);color:var(--success)}
.badge-warn{background:rgba(249,168,37,0.15);color:var(--warning)}
.endpoint{display:grid;grid-template-columns:70px 120px 1fr;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:.82rem}
.endpoint .method{font-weight:700;font-size:.7rem;padding:3px 8px;border-radius:4px;text-align:center}
.method-get{background:rgba(0,210,160,0.15);color:var(--success)}
.method-post{background:rgba(108,92,231,0.15);color:var(--primary)}
.endpoint .path{font-family:var(--mono);font-size:.75rem}
.endpoint .desc{color:var(--text2);font-size:.78rem}
pre{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;font-family:var(--mono);font-size:.72rem;overflow-x:auto;color:var(--text);line-height:1.6}
.status-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
.stat-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:18px;text-align:center}
.stat-card .label{font-size:.7rem;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.stat-card .value{font-size:1.8rem;font-weight:800;font-family:var(--mono)}
.stat-card.ok .value{color:var(--success)}
.stat-card.warn .value{color:var(--warning)}
.pool-bar{width:100%;height:8px;background:var(--bg);border-radius:10px;margin-top:14px;overflow:hidden}
.pool-fill{height:100%;border-radius:10px;transition:width .6s}
svg.lucide,i[data-lucide]{display:inline-block;vertical-align:middle;margin-right:4px}
.header a svg,.header-btns a svg,i[data-lucide]{flex-shrink:0}
@media(max-width:768px){.header{padding:0 16px}.container{padding:20px 14px}.endpoint{grid-template-columns:60px 100px 1fr}.status-grid{grid-template-columns:1fr}}
`;

function buildDocsHTML(poolSize) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>API Docs — Free Captcha API</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%237c6ff7'/%3E%3Cstop offset='100%25' style='stop-color:%2310d4a0'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpolygon points='16,1 29,8 29,24 16,31 3,24 3,8' fill='none' stroke='url(%23g)' stroke-width='2.5' rx='2'/%3E%3Cpath d='M16 10v7l4.5 2.5' fill='none' stroke='url(%23g)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M12 10h8' fill='none' stroke='url(%23g)' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E">
<script src="https://unpkg.com/lucide@latest"><\/script><style>${baseCSS}</style></head><body>
<header class="header"><a href="/"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#7c6ff7"/><stop offset="100%" style="stop-color:#10d4a0"/></linearGradient></defs><polygon points="12,0.5 21.5,6 21.5,18 12,23.5 2.5,18 2.5,6" fill="none" stroke="url(#g)" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 7.5v5.5l3.5 2" fill="none" stroke="url(#g)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 7.5h6" fill="none" stroke="url(#g)" stroke-width="1.5" stroke-linecap="round"/></svg> HC Panel</a><div class="header-btns"><a href="/docs" class="active"><i data-lucide="file-text" style="width:14px;height:14px"></i> Docs</a><a href="/health"><i data-lucide="activity" style="width:14px;height:14px"></i> Health</a></div></header>
<div class="container">
<h1><i data-lucide="book-open-text"></i> API Documentation</h1>
<p class="sub">Unified solver for Cloudflare Turnstile &amp; hCaptcha — any site, any key</p>

<div class="card"><div class="card-row"><span><strong><i data-lucide="lock-keyhole" style="width:16px;height:16px"></i> hCaptcha Pool</strong></span><span><span class="badge badge-ok">${poolSize} tokens ready</span></span></div>
<div class="pool-bar"><div class="pool-fill" style="width:${Math.min(100,(poolSize/50)*100)}%;background:var(--success)"></div></div></div>

<h2><i data-lucide="router"></i> Endpoints</h2>
<div class="card">${['GET|/|HC Panel Dashboard (HTML)','GET|/docs|API Documentation (HTML)','GET|/health|Service health & pool status (HTML)','POST|/solve/turnstile|Solve Cloudflare Turnstile (direct)','POST|/solve/hcaptcha|Solve hCaptcha (direct, optional proxy)','GET|/get-hcaptcha-token|Pre-solved hCaptcha token from Redis pool','GET|/get-turnstile-token|Pre-solved Turnstile token from Redis pool'].map(e => { const [m,p,d] = e.split('|'); return `<div class="endpoint"><span class="method ${m==='GET'?'method-get':'method-post'}">${m}</span><span class="path">${p}</span><span class="desc">${d}</span></div>`; }).join('')}</div>

<h2><i data-lucide="shield-check"></i> POST /solve/turnstile</h2>
<div class="card"><pre>curl -X POST <span style="color:var(--text2)">YOUR_HOST</span>/solve/turnstile \\
  -H "Content-Type: application/json" \\
  -d '{"sitekey":"0x4AAAAAAActoBfh_En8yr3T","siteurl":"https://example.com/","timeout":45}'

<span style="color:var(--success)"># 200 OK</span>
{"status":"success","token":"0.abc123...","elapsed":4.23}</pre></div>

<h2><i data-lucide="lock-keyhole"></i> POST /solve/hcaptcha</h2>
<div class="card"><pre>curl -X POST <span style="color:var(--text2)">YOUR_HOST</span>/solve/hcaptcha \\
  -H "Content-Type: application/json" \\
  -d '{"sitekey":"463b917e-e264-403f-ad34-34af0ee10294","siteurl":"https://example.com/"}'

<span style="color:var(--success)"># 200 OK</span>
{"status":"success","token":"P0_abc123...","elapsed":5.67}

<span style="color:var(--text2)"># With proxy:</span>
{"sitekey":"...","siteurl":"...","proxy":{"server":"http://host:port","username":"u","password":"p"}}</pre></div>

<h2><i data-lucide="code"></i> Python</h2>
<div class="card"><pre>import requests
API = "<span style="color:var(--text2)">YOUR_HOST</span>"

# Turnstile
r = requests.post(f"{API}/solve/turnstile", json={
    "sitekey": "0x4AAAAAAActoBfh_En8yr3T",
    "siteurl": "https://example.com/"
})
print(r.json()["token"])

# hCaptcha
r = requests.post(f"{API}/solve/hcaptcha", json={
    "sitekey": "463b917e-e264-403f-ad34-34af0ee10294",
    "siteurl": "https://example.com/"
})
print(r.json()["token"])

# From pool (instant)
r = requests.get(f"{API}/get-hcaptcha-token")
print(r.json()["token"])</pre></div>

<h2><i data-lucide="braces"></i> JavaScript</h2>
<div class="card"><pre>const API = "<span style="color:var(--text2)">YOUR_HOST</span>";

// Turnstile
const ts = await fetch(API + "/solve/turnstile", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({sitekey: "0x4...", siteurl: "https://..."})
}).then(r => r.json());

// hCaptcha
const hc = await fetch(API + "/solve/hcaptcha", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({sitekey: "463...", siteurl: "https://..."})
}).then(r => r.json());

// From pool (instant, no waiting)
const pool = await fetch(API + "/get-hcaptcha-token").then(r => r.json());</pre></div>
</div>
<script>lucide.createIcons()<\/script></body></html>`;
}

function buildHealthHTML(poolSize) {
  const redisStatus = poolSize >= 0;
  const overallStatus = redisStatus ? 'ok' : 'degraded';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Health — Free Captcha API</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%237c6ff7'/%3E%3Cstop offset='100%25' style='stop-color:%2310d4a0'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpolygon points='16,1 29,8 29,24 16,31 3,24 3,8' fill='none' stroke='url(%23g)' stroke-width='2.5' rx='2'/%3E%3Cpath d='M16 10v7l4.5 2.5' fill='none' stroke='url(%23g)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M12 10h8' fill='none' stroke='url(%23g)' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E">
<script src="https://unpkg.com/lucide@latest"><\/script><style>${baseCSS}</style></head><body>
<header class="header"><a href="/"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#7c6ff7"/><stop offset="100%" style="stop-color:#10d4a0"/></linearGradient></defs><polygon points="12,0.5 21.5,6 21.5,18 12,23.5 2.5,18 2.5,6" fill="none" stroke="url(#g)" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 7.5v5.5l3.5 2" fill="none" stroke="url(#g)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 7.5h6" fill="none" stroke="url(#g)" stroke-width="1.5" stroke-linecap="round"/></svg> HC Panel</a><div class="header-btns"><a href="/docs"><i data-lucide="file-text" style="width:14px;height:14px"></i> Docs</a><a href="/health" class="active"><i data-lucide="activity" style="width:14px;height:14px"></i> Health</a></div></header>
<div class="container">
<h1><i data-lucide="activity"></i> Service Health</h1>
<p class="sub">Real-time status of the Free Captcha API</p>

<div class="status-grid">
<div class="stat-card ok"><div class="label">Overall Status</div><div class="value">${overallStatus === 'ok' ? 'OK' : 'Degraded'}</div></div>
<div class="stat-card ok"><div class="label">Uptime</div><div class="value">${process.uptime().toFixed(0)}s</div></div>
<div class="stat-card ${redisStatus ? 'ok' : 'warn'}"><div class="label">Redis</div><div class="value">${redisStatus ? 'Connected' : 'Disabled'}</div></div>
</div>

<div class="card"><div class="card-row"><span><strong><i data-lucide="database" style="width:16px;height:16px"></i> hCaptcha Pool Size</strong></span><span><span class="badge ${poolSize >= 20 ? 'badge-ok' : 'badge-warn'}">${poolSize} / 50</span></span></div>
<div class="pool-bar"><div class="pool-fill" style="width:${Math.min(100,(poolSize/50)*100)}%;background:${poolSize >= 20 ? 'var(--success)' : 'var(--warning)'}"></div></div></div>

<div class="card"><div class="card-row"><span><strong><i data-lucide="router" style="width:16px;height:16px"></i> All Endpoints</strong></span></div>
<div style="margin-top:12px;display:grid;gap:8px;">${['GET|/|Dashboard','GET|/docs|API Docs','GET|/health|This page','POST|/solve/turnstile|Solve Turnstile','POST|/solve/hcaptcha|Solve hCaptcha','GET|/get-hcaptcha-token|hCaptcha pool token','GET|/get-turnstile-token|Turnstile pool token'].map(e => { const [m,p,d] = e.split('|'); return `<div class="endpoint"><span class="method ${m==='GET'?'method-get':'method-post'}">${m}</span><span class="path">${p}</span><span class="desc">${d}</span></div>`; }).join('')}</div></div>
</div>
<script>lucide.createIcons()<\/script></body></html>`;
}
