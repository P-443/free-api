export const baseCSS = `
:root{--bg:#0a0a0f;--surface:#13131a;--surface2:#1a1a25;--border:#252535;--primary:#6c5ce7;--primary-glow:rgba(108,92,231,0.3);--success:#00d2a0;--success-glow:rgba(0,210,160,0.3);--warning:#f9a825;--danger:#ff4757;--text:#e8e8f0;--text2:#9090a0;--radius:14px;--radius-sm:8px;--font:'Segoe UI',system-ui,sans-serif;--mono:'Cascadia Code','Fira Code',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;background-image:radial-gradient(ellipse at 20% 0%,rgba(108,92,231,0.08) 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,rgba(0,210,160,0.05) 0%,transparent 50%)}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 32px;height:60px;display:flex;align-items:center;justify-content:space-between}
.header a{font-size:1.15rem;font-weight:700;color:var(--text);text-decoration:none;display:flex;align-items:center;gap:8px}.header a:hover{opacity:0.85}.header a b{font-size:1.2rem}
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

export function buildDocsHTML(poolSize, host) {
  const H = host || 'http://localhost:9000';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>API Docs — Free Captcha API</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script src="https://unpkg.com/lucide@latest"><\/script><style>${baseCSS}</style></head><body>
<header class="header"><a href="/"><svg width="22" height="22" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" style="stop-color:#7c6ff7"/><stop offset="50%" style="stop-color:#a78bfa"/><stop offset="100%" style="stop-color:#10d4a0"/></linearGradient></defs><polygon points="32,3 57,16 57,48 32,61 7,48 7,16" fill="none" stroke="url(#g)" stroke-width="4.5" stroke-linejoin="round"/><rect x="16" y="18" width="9" height="28" rx="2" fill="url(#g)"/><rect x="39" y="18" width="9" height="28" rx="2" fill="url(#g)"/><rect x="16" y="29" width="32" height="6" rx="2" fill="url(#g)"/></svg> <b style="color:#7c6ff7">H</b><b style="color:#10d4a0">C</b> Panel</a><div class="header-btns"><a href="/docs" class="active"><i data-lucide="file-text" style="width:14px;height:14px"></i> Docs</a><a href="/health"><i data-lucide="activity" style="width:14px;height:14px"></i> Health</a></div></header>
<div class="container">
<h1><i data-lucide="book-open-text"></i> API Documentation</h1>
<p class="sub">Unified solver for Cloudflare Turnstile &amp; hCaptcha — any site, any key</p>

<div class="card"><div class="card-row"><span><strong><i data-lucide="lock-keyhole" style="width:16px;height:16px"></i> hCaptcha Pool</strong></span><span><span class="badge badge-ok">${poolSize} tokens ready</span></span></div>
<div class="pool-bar"><div class="pool-fill" style="width:${Math.min(100,(poolSize/50)*100)}%;background:var(--success)"></div></div></div>

<h2><i data-lucide="router"></i> Endpoints</h2>
<div class="card">${['GET|/|HC Panel Dashboard (HTML)','GET|/docs|API Documentation (HTML)','GET|/health|Service health & pool status (HTML)','POST|/solve/turnstile|Solve Cloudflare Turnstile (direct)','POST|/solve/hcaptcha|Solve hCaptcha (direct, optional proxy)','POST|/solve/recaptcha|Solve reCAPTCHA v2 (direct, optional proxy) <span style=\"color:var(--warning);font-size:0.7rem\">NEW</span>','GET|/get-hcaptcha-token|Pre-solved hCaptcha token from Redis pool','GET|/get-turnstile-token|Pre-solved Turnstile token from Redis pool'].map(e => { const [m,p,d] = e.split('|'); return `<div class="endpoint"><span class="method ${m==='GET'?'method-get':'method-post'}">${m}</span><span class="path">${p}</span><span class="desc">${d}</span></div>`; }).join('')}</div>

<h2><i data-lucide="shield-check"></i> POST /solve/turnstile</h2>
<div class="card"><pre>curl -X POST <span style="color:var(--success)">${H}</span>/solve/turnstile \\
  -H "Content-Type: application/json" \\
  -d '{"sitekey":"0x4AAAAAAActoBfh_En8yr3T","siteurl":"https://example.com/","timeout":45}'

<span style="color:var(--success)"># 200 OK</span>
{"status":"success","token":"0.abc123...","elapsed":4.23}</pre></div>

<h2><i data-lucide="lock-keyhole"></i> POST /solve/hcaptcha</h2>
<div class="card"><pre>curl -X POST <span style="color:var(--success)">${H}</span>/solve/hcaptcha \\
  -H "Content-Type: application/json" \\
  -d '{"sitekey":"463b917e-e264-403f-ad34-34af0ee10294","siteurl":"https://example.com/"}'

<span style="color:var(--success)"># 200 OK</span>
{"status":"success","token":"P0_abc123...","elapsed":5.67}

<span style="color:var(--text2)"># With proxy:</span>
{"sitekey":"...","siteurl":"...","proxy":"http://user:pass@host:port"}</pre></div>

<h2><i data-lucide="shield-check"></i> POST /solve/recaptcha <span style="color:var(--warning)">NEW</span></h2>
<div class="card"><pre>curl -X POST <span style="color:var(--success)">${H}</span>/solve/recaptcha \\
  -H "Content-Type: application/json" \\
  -d '{"sitekey":"6LfjFyMpAAAA...","siteurl":"https://commerce.cashnet.com/fscgiving"}'

<span style="color:var(--success)"># 200 OK</span>
{"status":"success","token":"0cAFcWeA...","elapsed":4.5,"tokenLen":2084}

<span style="color:var(--text2)"># With proxy (same-IP tunnel):</span>
{"sitekey":"...","siteurl":"...","proxy":"http://72.62.XXX.XXX:PORT"}

<span style="color:var(--text2)"># Uses real Chrome (non-headless) via Xvfb</span>
<span style="color:var(--text2)"># Best Google reCAPTCHA scores</span></pre></div>

<h2><i data-lucide="code"></i> Python</h2>
<div class="card"><pre>import requests
API = "<span style="color:var(--success)">${H}</span>"

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

# reCAPTCHA v2
r = requests.post(f"{API}/solve/recaptcha", json={
    "sitekey": "6LfjFyMpAAAAAHt55K-tnVieeAK-O3sNLO44VvlV",
    "siteurl": "https://commerce.cashnet.com/fscgiving"
})
print(r.json()["token"])

# From pool (instant)
r = requests.get(f"{API}/get-hcaptcha-token")
print(r.json()["token"])</pre></div>

<h2><i data-lucide="braces"></i> JavaScript</h2>
<div class="card"><pre>const API = "<span style="color:var(--success)">${H}</span>";

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

// reCAPTCHA v2
const recap = await fetch(API + "/solve/recaptcha", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({sitekey: "6Lfj...", siteurl: "https://..."})
}).then(r => r.json());

// From pool (instant, no waiting)
const pool = await fetch(API + "/get-hcaptcha-token").then(r => r.json());</pre></div>
</div>
<script>lucide.createIcons()<\/script></body></html>`;
}

export function buildMethodHTML(host, path, method, title) {
  const H = host || 'http://localhost:9000';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title} — Free Captcha API</title><script src="https://unpkg.com/lucide@latest"><\/script><link rel="icon" type="image/svg+xml" href="/favicon.svg"><style>${baseCSS}
.method-banner{text-align:center;padding:48px 24px}.method-badge{display:inline-block;padding:6px 20px;border-radius:6px;font-size:.85rem;font-weight:700;background:rgba(108,92,231,0.15);color:var(--primary);margin-bottom:16px}.method-banner h1{font-size:1.6rem;margin-bottom:8px}.method-banner p{color:var(--text2);max-width:500px;margin:0 auto 20px}</style></head><body>
<header class="header"><a href="/"><svg width="22" height="22" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" style="stop-color:#7c6ff7"/><stop offset="50%" style="stop-color:#a78bfa"/><stop offset="100%" style="stop-color:#10d4a0"/></linearGradient></defs><polygon points="32,3 57,16 57,48 32,61 7,48 7,16" fill="none" stroke="url(#g)" stroke-width="4.5" stroke-linejoin="round"/><rect x="16" y="18" width="9" height="28" rx="2" fill="url(#g)"/><rect x="39" y="18" width="9" height="28" rx="2" fill="url(#g)"/><rect x="16" y="29" width="32" height="6" rx="2" fill="url(#g)"/></svg> <b style="color:#7c6ff7">H</b><b style="color:#10d4a0">C</b> Panel</a><div class="header-btns"><a href="/docs"><i data-lucide="file-text" style="width:14px;height:14px"></i> Docs</a><a href="/health"><i data-lucide="activity" style="width:14px;height:14px"></i> Health</a></div></header>
<div class="container"><div class="method-banner">
<span class="method-badge">${method}</span>
<h1>${path}</h1>
<p>${title} — this endpoint requires a <strong>${method}</strong> request. You cannot access it from the browser directly.</p>
</div>
<div class="card">
<h2 style="margin-top:0"><i data-lucide="terminal"></i> cURL Example</h2>
<pre>curl -X ${method} <span style="color:var(--success)">${H}</span>${path} \\
  -H "Content-Type: application/json" \\
  -d '{"sitekey":"YOUR_SITEKEY","siteurl":"https://example.com/"}'</pre></div>
<div class="card" style="text-align:center">
<a href="/docs" style="color:var(--primary);text-decoration:none;font-weight:600"><i data-lucide="arrow-left" style="width:14px;height:14px"></i> Back to API Docs</a>
</div></div><script>lucide.createIcons()<\/script></body></html>`;
}

export function buildHealthHTML(poolSize, uptimeSeconds) {
  const redisStatus = poolSize >= 0;
  const overallStatus = redisStatus ? 'ok' : 'degraded';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Health — Free Captcha API</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script src="https://unpkg.com/lucide@latest"><\/script><style>${baseCSS}</style></head><body>
<header class="header"><a href="/"><svg width="22" height="22" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" style="stop-color:#7c6ff7"/><stop offset="50%" style="stop-color:#a78bfa"/><stop offset="100%" style="stop-color:#10d4a0"/></linearGradient></defs><polygon points="32,3 57,16 57,48 32,61 7,48 7,16" fill="none" stroke="url(#g)" stroke-width="4.5" stroke-linejoin="round"/><rect x="16" y="18" width="9" height="28" rx="2" fill="url(#g)"/><rect x="39" y="18" width="9" height="28" rx="2" fill="url(#g)"/><rect x="16" y="29" width="32" height="6" rx="2" fill="url(#g)"/></svg> <b style="color:#7c6ff7">H</b><b style="color:#10d4a0">C</b> Panel</a><div class="header-btns"><a href="/docs"><i data-lucide="file-text" style="width:14px;height:14px"></i> Docs</a><a href="/health" class="active"><i data-lucide="activity" style="width:14px;height:14px"></i> Health</a></div></header>
<div class="container">
<h1><i data-lucide="activity"></i> Service Health</h1>
<p class="sub">Real-time status of the Free Captcha API</p>

<div class="status-grid">
<div class="stat-card ok"><div class="label">Overall Status</div><div class="value">${overallStatus === 'ok' ? 'OK' : 'Degraded'}</div></div>
<div class="stat-card ok"><div class="label">Uptime</div><div class="value">${uptimeSeconds.toFixed(0)}s</div></div>
<div class="stat-card ${redisStatus ? 'ok' : 'warn'}"><div class="label">Redis</div><div class="value">${redisStatus ? 'Connected' : 'Disabled'}</div></div>
</div>

<div class="card"><div class="card-row"><span><strong><i data-lucide="database" style="width:16px;height:16px"></i> hCaptcha Pool Size</strong></span><span><span class="badge ${poolSize >= 20 ? 'badge-ok' : 'badge-warn'}">${poolSize} / 50</span></span></div>
<div class="pool-bar"><div class="pool-fill" style="width:${Math.min(100,(poolSize/50)*100)}%;background:${poolSize >= 20 ? 'var(--success)' : 'var(--warning)'}"></div></div></div>

<div class="card"><div class="card-row"><span><strong><i data-lucide="router" style="width:16px;height:16px"></i> All Endpoints</strong></span></div>
<div style="margin-top:12px;display:grid;gap:8px;">${['GET|/|Dashboard','GET|/docs|API Docs','GET|/health|This page','POST|/solve/turnstile|Solve Turnstile','POST|/solve/hcaptcha|Solve hCaptcha','POST|/solve/recaptcha|Solve reCAPTCHA <span style=\"color:var(--warning)\">NEW</span>','GET|/get-hcaptcha-token|hCaptcha pool token','GET|/get-turnstile-token|Turnstile pool token'].map(e => { const [m,p,d] = e.split('|'); return `<div class="endpoint"><span class="method ${m==='GET'?'method-get':'method-post'}">${m}</span><span class="path">${p}</span><span class="desc">${d}</span></div>`; }).join('')}</div></div>
</div>
<script>lucide.createIcons()<\/script></body></html>`;
}
