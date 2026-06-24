// ═══════════════════════════════════════════════════════════════
//  hCaptcha Solver — Generic (ANY sitekey + siteurl)
//  Persistent browser + parallel contexts = max tokens/sec
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

// ── Build fake hCaptcha page with given sitekey ───────────────
function buildCaptchaHTML(sitekey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>hCaptcha Solver</title>
<style>
  body { display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; font-family: Arial, sans-serif; }
  .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); }
</style>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
<script>
function onCaptchaSubmit(token) { window.__HCAPTCHA_TOKEN__ = token; }
function onCaptchaExpired() { window.__HCAPTCHA_TOKEN__ = null; hcaptcha.reset(); }
function onCaptchaError(err) { console.error('hCaptcha error:', err); }
</script>
</head>
<body>
<div class="container">
  <h2>Solving hCaptcha...</h2>
  <div class="h-captcha"
       data-sitekey="${sitekey}"
       data-callback="onCaptchaSubmit"
       data-expired-callback="onCaptchaExpired"
       data-error-callback="onCaptchaError">
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
    console.log('[hCaptcha] Periodic browser restart (every 100 solves)...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
    solveCount = 0;
  }

  if (sharedBrowser && !sharedBrowser.isConnected()) {
    console.log('[hCaptcha] Browser disconnected. Restarting...');
    sharedBrowser = null;
    solveCount = 0;
  }

  if (!sharedBrowser) {
    const exePath = CHROME_PATH;
    console.log('[hCaptcha] Launching browser:', exePath);
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
    if (window.__HCAPTCHA_TOKEN__) return window.__HCAPTCHA_TOKEN__;
    const ta = document.querySelector('[name="h-captcha-response"]');
    if (ta && ta.value) return ta.value;
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          const ta2 = doc.querySelector('[name="h-captcha-response"]');
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

  // Intercept navigation to target URL → serve our fake hCaptcha page
  await page.route(siteurl.replace(/\/$/, '') + '/**', route =>
    route.fulfill({ body: buildCaptchaHTML(sitekey), contentType: 'text/html' })
  );
  // Also intercept the root
  await page.route(siteurl.replace(/\/$/, ''), route =>
    route.fulfill({ body: buildCaptchaHTML(sitekey), contentType: 'text/html' })
  );

  try {
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) {
    await page.close();
    return null;
  }

  // Wait for hCaptcha iframe
  let iframeEl = null;
  try {
    await page.waitForSelector('iframe[src*="hcaptcha.com"]', { timeout: 6000 });
    iframeEl = await page.$('iframe[src*="hcaptcha.com"]');
  } catch (e) {
    await page.close();
    return null;
  }

  if (!iframeEl) { await page.close(); return null; }

  const mainFrame = await iframeEl.contentFrame();
  if (!mainFrame) { await page.close(); return null; }

  // Click checkbox
  try {
    const checkbox = await mainFrame.waitForSelector('#checkbox', { timeout: 5000 });
    if (checkbox) {
      await checkbox.click();
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) {
    await page.close();
    return null;
  }

  // Quick token check (maybe auto-solved)
  let token = await extractToken(page);
  if (token) { await page.close(); return token; }

  // Wait for challenge or token
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !token) {
    await new Promise(r => setTimeout(r, 1000));
    token = await extractToken(page);
    if (token) break;
  }

  // Last-resort extraction via mainFrame
  if (!token) {
    try {
      token = await mainFrame.evaluate(() => {
        const ta = document.querySelector('[name="h-captcha-response"]');
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
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Solve hCaptcha on any website (not just travel.bcengi).
 *
 * @param {string} sitekey  - hCaptcha sitekey
 * @param {string} siteurl  - Page URL (used for referrer/context)
 * @param {Array}  proxies  - Array of { server, username, password }
 * @returns {string|null}   - The token or null if all attempts fail
 */
export async function solveHCaptcha(sitekey, siteurl, proxies = []) {
  for (const proxy of proxies) {
    const label = proxy.server;
    const token = await tryWithProxy(proxy, sitekey, siteurl);
    if (token && token.length > 20) {
      console.log(`  [${label}] solved!`);
      return token;
    }
  }

  // Fallback: direct (no proxy)
  if (proxies.length > 0) {
    console.log('  Trying direct (no proxy)...');
    const token = await tryWithProxy(null, sitekey, siteurl);
    if (token && token.length > 20) {
      console.log('  [direct] solved!');
      return token;
    }
  }

  // If no proxies provided, try direct
  if (proxies.length === 0) {
    const token = await tryWithProxy(null, sitekey, siteurl);
    if (token && token.length > 20) return token;
  }

  return null;
}

/**
 * Solve hCaptcha in batch — N parallel contexts, N tokens.
 *
 * @param {string} sitekey   - hCaptcha sitekey
 * @param {string} siteurl   - Page URL
 * @param {Array}  proxies   - Proxy list
 * @param {number} batchSize - How many to solve in parallel (default 10)
 * @returns {string[]}       - Array of valid tokens
 */
export async function solveHCaptchaBatch(sitekey, siteurl, proxies, batchSize = 10) {
  const proxiesToUse = proxies.slice(0, batchSize);
  if (proxiesToUse.length === 0) return [];

  const browser = await getBrowser();

  // Create all contexts in parallel
  const contextPromises = proxiesToUse.map(async (proxy) => {
    try {
      const context = await createOptimizedContext(browser, proxy);
      return { context, proxy };
    } catch (e) {
      return null;
    }
  });

  const contexts = (await Promise.all(contextPromises)).filter(Boolean);

  // Solve ALL in parallel
  const solvePromises = contexts.map(async ({ context, proxy }) => {
    try {
      const token = await solveOneAttempt(context, sitekey, siteurl);
      await context.close().catch(() => {});
      return token;
    } catch (e) {
      await context.close().catch(() => {});
      return null;
    }
  });

  const results = await Promise.allSettled(solvePromises);
  const tokens = results
    .filter(r => r.status === 'fulfilled' && r.value && r.value.length > 20)
    .map(r => r.value);

  return tokens;
}

// ── Cleanup ───────────────────────────────────────────────────
export async function shutdownHCaptcha() {
  if (sharedBrowser) {
    console.log('[hCaptcha] Closing persistent browser...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}
