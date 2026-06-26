// ═══════════════════════════════════════════════════════════
//  reCAPTCHA v2 Client — puppeteer-extra + stealth plugin
//  Same approach as undetected-chromedriver for Node.js
//  Much better anti-detection than vanilla Playwright
// ═══════════════════════════════════════════════════════════

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin for undetected-chromedriver-level anti-detection
puppeteer.use(StealthPlugin());

export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { timeout = 60, proxy } = opts;
  const start = Date.now();

  const launchOpts = {
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins',
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
    ],
  };

  if (proxy) {
    try {
      const url = new URL(proxy);
      launchOpts.args.push(`--proxy-server=${url.hostname}:${url.port || '80'}`);
    } catch(e) {
      launchOpts.args.push(`--proxy-server=${proxy}`);
    }
  }

  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();

  // Set viewport and UA
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  );

  try {
    // Load homepage first — same as working local Selenium
    const origin = new URL(pageurl).origin;
    console.log(`[reCAPTCHA] puppeteer-stealth loading: ${origin}`);
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1000));
    console.log('[reCAPTCHA] Homepage loaded, injecting widget...');

    // Inject reCAPTCHA — same JS as local Selenium
    const token = await page.evaluate(({ sitekey, timeout }) => {
      return new Promise((resolve) => {
        function doRender() {
          const c = document.createElement('div');
          c.style.display = 'none';
          document.body.appendChild(c);
          try {
            grecaptcha.render(c, {
              sitekey, size: 'invisible',
              callback: (t) => resolve(t),
              'expired-callback': () => resolve(''),
              'error-callback': () => resolve(''),
            });
            grecaptcha.execute();
          } catch(e) { resolve(''); }
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
    return { token: null, error: e.message, elapsed: ((Date.now() - start) / 1000).toFixed(2) };
  } finally {
    await browser.close().catch(() => {});
  }
}
