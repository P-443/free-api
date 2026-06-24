// ═══════════════════════════════════════════════════════════════
//  Cloudflare Turnstile Solver — Playwright
//  Exact replica of the working Python nodriver approach:
//  1. Navigate to REAL page
//  2. Inject Turnstile widget into real DOM
//  3. Wait for token (auto-solve) or click checkbox
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import { CHROME_PATH } from '../config/index.js';

// ── Shared persistent browser ────────────────────────────────
let sharedBrowser = null;
let solveCount = 0;
const MAX_SOLVES = 150;

async function getBrowser() {
  if (sharedBrowser && solveCount >= MAX_SOLVES) {
    console.log('[Turnstile] Periodic restart');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
    solveCount = 0;
  }
  if (sharedBrowser && !sharedBrowser.isConnected()) {
    console.log('[Turnstile] Reconnecting browser...');
    sharedBrowser = null;
    solveCount = 0;
  }

  if (!sharedBrowser) {
    const exePath = CHROME_PATH;
    console.log('[Turnstile] Launching browser:', exePath);
    sharedBrowser = await chromium.launch({
      headless: true,
      executablePath: exePath,
      args: [
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
        '--no-crash-upload',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-field-trial-config',
        '--metrics-recording-only',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-features=Translate,OptimizationHints,MediaRouter,IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--renderer-process-limit=1',
        '--disable-low-res-tiling',
        '--disable-threaded-animation',
        '--disable-threaded-scrolling',
        '--disable-smooth-scrolling',
        '--disable-font-subpixel-positioning',
        '--no-pings',
        '--js-flags=--max-old-space-size=256',
        '--log-level=3',
        '--silent',
      ],
    });
    solveCount = 0;
  }

  solveCount++;
  return sharedBrowser;
}

async function createContext(browser, proxy) {
  const opts = {
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    isMobile: false,
  };
  if (proxy) opts.proxy = proxy;
  const ctx = await browser.newContext(opts);

  // Anti-detection — same as hCaptcha solver
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
    window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({state: Notification.permission, onchange: null})
        : origQuery(params);
  `);
  return ctx;
}

// ═══════════════════════════════════════════════════════════════
//  SOLVE — exactly like Python _solve_page()
// ═══════════════════════════════════════════════════════════════

export async function solveTurnstile(sitekey, siteurl, timeout = 45, proxy = null) {
  const browser = await getBrowser();
  const context = await createContext(browser, proxy);
  const page = await context.newPage();

  try {
    // Step 1: Navigate to the REAL page
    console.log('[Turnstile] Navigating to:', siteurl);
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // Step 2: Look for EXISTING Turnstile on the page (site already has one!)
    // Also inject our own widget as a backup
    let token = null;

    // Check if there's already a cf-turnstile-response hidden input on the page
    token = await page.evaluate(() => {
      const inp = document.querySelector('[name="cf-turnstile-response"]');
      return (inp && inp.value) ? inp.value : null;
    });

    // Step 3: If no existing token, inject our own widget
    if (!token) {
      console.log('[Turnstile] No existing token, injecting widget...');
      await page.evaluate((key) => {
        if (document.getElementById('_ts_box')) return;
        window._tsToken = null;
        window._tsError = null;
        const wrap = document.createElement('div');
        wrap.id = '_ts_box';
        wrap.style = 'position:fixed;top:20px;left:20px;z-index:2147483647;background:white;padding:10px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        document.body.appendChild(wrap);
        window._tsLoad = function () {
          if (window.turnstile) {
            window.turnstile.render('#_ts_box', {
              sitekey: key,
              callback: function(tk) { console.log('TS-CALLBACK:', tk.slice(0,20)); window._tsToken = tk; },
              'error-callback': function(e) { console.log('TS-ERROR:', e); window._tsError = e; },
              'expired-callback': function() { console.log('TS-EXPIRED'); },
              'timeout-callback': function() { console.log('TS-TIMEOUT'); }
            });
          }
        };
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_tsLoad&render=explicit';
        s.async = true;
        s.onerror = function() { console.log('TS-SCRIPT-ERROR'); };
        document.head.appendChild(s);
      }, sitekey);

      // Wait for widget to initialize
      await new Promise(r => setTimeout(r, 4000));

      // Check for auto-solve
      token = await page.evaluate(() => {
        if (window._tsToken) return window._tsToken;
        const inp = document.querySelector('#_ts_box [name="cf-turnstile-response"]');
        return (inp && inp.value) ? inp.value : null;
      });

      // Check for errors
      const tsError = await page.evaluate(() => window._tsError);
      if (tsError) console.log('[Turnstile] Widget error:', tsError);
    }

    if (token) { console.log('[Turnstile] Solved!'); await context.close(); return token; }

    // Step 4: Find Turnstile iframe (either existing or ours)
    let rect = null;
    for (let i = 0; i < 15; i++) {
      rect = await page.evaluate(() => {
        for (const f of document.querySelectorAll('iframe')) {
          if (!(f.src || '').includes('challenges.cloudflare.com')) continue;
          const b = f.getBoundingClientRect();
          if (b.width > 50 && b.height > 20) return { x: b.x, y: b.y, w: b.width, h: b.height };
        }
        return null;
      });
      if (rect) { console.log('[Turnstile] Found iframe at', Math.round(rect.x), Math.round(rect.y)); break; }
      token = await page.evaluate(() => {
        if (window._tsToken) return window._tsToken;
        const inp = document.querySelector('[name="cf-turnstile-response"]');
        return (inp && inp.value) ? inp.value : null;
      });
      if (token) { await context.close(); return token; }
      await new Promise(r => setTimeout(r, 500));
    }

    if (token) { await context.close(); return token; }
    if (!rect) throw new Error('Turnstile widget did not load — sitekey may be invalid or site is blocking');

    // Step 5: Click the checkbox
    const deadline = Date.now() + timeout * 1000;
    let clickCount = 0;
    let lastClick = 0;

    while (Date.now() < deadline) {
      token = await page.evaluate(() => {
        if (window._tsToken) return window._tsToken;
        const inp = document.querySelector('[name="cf-turnstile-response"]');
        return (inp && inp.value) ? inp.value : null;
      });
      if (token) break;

      const now = Date.now();
      if (clickCount === 0 || (now - lastClick > 6000)) {
        if (clickCount >= 3) { await new Promise(r => setTimeout(r, 300)); continue; }

        let cx = rect.x + 28 + (Math.random() * 6 - 3);
        let cy = rect.y + rect.h / 2 + (Math.random() * 6 - 3);
        await page.mouse.move(cx - 80, cy - 20);
        await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
        await page.mouse.move(cx, cy);
        await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
        await page.mouse.click(cx, cy);

        lastClick = Date.now();
        clickCount++;
        console.log('[Turnstile] Click', clickCount);
        await new Promise(r => setTimeout(r, 1000));
        rect = (await page.evaluate(() => {
          for (const f of document.querySelectorAll('iframe')) {
            if (!(f.src || '').includes('challenges.cloudflare.com')) continue;
            const b = f.getBoundingClientRect();
            if (b.width > 50 && b.height > 20) return { x: b.x, y: b.y, w: b.width, h: b.height };
          }
          return null;
        })) || rect;
        continue;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (token) { console.log('[Turnstile] Solved after', clickCount, 'clicks'); await context.close(); return token; }
    throw new Error(`Turnstile token not obtained within ${timeout}s`);

  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

export async function shutdownTurnstile() {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}
