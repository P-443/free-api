// ═══════════════════════════════════════════════════════════════
//  Cloudflare Turnstile Solver — Playwright
//  Exact replica of the working Python nodriver approach:
//  1. Navigate to REAL page
//  2. Inject Turnstile widget into real DOM
//  3. Wait for token (auto-solve) or click checkbox
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

// ── Chrome path (like Python auto-detect) ────────────────────
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[0]; // fallback
}

// ── Profile dir (persistent profile = harder to detect) ──────
function getProfileDir() {
  if (process.env.TS_PROFILE_DIR) return process.env.TS_PROFILE_DIR;
  const dir = join(tmpdir(), 'ts_profile');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

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
    const exePath = findChrome();
    console.log('[Turnstile] Launching browser:', exePath);
    sharedBrowser = await chromium.launch({
      headless: true,
      executablePath: exePath,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=Translate,OptimizationHints,IsolateOrigins',
        '--no-first-run',
        '--no-default-browser-check',
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

  // Anti-detection
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
    window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
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
    // Step 1: Navigate to the REAL page (like nodriver)
    console.log('[Turnstile] Navigating to:', siteurl);
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

    // Step 2: Inject Turnstile widget into REAL page DOM
    console.log('[Turnstile] Injecting Turnstile widget...');
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

    await new Promise(r => setTimeout(r, 4000));

    // Step 3: Check for auto-solve (invisible widget)
    let token = await page.evaluate(() => {
      if (window._tsToken) return window._tsToken;
      const inp = document.querySelector('#_ts_box [name="cf-turnstile-response"]');
      return (inp && inp.value) ? inp.value : null;
    });
    if (token) { await context.close(); return token; }

    // Step 4: Wait for Cloudflare iframe (checkbox)
    let rect = null;
    for (let i = 0; i < 15; i++) {
      rect = await page.evaluate(() => {
        const r = JSON.stringify((() => {
          for (const f of document.querySelectorAll('iframe')) {
            const src = f.src || f.getAttribute('src') || '';
            if (!src.includes('challenges.cloudflare.com')) continue;
            const b = f.getBoundingClientRect();
            if (b.width > 50 && b.height > 20) return { x: b.x, y: b.y, w: b.width, h: b.height };
          }
          return null;
        })());
        return r !== 'null' ? JSON.parse(r) : null;
      });
      if (rect) {
        console.log('[Turnstile] Found iframe at', Math.round(rect.x), Math.round(rect.y));
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (token) { await context.close(); return token; }

    // Step 5: Click loop (exact same logic as Python)
    const deadline = Date.now() + timeout * 1000;
    let clickCount = 0;
    let lastClick = 0;

    while (Date.now() < deadline) {
      token = await page.evaluate(() => {
        if (window._tsToken) return window._tsToken;
        const inp = document.querySelector('#_ts_box [name="cf-turnstile-response"]');
        return (inp && inp.value) ? inp.value : null;
      });
      if (token) break;

      const now = Date.now();
      if (clickCount === 0 || (now - lastClick > 6000)) {
        if (clickCount >= 3) { await new Promise(r => setTimeout(r, 300)); continue; }

        // Human-like click
        let cx, cy;
        if (rect) {
          cx = rect.x + 28 + (Math.random() * 6 - 3);
          cy = rect.y + rect.h / 2 + (Math.random() * 6 - 3);
        } else {
          cx = 20 + 28 + (Math.random() * 6 - 3);
          cy = 20 + 32 + (Math.random() * 6 - 3);
        }
        await page.mouse.move(cx - 80, cy - 20);
        await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
        await page.mouse.move(cx, cy);
        await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
        await page.mouse.click(cx, cy);

        lastClick = Date.now();
        clickCount++;
        console.log('[Turnstile] Click', clickCount);
        await new Promise(r => setTimeout(r, 1000));
        rect = await page.evaluate(() => {
          const r = JSON.stringify((() => {
            for (const f of document.querySelectorAll('iframe')) {
              if (!(f.src || '').includes('challenges.cloudflare.com')) continue;
              const b = f.getBoundingClientRect();
              if (b.width > 50 && b.height > 20) return { x: b.x, y: b.y, w: b.width, h: b.height };
            }
            return null;
          })());
          return r !== 'null' ? JSON.parse(r) : null;
        }) || rect;
        continue;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (token) {
      console.log('[Turnstile] Solved!');
      await context.close();
      return token;
    }

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
