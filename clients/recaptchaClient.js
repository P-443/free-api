// ═══════════════════════════════════════════════════════════════
//  Google reCAPTCHA v2 Solver — Audio challenge + checkbox
//  Clicks checkbox → if challenge appears → solves audio CAPTCHA
// ═══════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import { CHROME_PATH } from '../config/index.js';
import https from 'https';
import http from 'http';

const BROWSER_ARGS = [
  '--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  '--disable-software-rasterizer','--disable-background-networking',
  '--disable-background-timer-throttling','--disable-sync',
  '--disable-breakpad','--disable-crash-reporter','--no-crash-upload',
  '--disable-client-side-phishing-detection','--disable-component-update',
  '--disable-field-trial-config','--metrics-recording-only',
  '--disable-extensions','--disable-default-apps',
  '--disable-blink-features=AutomationControlled',
  '--renderer-process-limit=1','--no-pings',
  '--js-flags=--max-old-space-size=256','--log-level=3','--silent',
];

// ═══════════════ Persistent browser ═══════════════
let sharedBrowser = null;
let solveCount = 0;

async function getBrowser(headless = true) {
  if (sharedBrowser && (solveCount >= 60 || !sharedBrowser.isConnected())) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null; solveCount = 0;
  }
  if (!sharedBrowser) {
    console.log(`[reCAPTCHA] Launching Chrome (headless=${headless})...`);
    sharedBrowser = await chromium.launch({
      headless,
      args: [
        ...BROWSER_ARGS,
        ...(process.platform === 'linux' && !headless ? ['--display=:99'] : []),
        ...(headless ? ['--headless=new'] : []),
      ],
    });
    solveCount = 0;
  }
  solveCount++;
  return sharedBrowser;
}

async function createContext(browser, proxy) {
  const opts = {
    viewport: { width: 1366 + Math.floor(Math.random()*500), height: 768 + Math.floor(Math.random()*200) },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    locale: 'en-US', timezoneId: 'America/New_York',
  };
  if (proxy) opts.proxy = proxy;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
  `);
  return ctx;
}

// ═══════════════ Audio download & transcribe ═══════════════
async function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function transcribeAudio(audioBuffer) {
  // Try free Google Speech API (no key needed for short audio)
  try {
    const response = await fetch('https://www.google.com/speech-api/v2/recognize?output=json&lang=en-us&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/l16; rate=44100' },
      body: audioBuffer,
    });
    const text = await response.text();
    // Parse Google Speech response
    const match = text.match(/"transcript":"([^"]+)"/);
    if (match) return match[1].replace(/\s/g, '');
  } catch(e) {
    console.log('[audio] Google Speech failed:', e.message);
  }
  return null;
}

// ═══════════════ Core solve ═══════════════
async function solveOneAttempt(ctx, sitekey, siteurl) {
  const page = await ctx.newPage();
  try {
    console.log(`[reCAPTCHA] Loading: ${siteurl.slice(0, 60)}...`);
    await page.goto(siteurl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));

    // Inject widget if not found
    let widgetFound = false;
    for (let i = 0; i < 10; i++) {
      const iframe = await page.$('iframe[src*="google.com/recaptcha"]');
      if (iframe) { widgetFound = true; break; }
      if (i === 3) {
        await page.evaluate(k => {
          if (!document.querySelector('.g-recaptcha')) {
            const d = document.createElement('div');
            d.className = 'g-recaptcha';
            d.setAttribute('data-sitekey', k);
            d.setAttribute('data-callback', 'rcCb');
            window.rcCb = t => { window.__RC__ = t; };
            document.body.appendChild(d);
            const s = document.createElement('script');
            s.src = 'https://www.google.com/recaptcha/api.js';
            document.head.appendChild(s);
          }
        }, sitekey);
        await new Promise(r => setTimeout(r, 3500));
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // Find iframe
    const iframe = await page.$('iframe[src*="google.com/recaptcha"]');
    if (!iframe) {
      const token = await page.evaluate(() => window.__RC__ || null);
      await page.close();
      return token;
    }

    const mainFrame = await iframe.contentFrame();
    if (!mainFrame) { await page.close(); return null; }

    // Click checkbox
    try {
      const anchor = await mainFrame.waitForSelector('#recaptcha-anchor', { timeout: 5000 });
      if (anchor) {
        const bb = await anchor.boundingBox();
        if (bb) {
          await page.mouse.click(bb.x + bb.width/2, bb.y + bb.height/2);
          console.log('[reCAPTCHA] Checkbox clicked');
        }
      }
    } catch(e) {
      console.log('[reCAPTCHA] Checkbox click failed:', e.message.slice(0, 40));
    }

    await new Promise(r => setTimeout(r, 3000));

    // Check if passed without challenge
    let token = await page.evaluate(() => {
      if (window.__RC__) return window.__RC__;
      const ta = document.querySelector('[name="g-recaptcha-response"]');
      return ta?.value || null;
    });
    if (token) { console.log('[reCAPTCHA] Passed without challenge!'); await page.close(); return token; }

    // Wait a bit more for auto-solve (some sites trigger invisible recaptcha)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 2000));
      token = await page.evaluate(() => {
        if (window.__RC__) return window.__RC__;
        const ta = document.querySelector('[name="g-recaptcha-response"]');
        return ta?.value || null;
      });
      if (token) { console.log('[reCAPTCHA] Auto-solved after wait'); await page.close(); return token; }
    }

    // Challenge appeared — try audio solve
    console.log('[reCAPTCHA] Challenge detected, trying audio solve...');

    // Debug: log all iframes to understand page structure
    const allIframes = await page.evaluate(() =>
      [...document.querySelectorAll('iframe')].map(f => ({ src: (f.src||'').slice(0,80), id: f.id, cls: f.className }))
    );
    console.log('[reCAPTCHA] Page iframes:', JSON.stringify(allIframes));

    const bframe = await page.$('iframe[src*="bframe"]');
    if (!bframe) {
      // Try alternative selectors
      const altBframe = await page.$('iframe[src*="api2/bframe"], iframe[src*="api2/anchor"], iframe[title*="challenge"]');
      console.log('[reCAPTCHA] Alternative bframe found:', !!altBframe);
      if (altBframe) {
        // Try the alternative
        const altF = await altBframe.contentFrame();
        if (altF) {
          console.log('[reCAPTCHA] Using alternative challenge frame');
          // Try audio in this frame
          try {
            const audioBtn = await altF.waitForSelector('#recaptcha-audio-button, button[title*="audio"]', { timeout: 3000 });
            if (audioBtn) { await audioBtn.click(); console.log('[reCAPTCHA] Audio clicked in alt frame'); await new Promise(r => setTimeout(r, 2000)); }
          } catch(e) {}
        }
      }

      // No bframe — maybe still loading. Wait more.
      console.log('[reCAPTCHA] No bframe, waiting more...');
      for (let i = 0; i < 4; i++) {
        await new Promise(r => setTimeout(r, 3000));
        token = await page.evaluate(() => {
          if (window.__RC__) return window.__RC__;
          const ta = document.querySelector('[name="g-recaptcha-response"]');
          return ta?.value || null;
        });
        if (token) { console.log('[reCAPTCHA] Token appeared after wait'); await page.close(); return token; }
      }
      await page.close();
      return null;
    }

    const bf = await bframe.contentFrame();
    if (!bf) { await page.close(); return null; }

    // Click audio button
    try {
      const audioBtn = await bf.waitForSelector('#recaptcha-audio-button', { timeout: 4000 });
      if (audioBtn) {
        // Intercept payload endpoint to capture audio data DIRECTLY
        let audioPayload = null;
        await page.route('**/recaptcha/api2/payload**', async (route) => {
          const resp = await route.fetch();
          audioPayload = await resp.body();
          await route.fulfill({ response: resp });
        });

        await audioBtn.click();
        console.log('[reCAPTCHA] Audio mode activated');
        // Wait for audio to load via /api2/payload
        for (let i = 0; i < 5 && !audioPayload; i++) {
          await new Promise(r => setTimeout(r, 2000));
        }
        await page.unroute('**/recaptcha/api2/payload**').catch(() => {});

        console.log(`[reCAPTCHA] Payload captured: ${audioPayload?.length || 0} bytes`);
        let audioBuf = audioPayload;

        // Fallback: try DOM download link if payload not captured
        if (!audioBuf || audioBuf.length < 100) {
          const audioUrl = await bf.evaluate(() => {
            for (const sel of ['#audio-source', '.rc-audiochallenge-tdownload-link', 'a[href*="audio"]']) {
              const el = document.querySelector(sel);
              if (el) return el.src || el.href || el.getAttribute('src') || null;
            }
            return null;
          });
          if (audioUrl) { try { audioBuf = await downloadAudio(audioUrl); } catch(e) {} }
        }

        let answer = null;
        if (audioBuf && audioBuf.length > 100) {
          answer = await transcribeAudio(audioBuf);
          console.log(`[reCAPTCHA] Transcription: "${answer}"`);
        }

        if (answer && answer.length > 0) {
          const input = await bf.$('#audio-response');
          if (input) {
            await input.click({ clickCount: 3 });
            await input.type(answer, { delay: 80 });
            await new Promise(r => setTimeout(r, 500));
            const verifyBtn = await bf.$('#recaptcha-verify-button');
            if (verifyBtn) { await verifyBtn.click(); await new Promise(r => setTimeout(r, 4000)); }
          }
        }
      }
    } catch(e) {
      console.log('[reCAPTCHA] Audio solve error:', e.message.slice(0, 80));
    }

    // Final token check — wait longer
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2000));
      token = await page.evaluate(() => {
        if (window.__RC__) return window.__RC__;
        const ta = document.querySelector('[name="g-recaptcha-response"]');
        return ta?.value || null;
      });
      if (token) {
        console.log(`[reCAPTCHA] Token: len=${token.length}`);
        await page.close();
        return token;
      }
    }

    await page.close();
    return null;
  } catch(e) {
    console.log('[reCAPTCHA] Error:', e.message.slice(0, 60));
    await page.close().catch(() => {});
    return null;
  }
}

// ═══════════════ Public API ═══════════════
export async function solveReCaptcha(sitekey, pageurl, opts = {}) {
  const { proxy, headless = true, maxAttempts = 2 } = opts;
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

  // Multiple attempts
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let token = null;
    try {
      const browser = await getBrowser(headless);
      const ctx = await createContext(browser, proxyConfig || null);
      token = await solveOneAttempt(ctx, sitekey, pageurl);
      await ctx.close();
    } catch(e) {
      console.log(`[reCAPTCHA] Attempt ${attempt + 1} error:`, e.message.slice(0, 80));
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    if (token && token.length > 20) {
      const quality = token.length > 1500 ? 'high' : 'standard';
      console.log(`[reCAPTCHA] SOLVED q=${quality} len=${token.length} ${elapsed}s (attempt ${attempt + 1})`);
      return { token, elapsed, quality };
    }

    if (attempt < maxAttempts - 1) {
      console.log(`[reCAPTCHA] Retrying (${attempt + 1}/${maxAttempts})...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[reCAPTCHA] All ${maxAttempts} attempts failed — no_token`);
  return { token: null, error: 'no_token', elapsed };
}

export async function shutdownRecaptcha() {
  if (sharedBrowser) { await sharedBrowser.close().catch(() => {}); sharedBrowser = null; }
}
