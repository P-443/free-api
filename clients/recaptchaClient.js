// ═══════════════════════════════════════════════════════════════
//  reCAPTCHA v2 Client — Playwright-based Audio/Invisible Solver
//  Same browser session: injects reCAPTCHA → solves → returns token
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';

/**
 * Solve reCAPTCHA v2 (invisible or checkbox) using Playwright
 * @param {string} sitekey - Google reCAPTCHA site key
 * @param {string} pageurl - URL where the captcha appears
 * @param {object} opts - Optional config
 * @returns {{ token: string, elapsed: number }}
 */
export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { timeout = 60, headless = true, proxy, cookies, sessionUrl } = opts;

  const launchOpts = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  };
  if (proxy) {
    // Parse proxy URL: http://user:pass@host:port → Playwright format
    try {
      const url = new URL(proxy);
      launchOpts.proxy = {
        server: `${url.protocol}//${url.hostname}:${url.port || '80'}`,
        username: decodeURIComponent(url.username || ''),
        password: decodeURIComponent(url.password || ''),
      };
      console.log(`[reCAPTCHA] Using proxy: ${url.hostname}:${url.port}`);
    } catch(e) {
      // Fallback: try as-is
      launchOpts.proxy = { server: proxy };
    }
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  // Anti-detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  // CRITICAL: Set cookies BEFORE any navigation so browser session matches Python session
  if (cookies && sessionUrl) {
    try {
      const cookieList = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
      const domain = new URL(sessionUrl).hostname;
      const cookieArray = Object.entries(cookieList).map(([name, value]) => ({
        name, value: String(value), domain, path: '/',
        httpOnly: false, secure: true, sameSite: 'Lax',
      }));
      await context.addCookies(cookieArray);
      console.log(`[reCAPTCHA] Set ${cookieArray.length} cookies for ${domain}`);
    } catch(e) {
      console.log(`[reCAPTCHA] Cookie set error: ${e.message}`);
    }
  }

  const page = await context.newPage();
  const start = Date.now();

  try {
    // Step 1: Load login page with session token using our cookies
    if (sessionUrl) {
      console.log(`[reCAPTCHA] Loading session with cookies...`);
      await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      console.log('[reCAPTCHA] Session page loaded');
    }

    // Step 2: Navigate to checkout at correct URL
    console.log(`[reCAPTCHA] Loading checkout...`);
    await page.goto(pageurl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log('[reCAPTCHA] Checkout page loaded');

    // Inject reCAPTCHA API + render widget + get token
    const token = await page.evaluate((sk) => {
      return new Promise((resolve) => {
        function doRender() {
          const container = document.createElement('div');
          container.id = '_recap_' + Math.random().toString(36).slice(2);
          document.body.appendChild(container);

          window.__recapCallback = function(t) { resolve(t); };
          window.__recapExpired = function() { resolve(''); };

          grecaptcha.render(container.id, {
            sitekey: sk,
            size: 'invisible',
            callback: '__recapCallback',
            'expired-callback': '__recapExpired',
            'error-callback': '__recapExpired',
          });
          grecaptcha.execute();
        }

        if (typeof grecaptcha !== 'undefined' && grecaptcha.render) {
          doRender();
        } else {
          const script = document.createElement('script');
          script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
          script.onload = () => grecaptcha.ready(doRender);
          script.onerror = () => resolve('');
          document.head.appendChild(script);
        }

        // Timeout fallback
        setTimeout(() => resolve(''), 50000);
      });
    }, sitekey);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (!token) {
      return { token: null, error: 'captcha_timeout', elapsed };
    }

    return { token, elapsed };
  } catch (e) {
    return { token: null, error: e.message, elapsed: ((Date.now() - start) / 1000).toFixed(1) };
  } finally {
    await browser.close();
  }
}

/**
 * Solve reCAPTCHA v2 audio challenge via Playwright
 * Full browser interaction: checkbox → audio button → download → speech-to-text → submit
 */
export async function solveReCaptchaAudio(sitekey, pageurl, opts = {}) {
  const { timeout = 90, headless = false, proxy } = opts;

  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  const start = Date.now();

  try {
    await page.goto(pageurl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Inject reCAPTCHA API
    await page.evaluate((sk) => {
      return new Promise((res) => {
        const s = document.createElement('script');
        s.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
        s.onload = () => {
          grecaptcha.ready(() => {
            const div = document.createElement('div');
            div.id = '_audio_recap';
            document.body.appendChild(div);
            grecaptcha.render('_audio_recap', {
              sitekey: sk,
              size: 'normal', // Use normal (checkbox) size for audio challenge
              callback: (t) => { window.__audioToken = t; },
            });
            res();
          });
        };
        document.head.appendChild(s);
      });
    }, sitekey);

    await page.waitForTimeout(3000);

    // Click on the reCAPTCHA iframe checkbox
    const frameElement = await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 10000 });
    const frame = await frameElement.contentFrame();
    await frame.click('.recaptcha-checkbox-border');
    await page.waitForTimeout(2000);

    // Switch to challenge frame
    const bframe = await page.waitForSelector('iframe[src*="bframe"]', { timeout: 10000 });
    const challengeFrame = await bframe.contentFrame();

    // Click audio button
    await challengeFrame.click('#recaptcha-audio-button');
    await page.waitForTimeout(2000);

    // Get audio download URL
    const audioUrl = await challengeFrame.evaluate(() => {
      const link = document.querySelector('.rc-audiochallenge-tdownload-link');
      return link ? link.getAttribute('href') : null;
    });

    if (!audioUrl) {
      return { token: null, error: 'no_audio_url', elapsed: ((Date.now() - start) / 1000).toFixed(1) };
    }

    // Download audio
    const audioResp = await page.request.get(audioUrl);
    const audioBuffer = await audioResp.body();

    // Write to temp file for speech recognition
    const { writeFileSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');

    const tmpMp3 = join(tmpdir(), `recap_${Date.now()}.mp3`);
    writeFileSync(tmpMp3, audioBuffer);

    // Transcribe using system speech recognition
    let text = '';
    try {
      // Try using system speech recognition
      const { execSync } = await import('child_process');
      // Convert mp3 to wav using ffmpeg
      const tmpWav = tmpMp3.replace('.mp3', '.wav');
      execSync(`ffmpeg -i "${tmpMp3}" -ar 16000 -ac 1 "${tmpWav}" -y 2>nul`);
      // Use whisper if available, otherwise manual
      text = execSync(`whisper "${tmpWav}" --model tiny --language en --output_format txt 2>nul`).toString();
      unlinkSync(tmpWav);
    } catch (e) {
      // Manual fallback
      text = '';
    }
    unlinkSync(tmpMp3);

    if (!text) {
      return { token: null, error: 'speech_recognition_failed', elapsed: ((Date.now() - start) / 1000).toFixed(1) };
    }

    // Enter text and verify
    text = text.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    await challengeFrame.fill('#audio-response', text);
    await challengeFrame.click('#recaptcha-verify-button');
    await page.waitForTimeout(3000);

    // Get token
    const token = await page.evaluate(() => window.__audioToken || '');

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return { token: token || null, error: token ? null : 'token_missing', elapsed };
  } catch (e) {
    return { token: null, error: e.message, elapsed: ((Date.now() - start) / 1000).toFixed(1) };
  } finally {
    await browser.close();
  }
}
