// ═══════════════════════════════════════════════════════════════
//  Google reCAPTCHA v2 Solver — Real Chrome + persistent context
//  Loads REAL page, clicks checkbox. Retries on challenge.
//  Use channel:'chrome' for real Google Chrome (better stealth).
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import { CHROME_PATH } from '../config/index.js';

const useChannel = !!CHROME_PATH && CHROME_PATH.includes('google-chrome');

const BROWSER_ARGS = [
  '--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  '--disable-software-rasterizer','--disable-background-networking',
  '--disable-background-timer-throttling','--disable-sync',
  '--disable-breakpad','--disable-crash-reporter','--no-crash-upload',
  '--disable-client-side-phishing-detection','--disable-component-update',
  '--disable-field-trial-config','--metrics-recording-only',
  '--disable-extensions','--disable-default-apps',
  '--disable-features=Translate,OptimizationHints,MediaRouter',
  '--disable-blink-features=AutomationControlled',
  '--renderer-process-limit=1','--no-pings',
  '--js-flags=--max-old-space-size=256','--log-level=3','--silent',
];

let sharedBrowser = null;
let solveCount = 0;

async function getBrowser() {
  if (sharedBrowser && (solveCount >= 80 || !sharedBrowser.isConnected())) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null; solveCount = 0;
  }
  if (!sharedBrowser) {
    const opts = {
      headless: false,
      args: [...BROWSER_ARGS, ...(process.platform === 'linux' ? ['--display=:99'] : [])],
    };
    if (useChannel) opts.channel = 'chrome';
    console.log('[reCAPTCHA] Launching:', useChannel ? 'Chrome' : 'Chromium');
    sharedBrowser = await chromium.launch(opts);
    solveCount = 0;
  }
  solveCount++;
  return sharedBrowser;
}

async function createContext(browser, proxy) {
  const vpW = [1366, 1440, 1536, 1920][Math.floor(Math.random() * 4)];
  const vpH = [768, 900, 864, 1080][Math.floor(Math.random() * 4)];
  const opts = {
    viewport: { width: vpW, height: vpH },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    locale: 'en-US', timezoneId: 'America/New_York',
    deviceScaleFactor: 1, isMobile: false,
  };
  if (proxy) opts.proxy = proxy;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
    window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
  `);
  return ctx;
}

async function attemptSolve(ctx, sitekey, siteurl) {
  const page = await ctx.newPage();
  try {
    console.log(`[reCAPTCHA] Loading: ${siteurl.slice(0, 60)}...`);
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));

    // Quick check: already solved?
    let token = await page.evaluate(() => {
      const ta = document.querySelector('[name="g-recaptcha-response"]');
      return ta?.value || null;
    });
    if (token) { await page.close(); return token; }

    // Find reCAPTCHA iframe
    let iframe = null;
    for (let i = 0; i < 12; i++) {
      iframe = await page.$('iframe[src*="google.com/recaptcha"]');
      if (iframe) break;
      if (i === 4) {
        await page.evaluate(k => {
          if (!document.querySelector('.g-recaptcha')) {
            const d = document.createElement('div');
            d.className = 'g-recaptcha';
            d.setAttribute('data-sitekey', k);
            d.setAttribute('data-callback', 'rcCall');
            window.rcCall = t => { window.__RC__ = t; };
            document.body.appendChild(d);
            const s = document.createElement('script');
            s.src = 'https://www.google.com/recaptcha/api.js';
            document.head.appendChild(s);
          }
        }, sitekey);
        await new Promise(r => setTimeout(r, 3000));
      }
      await new Promise(r => setTimeout(r, 500));
    }

    iframe = await page.$('iframe[src*="google.com/recaptcha"]');
    if (!iframe) {
      token = await page.evaluate(() => window.__RC__ || null);
      await page.close();
      return token;
    }

    const mf = await iframe.contentFrame();
    if (!mf) { await page.close(); return null; }

    // Click checkbox
    try {
      const anchor = await mf.waitForSelector('#recaptcha-anchor', { timeout: 5000 });
      if (anchor) {
        const bb = await anchor.boundingBox();
        if (bb) {
          await page.mouse.move(bb.x + bb.width/2 - 25 + Math.random()*10, bb.y + bb.height/2 + 5);
          await page.mouse.click(bb.x + bb.width/2, bb.y + bb.height/2);
          console.log('[reCAPTCHA] Checkbox clicked');
        }
      }
    } catch(e) {}

    // Wait for token (max 20s)
    const dl = Date.now() + 20000;
    while (Date.now() < dl) {
      token = await page.evaluate(() => {
        if (window.__RC__) return window.__RC__;
        const ta = document.querySelector('[name="g-recaptcha-response"]');
        return ta?.value || null;
      });
      if (token) break;
      await new Promise(r => setTimeout(r, 800));
    }

    await page.close();
    return token;
  } catch(e) {
    await page.close().catch(() => {});
    return null;
  }
}

export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { proxy } = opts;
  let proxyConfig = null;
  if (proxy) {
    try {
      if (typeof proxy === 'string') {
        const u = new URL(proxy);
        proxyConfig = { server: `${u.protocol}//${u.hostname}:${u.port||'80'}`, username: decodeURIComponent(u.username||''), password: decodeURIComponent(u.password||'') };
      } else { proxyConfig = proxy; }
    } catch(e) { proxyConfig = { server: proxy }; }
  }

  const t0 = Date.now();
  let token = null;

  // Try up to 2 times with fresh context each time
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 0 && proxyConfig) {
      token = await trySolve(proxyConfig, sitekey, pageurl);
    } else {
      token = await trySolve(null, sitekey, pageurl);
    }
    if (token) break;
    console.log(`[reCAPTCHA] Attempt ${attempt+1} failed, retrying...`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  if (token && token.length > 20) {
    const q = token.length > 1500 ? 'high' : 'standard';
    console.log(`[reCAPTCHA] SOLVED q=${q} len=${token.length} ${elapsed}s`);
    return { token, elapsed, quality: q };
  }
  return { token: null, error: 'no_token', elapsed };
}

async function trySolve(proxyConfig, sitekey, pageurl) {
  try {
    const browser = await getBrowser();
    const ctx = await createContext(browser, proxyConfig);
    const token = await attemptSolve(ctx, sitekey, pageurl);
    await ctx.close();
    return token;
  } catch(e) { return null; }
}

export async function shutdownRecaptcha() {
  if (sharedBrowser) { await sharedBrowser.close().catch(() => {}); sharedBrowser = null; }
}
