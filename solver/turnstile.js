// ═══════════════════════════════════════════════════════════════
//  Cloudflare Turnstile Solver — Playwright (Node.js)
//  Ported from Python nodriver → Playwright for unified stack
//  Supports ANY sitekey + siteurl. Persistent browser.
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';

// ── Optimized browser flags ───────────────────────────────────
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-sync',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=Translate,OptimizationHints,MediaRouter,IsolateOrigins',
  '--renderer-process-limit=1',
  '--log-level=3',
  '--silent',
];

// ── Anti-detection injection ──────────────────────────────────
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
`;

// ── Shared browser singleton ──────────────────────────────────
let sharedBrowser = null;
let solveCount = 0;
const MAX_SOLVES_BEFORE_RESTART = 150;

async function getBrowser() {
  if (sharedBrowser && solveCount >= MAX_SOLVES_BEFORE_RESTART) {
    console.log('[Turnstile] Periodic restart (every 150 solves)...');
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

// ── Create optimized context ──────────────────────────────────
async function createContext(browser, proxyConfig) {
  const opts = {
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    isMobile: false,
  };

  if (proxyConfig) {
    opts.proxy = proxyConfig;
  }

  const context = await browser.newContext(opts);

  // Block heavy resources for speed
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font' || type === 'media' ||
        type === 'stylesheet' || type === 'manifest') {
      return route.abort().catch(() => {});
    }
    return route.continue();
  });

  await context.addInitScript(ANTI_DETECTION);
  return context;
}

// ── Inject Turnstile widget into REAL page ────────────────────
async function injectTurnstile(page, sitekey) {
  await page.evaluate((key) => {
    if (document.getElementById('_ts_box')) return;
    window._tsToken = null;
    const wrap = document.createElement('div');
    wrap.id = '_ts_box';
    wrap.style = 'position:fixed;top:20px;left:20px;z-index:2147483647;background:white;padding:10px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
    document.body.appendChild(wrap);
    window._tsLoad = function () {
      turnstile.render('#_ts_box', {
        sitekey: key,
        callback: function(tk) { window._tsToken = tk; }
      });
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_tsLoad&render=explicit';
    s.async = true;
    document.head.appendChild(s);
  }, sitekey);
}

// ── Extract token from DOM ────────────────────────────────────
async function extractToken(page) {
  return page.evaluate(() => {
    if (window._tsToken) return window._tsToken;
    const inp = document.querySelector('#_ts_box [name="cf-turnstile-response"]');
    return (inp && inp.value) ? inp.value : null;
  });
}

// ── Find Cloudflare iframe ────────────────────────────────────
async function getCFIframeRect(page) {
  return page.evaluate(() => {
    for (const f of document.querySelectorAll('iframe')) {
      const src = f.src || f.getAttribute('src') || '';
      if (!src.includes('challenges.cloudflare.com')) continue;
      const r = f.getBoundingClientRect();
      if (r.width > 50 && r.height > 20) return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return null;
  });
}

// ── Human-like click on checkbox ──────────────────────────────
async function humanClick(page, rect) {
  let cx, cy;
  if (rect) {
    cx = rect.x + 28 + (Math.random() * 6 - 3);
    cy = rect.y + rect.h / 2 + (Math.random() * 6 - 3);
  } else {
    cx = 20 + 28 + (Math.random() * 6 - 3);
    cy = 20 + 32 + (Math.random() * 6 - 3);
  }
  // Move from random position (simulate human)
  await page.mouse.move(cx - 80 + (Math.random() * 40), cy - 20 + (Math.random() * 20));
  await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
  await page.mouse.move(cx, cy);
  await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
  await page.mouse.click(cx, cy);
}

// ═══════════════════════════════════════════════════════════════
//  MAIN SOLVE — any sitekey, any siteurl
// ═══════════════════════════════════════════════════════════════

/**
 * Solve Cloudflare Turnstile on any website.
 *
 * @param {string} sitekey  - Turnstile sitekey from the target page
 * @param {string} siteurl  - Full URL of the page with the Turnstile widget
 * @param {number} timeout  - Max seconds to wait (default 45)
 * @param {object} proxy    - Optional proxy { server, username, password }
 * @returns {string}        - The token (e.g. "0.abc123...")
 */
export async function solveTurnstile(sitekey, siteurl, timeout = 45, proxy = null) {
  const browser = await getBrowser();
  const context = await createContext(browser, proxy);
  const page = await context.newPage();

  try {
    // Navigate to target page
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

    // Inject Turnstile widget
    await injectTurnstile(page, sitekey);
    await new Promise(r => setTimeout(r, 4000));

    // Check auto-solve (invisible widget)
    let token = await extractToken(page);
    if (token) {
      await context.close();
      return token;
    }

    // Wait for checkbox iframe
    let rect = null;
    for (let i = 0; i < 15; i++) {
      rect = await getCFIframeRect(page);
      if (rect) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Click loop
    const deadline = Date.now() + timeout * 1000;
    let clickCount = 0;
    let lastClick = 0;

    while (Date.now() < deadline) {
      token = await extractToken(page);
      if (token) break;

      const now = Date.now();
      if (clickCount === 0 || (!token && now - lastClick > 6000)) {
        if (clickCount >= 3) {
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
        await humanClick(page, rect);
        lastClick = Date.now();
        clickCount++;
        await new Promise(r => setTimeout(r, 1000));
        rect = (await getCFIframeRect(page)) || rect;
        continue;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    if (!token) {
      throw new Error(`Turnstile token not obtained within ${timeout}s`);
    }

    await context.close();
    return token;

  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

// ── Cleanup ───────────────────────────────────────────────────
export async function shutdownTurnstile() {
  if (sharedBrowser) {
    console.log('[Turnstile] Closing persistent browser...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}
