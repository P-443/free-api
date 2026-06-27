// ═══════════════════════════════════════════════════════════════
//  Google reCAPTCHA v2 Solver — loads REAL page, clicks real checkbox
//  Same proven approach as Turnstile solver (real page + iframe click)
//  Random fingerprint per solve — Google can't track.
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

// ═══════════════════════════════════════════════════════════════
//  Persistent browser singleton
// ═══════════════════════════════════════════════════════════════

let sharedBrowser = null;
let solveCount = 0;
const MAX_SOLVES_BEFORE_RESTART = 100;

async function getBrowser() {
  if (sharedBrowser && solveCount >= MAX_SOLVES_BEFORE_RESTART) {
    console.log('[reCAPTCHA] Periodic browser restart...');
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

// ── Random fingerprint context ────────────────────────────────
async function createContext(browser, proxyConfig) {
  const vpW = [1366, 1440, 1440, 1536, 1920][Math.floor(Math.random() * 5)];
  const vpH = [768, 900, 900, 864, 1080][Math.floor(Math.random() * 5)];

  const opts = {
    viewport: { width: vpW, height: vpH },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    deviceScaleFactor: 1,
    isMobile: false,
  };

  if (proxyConfig) opts.proxy = proxyConfig;

  const ctx = await browser.newContext(opts);

  // Anti-detection
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
//  SOLVE — load REAL page, find reCAPTCHA, click checkbox, get token
// ═══════════════════════════════════════════════════════════════

async function solveOneAttempt(ctx, sitekey, siteurl) {
  const page = await ctx.newPage();

  try {
    // Step 1: Navigate to the REAL page (domain must match sitekey registration)
    console.log(`[reCAPTCHA] Loading: ${siteurl.slice(0, 70)}...`);
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));

    // Step 2: Check if token already exists on page (auto-solved or cached)
    let token = await page.evaluate(() => {
      const ta = document.querySelector('[name="g-recaptcha-response"]');
      return (ta && ta.value) ? ta.value : null;
    });
    if (token) { console.log('[reCAPTCHA] Already solved!'); await page.close(); return token; }

    // Step 3: Find the reCAPTCHA iframe on the real page
    let iframeEl = null;
    for (let i = 0; i < 10; i++) {
      iframeEl = await page.$('iframe[src*="google.com/recaptcha"]');
      if (iframeEl) break;
      // Maybe the reCAPTCHA hasn't loaded yet — inject it ourselves
      if (i === 5) {
        console.log('[reCAPTCHA] No widget found, injecting...');
        await page.evaluate((key) => {
          const div = document.createElement('div');
          div.className = 'g-recaptcha';
          div.setAttribute('data-sitekey', key);
          div.setAttribute('data-callback', 'tsRecapCb');
          window.tsRecapCb = (tk) => { window.__RC_TOKEN__ = tk; };
          document.body.appendChild(div);
          const s = document.createElement('script');
          s.src = 'https://www.google.com/recaptcha/api.js';
          document.head.appendChild(s);
        }, sitekey);
        await new Promise(r => setTimeout(r, 3000));
      }
      await new Promise(r => setTimeout(r, 500));
    }

    iframeEl = await page.$('iframe[src*="google.com/recaptcha"]');
    if (!iframeEl) {
      // Check for injected token
      token = await page.evaluate(() => window.__RC_TOKEN__ || null);
      if (token) { await page.close(); return token; }
      await page.close();
      return null;
    }

    // Step 4: Access the iframe and click the checkbox
    const mainFrame = await iframeEl.contentFrame();
    if (!mainFrame) { await page.close(); return null; }

    // Click the checkbox using human-like behavior
    try {
      const box = await mainFrame.waitForSelector('.recaptcha-checkbox-border', { timeout: 5000 });
      if (box) {
        const box2 = await mainFrame.$('#recaptcha-anchor');
        if (box2) {
          const bb = await box2.boundingBox();
          if (bb) {
            // Human-like mouse movement before click
            await page.mouse.move(bb.x + bb.width/2 - 30, bb.y + bb.height/2 + 10);
            await new Promise(r => setTimeout(r, 80 + Math.random() * 100));
            await page.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2);
            await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
            await page.mouse.click(bb.x + bb.width/2, bb.y + bb.height/2);
          } else {
            await box.click({ delay: 100 });
          }
        } else {
          await box.click({ delay: 100 });
        }
        console.log('[reCAPTCHA] Checkbox clicked');
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.log('[reCAPTCHA] Checkbox click error:', e.message.slice(0, 40));
    }

    // Step 5: Wait for token (checkbox may auto-pass, or challenge may appear)
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
      // Check all possible token sources
      token = await page.evaluate(() => {
        if (window.__RC_TOKEN__) return window.__RC_TOKEN__;
        const ta = document.querySelector('[name="g-recaptcha-response"]');
        if (ta && ta.value) return ta.value;
        return null;
      });
      if (token) break;

      // Check iframe token
      try {
        token = await mainFrame.evaluate(() => {
          const ta = document.querySelector('[name="g-recaptcha-response"]');
          return ta?.value || null;
        });
      } catch(e) {}
      if (token) break;

      await new Promise(r => setTimeout(r, 1000));
    }

    if (token) {
      console.log(`[reCAPTCHA] Token obtained! len=${token.length}`);
      await page.close();
      return token;
    }

    console.log('[reCAPTCHA] Timeout — no token');
    await page.close();
    return null;

  } catch (e) {
    console.log('[reCAPTCHA] Error:', e.message.slice(0, 60));
    await page.close().catch(() => {});
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════

export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { proxy } = opts;

  // Parse proxy
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

  // Try up to 2 attempts (with/without proxy)
  let token = null;
  if (proxyConfig) {
    token = await solveWithConfig(proxyConfig, sitekey, pageurl);
  }
  if (!token) {
    token = await solveWithConfig(null, sitekey, pageurl);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  if (token && token.length > 20) {
    const quality = token.length > 1500 ? 'high' : 'standard';
    console.log(`[reCAPTCHA] SOLVED quality=${quality} len=${token.length} elapsed=${elapsed}s`);
    return { token, elapsed, quality };
  }

  return { token: null, error: 'no_token', elapsed };
}

async function solveWithConfig(proxyConfig, sitekey, pageurl) {
  try {
    const browser = await getBrowser();
    const ctx = await createContext(browser, proxyConfig);
    const token = await solveOneAttempt(ctx, sitekey, pageurl);
    await ctx.close();
    return token;
  } catch (e) {
    return null;
  }
}

// ── Cleanup ───────────────────────────────────────────────────
export async function shutdownRecaptcha() {
  if (sharedBrowser) {
    console.log('[reCAPTCHA] Closing persistent browser...');
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}
