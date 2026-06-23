// ═══════════════════════════════════════════════════════════════
//  Cloudflare Turnstile Solver — Playwright (Node.js)
//  Fake page approach: injects Turnstile into a clean page
//  with the target URL as referrer. Much faster & reliable.
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';

// ── Browser flags — full stealth ─────────────────────────────
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=Translate,OptimizationHints,MediaRouter,IsolateOrigins,site-per-process',
  '--renderer-process-limit=1',
  '--no-pings',
  '--log-level=3',
  '--silent',
];

// ── Anti-detection — comprehensive ───────────────────────────
const ANTI_DETECTION = `
  Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
  Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
  Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
  window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (params) =>
    params.name === 'notifications'
      ? Promise.resolve({state: Notification.permission, onchange: null})
      : origQuery(params);
  // Override navigator properties
  Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 8});
  Object.defineProperty(navigator, 'deviceMemory', {get: () => 8});
`;

// ── Build fake Turnstile page ─────────────────────────────────
function buildTurnstilePage(sitekey, siteurl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Turnstile Solver</title>
<style>
  body { display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f0f0f0; font-family: Arial, sans-serif; }
  .box { text-align: center; padding: 30px; background: white; border-radius: 10px; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
  .box h3 { margin: 0 0 16px; color: #333; font-size: 15px; }
</style>
<script>
  window._tsToken = null;
  window._tsReady = false;
  function onLoad() {
    window._tsReady = true;
    if (window.turnstile) {
      window.turnstile.render('.cf-turnstile', {
        sitekey: '${sitekey}',
        callback: function(tk) { window._tsToken = tk; },
        'error-callback': function(e) { console.error('Turnstile error:', e); }
      });
    }
  }
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoad&render=explicit" async defer></script>
</head>
<body>
<div class="box">
  <h3>Verifying you are human...</h3>
  <div class="cf-turnstile" data-sitekey="${sitekey}"></div>
</div>
</body>
</html>`;
}

// ── Persistent browser singleton ──────────────────────────────
let sharedBrowser = null;
let solveCount = 0;
const MAX_SOLVES_BEFORE_RESTART = 100;

async function getBrowser() {
  if (sharedBrowser && solveCount >= MAX_SOLVES_BEFORE_RESTART) {
    console.log('[Turnstile] Periodic restart (every 100 solves)...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
    solveCount = 0;
  }

  if (sharedBrowser && !sharedBrowser.isConnected()) {
    console.log('[Turnstile] Browser disconnected. Restarting...');
    sharedBrowser = null;
    solveCount = 0;
  }

  if (!sharedBrowser) {
    const exePath = process.env.CHROME_PATH
      || '/usr/bin/google-chrome-stable'
      || '/usr/bin/google-chrome'
      || '/usr/bin/chromium-browser'
      || '/usr/bin/chromium';
    console.log('[Turnstile] Launching browser:', exePath);
    sharedBrowser = await chromium.launch({
      headless: true,
      executablePath: exePath,
      args: BROWSER_ARGS,
    });
    solveCount = 0;
  }

  solveCount++;
  return sharedBrowser;
}

// ── Create context ────────────────────────────────────────────
async function createContext(browser, proxyConfig, siteurl) {
  const opts = {
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    isMobile: false,
    extraHTTPHeaders: { 'Referer': siteurl },
  };

  if (proxyConfig) { opts.proxy = proxyConfig; }

  const context = await browser.newContext(opts);

  // Minimal resource blocking — only heavy media, NOT CSS/scripts
  // Turnstile needs full page context to render properly
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    // Only block media (video/audio) — let images, CSS, fonts pass for Turnstile
    if (type === 'media') {
      return route.abort().catch(() => {});
    }
    return route.continue();
  });

  await context.addInitScript(ANTI_DETECTION);
  return context;
}

// ── Inject Turnstile into real page DOM (fallback approach) ──
async function injectTurnstile(page, sitekey) {
  await page.evaluate((key) => {
    if (document.getElementById('_ts_box')) return;
    window._tsToken = null;
    const wrap = document.createElement('div');
    wrap.id = '_ts_box';
    wrap.style = 'position:fixed;top:20px;left:20px;z-index:2147483647;background:white;padding:10px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
    document.body.appendChild(wrap);
    window._tsLoad = function () {
      if (window.turnstile) {
        window.turnstile.render('#_ts_box', {
          sitekey: key,
          callback: function(tk) { window._tsToken = tk; }
        });
      }
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_tsLoad&render=explicit';
    s.async = true;
    document.head.appendChild(s);
  }, sitekey);
}

// ── Token extraction ──────────────────────────────────────────
async function extractToken(page) {
  return page.evaluate(() => {
    if (window._tsToken) return window._tsToken;
    // Try hidden input
    const inp = document.querySelector('[name="cf-turnstile-response"]');
    if (inp && inp.value) return inp.value;
    // Try iframe
    const iframes = document.querySelectorAll('iframe');
    for (const f of iframes) {
      try {
        const doc = f.contentDocument || f.contentWindow?.document;
        if (doc) {
          const ta = doc.querySelector('[name="cf-turnstile-response"]');
          if (ta && ta.value) return ta.value;
        }
      } catch(e) {}
    }
    return null;
  });
}

// ── Find Turnstile iframe ─────────────────────────────────────
async function findTurnstileFrame(page) {
  return page.evaluate(() => {
    for (const f of document.querySelectorAll('iframe')) {
      const src = f.src || '';
      if (src.includes('challenges.cloudflare.com')) {
        const r = f.getBoundingClientRect();
        if (r.width > 50 && r.height > 20) return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    return null;
  });
}

// ── Human-like click ──────────────────────────────────────────
async function humanClick(page, rect) {
  let cx = 20 + 28 + (Math.random() * 6 - 3);
  let cy = 20 + 32 + (Math.random() * 6 - 3);
  if (rect) {
    cx = rect.x + rect.w * 0.4 + (Math.random() * 12 - 6);
    cy = rect.y + rect.h * 0.5 + (Math.random() * 8 - 4);
  }
  // Move gradually
  await page.mouse.move(cx - 60 + Math.random() * 30, cy - 20 + Math.random() * 15);
  await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
  await page.mouse.move(cx, cy);
  await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
  await page.mouse.click(cx, cy);
}

// ═══════════════════════════════════════════════════════════════
//  MAIN SOLVE
// ═══════════════════════════════════════════════════════════════
export async function solveTurnstile(sitekey, siteurl, timeout = 45, proxy = null) {
  const browser = await getBrowser();
  const context = await createContext(browser, proxy, siteurl);
  const page = await context.newPage();

  try {
    const cleanUrl = siteurl.replace(/\/$/, '');
    const HTML = buildTurnstilePage(sitekey, siteurl);

    // ── Approach 1: Route interception (fast, clean) ──────────
    await page.route(cleanUrl, route => route.fulfill({ body: HTML, contentType: 'text/html' }));
    await page.route(cleanUrl + '/**', route => route.fulfill({ body: HTML, contentType: 'text/html' }));

    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));

    let token = await extractToken(page);
    let iframeRect = await findTurnstileFrame(page);

    // ── Approach 2: Fallback — inject into real page ──────────
    if (!token && !iframeRect) {
      console.log('[Turnstile] Fake page failed — switching to real page injection...');
      // Un-route and reload the real page
      await page.unroute(cleanUrl);
      await page.unroute(cleanUrl + '/**');
      await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 2000));

      // Inject Turnstile widget into real page DOM
      await injectTurnstile(page, sitekey);
      await new Promise(r => setTimeout(r, 3000));
      token = await extractToken(page);
      iframeRect = await findTurnstileFrame(page);
    }

    // Auto-solved?
    if (token) {
      console.log('[Turnstile] Auto-solved');
      await context.close();
      return token;
    }

    if (!iframeRect) {
      // Wait more for iframe on real page
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 1000));
        token = await extractToken(page);
        if (token) break;
        iframeRect = await findTurnstileFrame(page);
        if (iframeRect) break;
      }
    }

    if (token) { await context.close(); return token; }
    if (!iframeRect) throw new Error('Turnstile widget did not load — sitekey may be invalid or site is blocking');

    // ── Click loop for managed/challenge ──────────────────────
    const deadline = Date.now() + timeout * 1000;
    let clickCount = 0;
    let lastClick = 0;

    while (Date.now() < deadline) {
      token = await extractToken(page);
      if (token) break;

      const now = Date.now();
      if (clickCount === 0 || (now - lastClick > 5000)) {
        if (clickCount >= 4) { await new Promise(r => setTimeout(r, 1500)); continue; }
        await humanClick(page, iframeRect);
        lastClick = Date.now();
        clickCount++;
        console.log('[Turnstile] Click', clickCount);
        await new Promise(r => setTimeout(r, 1500));
        iframeRect = (await findTurnstileFrame(page)) || iframeRect;
        continue;
      }
      await new Promise(r => setTimeout(r, 800));
    }

    if (token) { console.log('[Turnstile] Solved after', clickCount, 'clicks'); await context.close(); return token; }
    throw new Error(`Turnstile token not obtained within ${timeout}s`);

  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

export async function shutdownTurnstile() {
  if (sharedBrowser) {
    console.log('[Turnstile] Closing persistent browser...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}
