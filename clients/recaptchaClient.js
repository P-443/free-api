// ═══════════════════════════════════════════════════════════
//  reCAPTCHA v2 Client — REAL Chrome (not Chromium)
//  Exact same approach as working local Selenium:
//  - System Chrome browser (channel: 'chrome')
//  - Persistent profile (looks like real user)
//  - about:blank page injection
//  - Full anti-detection matching undetected-chromedriver
// ═══════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROFILE_DIR = join(homedir(), '.recaptcha-chrome-profile');

export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { timeout = 60, proxy } = opts;
  const start = Date.now();

  // Ensure persistent profile directory exists
  if (!existsSync(PROFILE_DIR)) {
    mkdirSync(PROFILE_DIR, { recursive: true });
  }

  // Launch REAL Chrome (not Playwright's bundled Chromium)
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    // Use system Chrome for authentic fingerprint
    channel: 'chrome',
    headless: true,  // Xvfb handles display on Linux
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
      '--password-store=basic',
      '--use-mock-keychain',
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    // Bypass automation flags — same as Selenium undetected-chromedriver
    bypassCSP: true,
  });

  const context = browser; // launchPersistentContext returns the context directly
  const page = await context.newPage();

  // Full anti-detection matching undetected-chromedriver
  await page.addInitScript(() => {
    // Kill webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Realistic plugins (matching real Chrome)
    Object.defineProperty(navigator, 'plugins', {
      get: () => Object.assign([1,2,3,4,5], {
        item: () => null, namedItem: () => null, refresh: () => {},
      })
    });
    // Chrome runtime
    if (!window.chrome) {
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {},
      };
    }
    // Languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    // Permissions
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) =>
      params.name === 'notifications' ?
        Promise.resolve({state: Notification.permission}) :
        originalQuery(params);
    // Hardware
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  });

  try {
    // Same approach as working card_checker_auto.py:
    // Load about:blank, inject reCAPTCHA, solve
    await page.goto('about:blank');
    console.log(`[reCAPTCHA] Real Chrome ready, injecting reCAPTCHA...`);

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
