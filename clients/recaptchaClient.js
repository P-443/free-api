// ═══════════════════════════════════════════════════════════
//  reCAPTCHA v2 — max stealth via CDP + full fingerprint spoof
// ═══════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import { spawn } from 'child_process';

async function launchStealthBrowser(proxy) {
  // Launch real Chrome via CDP for maximum stealth
  const chromePath = '/usr/bin/google-chrome-stable';
  const args = [
    '--remote-debugging-port=0',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins',
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    '--password-store=basic',
    '--window-size=1440,900',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--disable-extensions',
    'about:blank',
  ];

  if (proxy) {
    try {
      const url = new URL(proxy);
      args.push(`--proxy-server=${url.hostname}:${url.port || '80'}`);
    } catch(e) {
      args.push(`--proxy-server=${proxy}`);
    }
  }

  // Launch Chrome and get CDP port
  return new Promise((resolve, reject) => {
    const proc = spawn(chromePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
    });

    let cdpPort = null;
    const timeout = setTimeout(() => {
      if (!cdpPort) reject(new Error('Chrome launch timeout'));
    }, 15000);

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/);
      if (match) {
        cdpPort = parseInt(match[1]);
        clearTimeout(timeout);
        resolve(cdpPort);
      }
    });

    proc.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });

    proc.on('exit', () => {
      clearTimeout(timeout);
      if (!cdpPort) reject(new Error('Chrome exited without CDP'));
    });
  });
}

export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { timeout = 60, proxy } = opts;
  const start = Date.now();

  let browser;
  try {
    // Try CDP-launched real Chrome first
    console.log('[reCAPTCHA] Launching real Chrome via CDP...');
    const cdpPort = await launchStealthBrowser(proxy);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    console.log('[reCAPTCHA] Connected via CDP — max stealth');
  } catch(e) {
    // Fallback to Playwright Chromium
    console.log('[reCAPTCHA] CDP failed, using Playwright Chromium:', e.message);
    const launchOpts = {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins',
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-software-rasterizer',
      ],
    };
    if (proxy) {
      try {
        const url = new URL(proxy);
        launchOpts.proxy = {
          server: `${url.protocol}//${url.hostname}:${url.port || '80'}`,
          username: decodeURIComponent(url.username || ''),
          password: decodeURIComponent(url.password || ''),
        };
      } catch(e) {
        launchOpts.proxy = { server: proxy };
      }
    }
    browser = await chromium.launch(launchOpts);
  }

  // Random viewport
  const vpW = [1366, 1440, 1440, 1536, 1920, 1920, 2560][Math.floor(Math.random() * 7)];
  const vpH = [768, 900, 900, 864, 1080, 1080, 1440][Math.floor(Math.random() * 7)];
  await page.setViewportSize({ width: vpW, height: vpH });

  // Random fingerprint for each solve
  const fp = {
    platform: ['Win32', 'Win32', 'Win32', 'MacIntel', 'Linux x86_64'][Math.floor(Math.random() * 5)],
    cores: [4, 4, 8, 8, 8, 12, 16][Math.floor(Math.random() * 7)],
    memory: [4, 8, 8, 8, 16, 32][Math.floor(Math.random() * 6)],
    lang: [['en-US','en'], ['en-US','en'], ['en-US','en'], ['en-GB','en'], ['de-DE','de','en']][Math.floor(Math.random() * 5)],
    gpuVendor: ['Google Inc.', 'Google Inc.', 'Google Inc.', 'Intel Inc.', 'AMD'][Math.floor(Math.random() * 5)],
    gpuRenderer: ['ANGLE (Google, Vulkan 1.3.0)', 'ANGLE (Intel, Vulkan)', 'ANGLE (AMD, Vulkan)'][Math.floor(Math.random() * 3)],
  };
  console.log(`[reCAPTCHA] FP: ${fp.platform} ${vpW}x${vpH} cores=${fp.cores} gpu=${fp.gpuVendor.split(' ')[0]}`);

  await page.addInitScript((fp) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }, { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' }, { name: 'Native Client', filename: 'internal-nacl-plugin' }];
        arr.item = i => arr[i]; arr.namedItem = n => arr.find(p => p.name === n); arr.refresh = () => {}; return arr;
      }
    });
    Object.defineProperty(navigator, 'languages', { get: () => fp.lang });
    Object.defineProperty(navigator, 'language', { get: () => fp.lang[0] });
    Object.defineProperty(navigator, 'platform', { get: () => fp.platform });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.cores });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.memory });
    const origQ = navigator.permissions.query;
    navigator.permissions.query = p => p.name === 'notifications' ? Promise.resolve({ state: 'prompt' }) : origQ(p);
    try {
      const getParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return fp.gpuVendor;
        if (p === 37446) return fp.gpuRenderer;
        return getParam.call(this, p);
      };
    } catch(e) {}
  }, fp);

  try {
    const origin = new URL(pageurl).origin;
    console.log(`[reCAPTCHA] Loading: ${origin}`);
    await page.goto(origin, { waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(2000);

    const token = await page.evaluate(({ sitekey, timeout }) => {
      return new Promise((resolve) => {
        function doRender() {
          const c = document.createElement('div');
          c.style.display = 'none';
          document.body.appendChild(c);
          try {
            grecaptcha.render(c, {
              sitekey, size: 'invisible',
              callback: t => resolve(t),
              'expired-callback': () => resolve(''),
              'error-callback': () => resolve(''),
            });
            grecaptcha.execute();
          } catch(e) { resolve(''); }
        }
        if (typeof grecaptcha !== 'undefined' && grecaptcha.render) doRender();
        else {
          const s = document.createElement('script');
          s.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
          s.onload = () => grecaptcha.ready(doRender);
          s.onerror = () => resolve('');
          document.head.appendChild(s);
        }
        setTimeout(() => resolve(''), timeout * 1000);
      });
    }, { sitekey, timeout });

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    if (token && token.length > 100) {
      console.log(`[reCAPTCHA] Solved! len=${token.length} elapsed=${elapsed}s`);
      return { token, elapsed };
    }
    return { token: null, error: 'no_token', elapsed };
  } catch(e) {
    return { token: null, error: e.message, elapsed: ((Date.now() - start) / 1000).toFixed(2) };
  } finally {
    await browser.close().catch(() => {});
  }
}
