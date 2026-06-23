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
    // Set referrer to target site so Turnstile sees the right origin
    extraHTTPHeaders: {
      'Referer': siteurl,
    },
  };

  if (proxyConfig) {
    opts.proxy = proxyConfig;
  }

  const context = await browser.newContext(opts);

  // Block heavy resources
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
    // Use fake page approach — much more reliable than injecting into real pages
    const html = buildTurnstilePage(sitekey, siteurl);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Wait for Turnstile API to load
    await new Promise(r => setTimeout(r, 2000));

    // Check for auto-solve (invisible widget)
    let token = await extractToken(page);
    if (token) {
      console.log('[Turnstile] Auto-solved (invisible)');
      await context.close();
      return token;
    }

    // Wait for iframe
    let rect = null;
    for (let i = 0; i < 20; i++) {
      rect = await findTurnstileFrame(page);
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
      if (clickCount === 0 || (now - lastClick > 6000)) {
        if (clickCount >= 5) {
          // Too many clicks, wait
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        await humanClick(page, rect);
        lastClick = Date.now();
        clickCount++;
        await new Promise(r => setTimeout(r, 1200));
        rect = (await findTurnstileFrame(page)) || rect;
        continue;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (token) {
      console.log('[Turnstile] Solved after', clickCount, 'clicks');
      await context.close();
      return token;
    }

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
