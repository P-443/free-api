// ═══════════════════════════════════════════════════════════════
//  Google reCAPTCHA v2 Solver — Fake page injection + checkbox click
//  Same proven approach as hCaptcha solver. Persistent browser.
//  ANY sitekey + ANY siteurl — not limited to specific sites.
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import { CHROME_PATH } from '../config/index.js';

// ── Optimized Chromium flags ──────────────────────────────────
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
];

// ── Anti-detection script ────────────────────────────────────
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

// ── Build fake reCAPTCHA page with given sitekey ──────────────
function buildCaptchaHTML(sitekey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>reCAPTCHA Demo</title>
<style>
  body { display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; font-family: Arial, sans-serif; }
  .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); }
</style>
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
<script>
function onCaptchaSubmit(token) { window.__RECAPTCHA_TOKEN__ = token; }
function onCaptchaExpired() { window.__RECAPTCHA_TOKEN__ = null; if (typeof grecaptcha !== 'undefined') grecaptcha.reset(); }
</script>
</head>
<body>
<div class="container">
  <h2>Please verify you are human</h2>
  <div class="g-recaptcha"
       data-sitekey="${sitekey}"
       data-callback="onCaptchaSubmit"
       data-expired-callback="onCaptchaExpired">
  </div>
</div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
//  Persistent browser singleton
// ═══════════════════════════════════════════════════════════════

let sharedBrowser = null;
let solveCount = 0;
const MAX_SOLVES_BEFORE_RESTART = 100;

async function getBrowser() {
  if (sharedBrowser && solveCount >= MAX_SOLVES_BEFORE_RESTART) {
    console.log('[reCAPTCHA] Periodic browser restart (every 100 solves)...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
    solveCount = 0;
  }

  if (sharedBrowser && !sharedBrowser.isConnected()) {
    console.log('[reCAPTCHA] Browser disconnected. Restarting...');
    sharedBrowser = null;
    solveCount = 0;
  }

  if (!sharedBrowser) {
    const exePath = CHROME_PATH;
    console.log('[reCAPTCHA] Launching browser:', exePath);
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
async function createOptimizedContext(browser, proxyConfig) {
  const opts = {
    viewport: { width: 800, height: 600 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    isMobile: false,
  };

  if (proxyConfig) {
    opts.proxy = proxyConfig;
  }

  const context = await browser.newContext(opts);

  // Block unnecessary resources (60-80% bandwidth savings)
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

// ── Token extraction ──────────────────────────────────────────
async function extractToken(page) {
  return page.evaluate(() => {
    if (window.__RECAPTCHA_TOKEN__) return window.__RECAPTCHA_TOKEN__;
    const ta = document.querySelector('[name="g-recaptcha-response"]');
    if (ta && ta.value) return ta.value;
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          const ta2 = doc.querySelector('[name="g-recaptcha-response"]');
          if (ta2 && ta2.value) return ta2.value;
        }
      } catch(e) {}
    }
    return null;
  });
}

// ── Single solve attempt ──────────────────────────────────────
async function solveOneAttempt(context, sitekey, siteurl) {
  const page = await context.newPage();

  // Intercept all navigation → serve our fake reCAPTCHA page
  // This works for ANY siteurl — we don't need the real page
  await page.route('**/*', route => {
    const req = route.request();
    // Only intercept top-level document requests
    if (req.resourceType() === 'document') {
      return route.fulfill({ body: buildCaptchaHTML(sitekey), contentType: 'text/html' });
    }
    return route.continue();
  });

  try {
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) {
    await page.close();
    return null;
  }

  // Wait for reCAPTCHA iframe to load
  let iframeEl = null;
  try {
    await page.waitForSelector('iframe[src*="google.com/recaptcha"]', { timeout: 8000 });
    iframeEl = await page.$('iframe[src*="google.com/recaptcha"]');
  } catch (e) {
    await page.close();
    return null;
  }

  if (!iframeEl) { await page.close(); return null; }

  const mainFrame = await iframeEl.contentFrame();
  if (!mainFrame) { await page.close(); return null; }

  // Click the reCAPTCHA checkbox
  try {
    const checkbox = await mainFrame.waitForSelector('.recaptcha-checkbox-border', { timeout: 6000 });
    if (checkbox) {
      await checkbox.click({ delay: 100 });
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (e) {
    try {
      const anchor = await mainFrame.waitForSelector('#recaptcha-anchor', { timeout: 4000 });
      if (anchor) {
        await anchor.click({ delay: 100 });
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e2) {
      await page.close();
      return null;
    }
  }

  // Quick token check (maybe auto-solved / no challenge needed)
  let token = await extractToken(page);
  if (token) { await page.close(); return token; }

  // Wait for challenge to appear and be solved
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !token) {
    await new Promise(r => setTimeout(r, 1000));
    token = await extractToken(page);

    // Check if there's an audio challenge iframe (means visual challenge is hard)
    if (!token) {
      try {
        const hasChallenge = await page.evaluate(() => {
          const frames = document.querySelectorAll('iframe');
          for (const f of frames) {
            if (f.src && f.src.includes('bframe')) return true;
          }
          return false;
        });
        if (hasChallenge) {
          // Challenge is showing — give it more time, check for token
          await new Promise(r => setTimeout(r, 2000));
          token = await extractToken(page);
        }
      } catch(e) {}
    }
  }

  // Last-resort extraction via mainFrame
  if (!token) {
    try {
      token = await mainFrame.evaluate(() => {
        const ta = document.querySelector('[name="g-recaptcha-response"]');
        return ta?.value || null;
      });
    } catch (e) {}
  }

  await page.close();
  return token;
}

// ── Single proxy attempt ──────────────────────────────────────
async function tryWithProxy(proxyConfig, sitekey, siteurl) {
  try {
    const browser = await getBrowser();
    const context = await createOptimizedContext(browser, proxyConfig);
    const token = await solveOneAttempt(context, sitekey, siteurl);
    await context.close();
    return token;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  PUBLIC API — matches the interface expected by server.js /ire
// ═══════════════════════════════════════════════════════════════

/**
 * Solve reCAPTCHA v2 on any website.
 *
 * @param {string} sitekey  - Google reCAPTCHA sitekey
 * @param {string} pageurl  - Page URL (used for referrer/context)
 * @param {object} opts     - { timeout, headless, proxy }
 * @returns {object}        - { token, elapsed, quality } or { token: null, error }
 */
export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { proxy } = opts;

  // Parse proxy if provided as string
  let proxyConfig = null;
  if (proxy) {
    try {
      if (typeof proxy === 'string') {
        const url = new URL(proxy);
        proxyConfig = {
          server: `${url.protocol}//${url.hostname}:${url.port || '80'}`,
          username: decodeURIComponent(url.username || ''),
          password: decodeURIComponent(url.password || ''),
        };
      } else {
        proxyConfig = proxy;
      }
    } catch(e) {
      proxyConfig = { server: proxy };
    }
  }

  const t0 = Date.now();

  // Try with proxy first, then direct
  let token = null;
  if (proxyConfig) {
    token = await tryWithProxy(proxyConfig, sitekey, pageurl);
  }
  if (!token) {
    token = await tryWithProxy(null, sitekey, pageurl);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  if (token && token.length > 20) {
    const quality = token.length > 1500 && token.startsWith('0cAFcWeA') ? 'high' : 'standard';
    console.log(`[reCAPTCHA] SOLVED quality=${quality} len=${token.length} elapsed=${elapsed}s`);
    return { token, elapsed, quality };
  }

  return { token: null, error: 'no_token', elapsed };
}

// ── Cleanup ───────────────────────────────────────────────────
export async function shutdownRecaptcha() {
  if (sharedBrowser) {
    console.log('[reCAPTCHA] Closing persistent browser...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}
