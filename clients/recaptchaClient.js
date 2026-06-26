// ═══════════════════════════════════════════════════════════
//  reCAPTCHA v2 — random fingerprint each solve
//  Different browser profile every time = Google can't track
// ═══════════════════════════════════════════════════════════

import { chromium } from 'playwright';

export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { timeout = 60, proxy } = opts;
  const start = Date.now();

  // Random fingerprint per solve
  const fp = {
    platform: ['Win32','Win32','Win32','MacIntel','Linux x86_64'][Math.floor(Math.random()*5)],
    cores: [4,4,8,8,8,12,16][Math.floor(Math.random()*7)],
    memory: [4,8,8,8,16,32][Math.floor(Math.random()*6)],
    lang: [['en-US','en'],['en-US','en'],['en-US','en'],['en-GB','en']][Math.floor(Math.random()*4)],
    gpuV: ['Google Inc.','Google Inc.','Google Inc.','Intel Inc.','AMD'][Math.floor(Math.random()*5)],
    gpuR: ['ANGLE (Google, Vulkan 1.3.0)','ANGLE (Intel, Vulkan)','ANGLE (AMD, Vulkan)'][Math.floor(Math.random()*3)],
  };
  const vpW = [1366,1440,1440,1536,1920,1920][Math.floor(Math.random()*6)];
  const vpH = [768,900,900,864,1080,1080][Math.floor(Math.random()*6)];
  console.log(`[reCAPTCHA] FP: ${fp.platform} ${vpW}x${vpH} cores=${fp.cores}`);

  const launchOpts = {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins',
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-dev-shm-usage','--disable-gpu',
      '--disable-software-rasterizer',
    ],
  };

  if (proxy) {
    try {
      const url = new URL(proxy);
      launchOpts.proxy = {
        server: `${url.protocol}//${url.hostname}:${url.port||'80'}`,
        username: decodeURIComponent(url.username||''),
        password: decodeURIComponent(url.password||''),
      };
    } catch(e) {
      launchOpts.proxy = { server: proxy };
    }
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    viewport: { width: vpW, height: vpH },
  });

  const page = await context.newPage();

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
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return fp.gpuV;
        if (p === 37446) return fp.gpuR;
        return gp.call(this, p);
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
            grecaptcha.render(c, { sitekey, size:'invisible',
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
