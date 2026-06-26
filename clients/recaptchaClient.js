// ═══════════════════════════════════════════════════════════
//  reCAPTCHA v2 Client — Real Chrome + about:blank injection
//  Exact same as working local Selenium approach.
//  Dockerfile installs Google Chrome stable → channel: 'chrome'
// ═══════════════════════════════════════════════════════════

import { chromium } from 'playwright';

export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { timeout = 60, proxy } = opts;
  const start = Date.now();

  const launchOpts = {
    headless: true,
    channel: 'chrome',  // Use REAL Chrome from Dockerfile (not Playwright Chromium)
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-first-run',
      '--no-default-browser-check',
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

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
    if (!window.chrome) window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  const page = await context.newPage();

  try {
    // Exact same approach as card_checker_auto.py:
    // Load about:blank, inject reCAPTCHA API, render widget, execute
    await page.goto('about:blank');
    console.log(`[reCAPTCHA] Real Chrome on about:blank, injecting widget...`);

    const token = await page.evaluate(({ sitekey, timeout }) => {
      return new Promise((resolve) => {
        function doRender() {
          const c = document.createElement('div');
          c.style.display = 'none';
          document.body.appendChild(c);
          try {
            grecaptcha.render(c, {
              sitekey,
              size: 'invisible',
              callback: (t) => resolve(t),
              'expired-callback': () => resolve(''),
              'error-callback': () => resolve(''),
            });
            grecaptcha.execute();
          } catch(e) {
            resolve('');
          }
        }

        if (typeof grecaptcha !== 'undefined' && grecaptcha.render) {
          doRender();
        } else {
          const s = document.createElement('script');
          s.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
          s.onload = () => { grecaptcha.ready(doRender); };
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
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.error(`[reCAPTCHA] Error: ${e.message}`);
    return { token: null, error: e.message, elapsed };
  } finally {
    await browser.close().catch(() => {});
  }
}
