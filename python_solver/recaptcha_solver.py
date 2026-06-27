"""
reCAPTCHA v2 Solver — nodriver (undetected Chrome) + audio challenge
=====================================================================
Same approach as Turnstile solver that already works.
1. Navigate to real page
2. Find/inject reCAPTCHA widget
3. Click checkbox
4. If challenge → audio solve (download MP3 → speech recognition)
5. Return token

Usage:
  python recaptcha_solver.py <sitekey> <siteurl>
  curl -X POST http://127.0.0.1:8192/solve -d '{"sitekey":"...","siteurl":"..."}'
"""
import asyncio
import json
import os
import platform
import random
import subprocess
import sys
import tempfile
import threading
import time
from typing import Optional
import nodriver as uc

# Google test sitekey that works anywhere
DEFAULT_SITEKEY = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"


def _find_chrome() -> str:
    if os.environ.get("CHROME_PATH"):
        return os.environ["CHROME_PATH"]
    if platform.system() == "Windows":
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        ]
    else:
        candidates = [
            "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser", "/usr/bin/chromium",
        ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError("Chrome not found. Set CHROME_PATH env var.")


def _get_profile_dir() -> str:
    if os.environ.get("RC_PROFILE_DIR"):
        return os.environ["RC_PROFILE_DIR"]
    if platform.system() == "Windows":
        base = os.environ.get("TEMP") or os.environ.get("TMP") or r"C:\Temp"
        return os.path.join(base, "rc_profile")
    return "/tmp/rc_profile"


# ---- Persistent browser + event loop ----
_loop: asyncio.AbstractEventLoop = None
_browser = None
_lock = threading.Lock()
_ready = threading.Event()


def _run_loop():
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    _loop.run_forever()


def _init_browser():
    global _loop, _browser
    with _lock:
        if _browser is not None:
            return
        t = threading.Thread(target=_run_loop, daemon=True)
        t.start()
        time.sleep(0.3)

        async def _create():
            return await uc.start(
                browser_executable_path=_find_chrome(),
                headless=False,
                user_data_dir=_get_profile_dir(),
            )

        future = asyncio.run_coroutine_threadsafe(_create(), _loop)
        _browser = future.result(timeout=30)
        _ready.set()
        print("[recaptcha-solver] Persistent browser started")


async def _download_audio(url: str) -> bytes:
    """Download audio file from URL."""
    import urllib.request
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def _transcribe_audio(audio_data: bytes) -> Optional[str]:
    """Transcribe audio to text using speech_recognition library."""
    try:
        import speech_recognition as sr
        # Write MP3 to temp file
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
            f.write(audio_data)
            tmp_path = f.name

        recognizer = sr.Recognizer()
        with sr.AudioFile(tmp_path) as source:
            audio = recognizer.record(source)

        os.unlink(tmp_path)

        # Try Google's free API first (no key needed)
        try:
            text = recognizer.recognize_google(audio)
            return text.replace(" ", "").strip()
        except sr.UnknownValueError:
            pass
        except sr.RequestError:
            pass

        # Fallback: try Sphinx (offline)
        try:
            text = recognizer.recognize_sphinx(audio)
            return text.replace(" ", "").strip()
        except:
            pass

        return None
    except ImportError:
        print("[recaptcha-solver] speech_recognition not installed, trying whisper...")
        return None
    except Exception as e:
        print(f"[recaptcha-solver] Transcription error: {e}")
        return None


async def _solve_page(sitekey: str, siteurl: str, timeout: int) -> str:
    """Solve reCAPTCHA on a page in persistent browser."""
    global _browser

    page = await _browser.get(siteurl)
    await asyncio.sleep(random.uniform(2.0, 3.0))

    # Inject reCAPTCHA widget
    await page.evaluate(f"""
        (() => {{
            if (document.getElementById('_rc_box')) return;
            window._rcToken = null;
            const wrap = document.createElement('div');
            wrap.id = '_rc_box';
            wrap.style = 'position:fixed;top:20px;left:20px;z-index:2147483647;background:white;padding:10px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
            document.body.appendChild(wrap);
            window._rcLoad = function () {{
                grecaptcha.render('_rc_box', {{
                    sitekey: '{sitekey}',
                    callback: function(tk) {{ window._rcToken = tk; }}
                }});
            }};
            const s = document.createElement('script');
            s.src = 'https://www.google.com/recaptcha/api.js?onload=_rcLoad&render=explicit';
            s.async = true;
            document.head.appendChild(s);
        }})();
    """)

    await asyncio.sleep(4.0)

    async def get_token() -> Optional[str]:
        return await page.evaluate("""
            (() => {
                if (window._rcToken) return window._rcToken;
                const ta = document.querySelector('[name="g-recaptcha-response"]');
                return (ta && ta.value) ? ta.value : null;
            })()
        """)

    async def find_rc_iframe_rect() -> Optional[dict]:
        raw = await page.evaluate("""
            JSON.stringify((() => {
                for (const f of document.querySelectorAll('iframe')) {
                    const src = f.src || f.getAttribute('src') || '';
                    if (!src.includes('google.com/recaptcha') && !src.includes('google.com/recaptcha/api2/bframe')) continue;
                    const r = f.getBoundingClientRect();
                    if (r.width > 50 && r.height > 20) return {x:r.x, y:r.y, w:r.width, h:r.height};
                }
                return null;
            })())
        """)
        if raw and raw != 'null':
            return json.loads(raw)
        return None

    async def click_at(rect: Optional[dict]):
        if rect:
            cx = rect["x"] + 28 + random.uniform(-3, 3)
            cy = rect["y"] + rect["h"] / 2 + random.uniform(-3, 3)
        else:
            cx = 20 + 28 + random.uniform(-3, 3)
            cy = 20 + 32 + random.uniform(-3, 3)
        await page.mouse_move(cx - 80, cy - 20)
        await asyncio.sleep(random.uniform(0.10, 0.20))
        await page.mouse_move(cx, cy)
        await asyncio.sleep(random.uniform(0.05, 0.10))
        await page.mouse_click(cx, cy)

    # Check auto-solve
    token = await get_token()
    if token:
        return token

    # Find checkbox iframe and click
    rect = None
    for _ in range(12):
        rect = await find_rc_iframe_rect()
        if rect:
            break
        token = await get_token()
        if token:
            return token
        await asyncio.sleep(0.5)

    if rect:
        await click_at(rect)
        print("[recaptcha-solver] Checkbox clicked")
        await asyncio.sleep(3.0)
    else:
        raise Exception("reCAPTCHA widget did not load")

    # Check if passed without challenge
    token = await get_token()
    if token:
        print(f"[recaptcha-solver] Passed without challenge!")
        return token

    # Challenge appeared — try audio solve
    print("[recaptcha-solver] Challenge detected, trying audio...")

    # Find bframe (challenge iframe)
    for _ in range(8):
        rect = await find_rc_iframe_rect()
        if rect:
            break
        await asyncio.sleep(0.5)

    # Click audio button via JavaScript
    audio_url = await page.evaluate("""
        (() => {
            // Find the bframe
            for (const f of document.querySelectorAll('iframe')) {
                const src = f.src || '';
                if (!src.includes('bframe')) continue;
                try {
                    const doc = f.contentDocument || f.contentWindow.document;
                    if (!doc) continue;
                    // Click audio button
                    const audioBtn = doc.getElementById('recaptcha-audio-button');
                    if (audioBtn) {
                        audioBtn.click();
                        // Wait a bit then get audio URL
                        return 'clicked';
                    }
                } catch(e) {}
            }
            return null;
        })()
    """)

    if audio_url:
        await asyncio.sleep(2.5)

        # Get audio download URL
        audio_dl_url = await page.evaluate("""
            (() => {
                for (const f of document.querySelectorAll('iframe')) {
                    const src = f.src || '';
                    if (!src.includes('bframe')) continue;
                    try {
                        const doc = f.contentDocument || f.contentWindow.document;
                        if (!doc) continue;
                        const link = doc.querySelector('.rc-audiochallenge-tdownload-link');
                        if (link) return link.href || link.getAttribute('href');
                    } catch(e) {}
                }
                return null;
            })()
        """)

        if audio_dl_url:
            print(f"[recaptcha-solver] Audio URL: {audio_dl_url[:80]}...")
            try:
                audio_data = await asyncio.get_event_loop().run_in_executor(
                    None, _download_audio, audio_dl_url
                )
                print(f"[recaptcha-solver] Audio downloaded: {len(audio_data)} bytes")

                answer = await asyncio.get_event_loop().run_in_executor(
                    None, _transcribe_audio, audio_data
                )
                print(f"[recaptcha-solver] Transcription: {answer}")

                if answer:
                    # Type answer and verify
                    await page.evaluate(f"""
                        (() => {{
                            for (const f of document.querySelectorAll('iframe')) {{
                                const src = f.src || '';
                                if (!src.includes('bframe')) continue;
                                try {{
                                    const doc = f.contentDocument || f.contentWindow.document;
                                    if (!doc) continue;
                                    const inp = doc.getElementById('audio-response');
                                    if (inp) {{
                                        inp.value = '{answer}';
                                        const vbtn = doc.getElementById('recaptcha-verify-button');
                                        if (vbtn) vbtn.click();
                                    }}
                                }} catch(e) {{}}
                            }}
                        }})()
                    """)
                    await asyncio.sleep(3.0)

                    token = await get_token()
                    if token:
                        print(f"[recaptcha-solver] Audio solve SUCCESS! len={len(token)}")
                        return token
            except Exception as e:
                print(f"[recaptcha-solver] Audio error: {e}")

    # Final check
    token = await get_token()
    if token:
        return token

    raise TimeoutError(f"reCAPTCHA token not obtained within {timeout}s")


def solve(sitekey: str, siteurl: str, timeout: int = 60) -> str:
    """Solve reCAPTCHA v2. Browser stays OPEN between calls."""
    global _loop, _browser

    if _browser is None:
        _init_browser()

    _ready.wait(timeout=10)

    future = asyncio.run_coroutine_threadsafe(
        _solve_page(sitekey, siteurl, timeout), _loop
    )
    return future.result(timeout=timeout + 45)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: python recaptcha_solver.py <sitekey> <siteurl> [timeout]")
        print(f"Example: python recaptcha_solver.py {DEFAULT_SITEKEY} https://example.com/")
        sys.exit(1)

    sk = sys.argv[1]
    su = sys.argv[2]
    to = int(sys.argv[3]) if len(sys.argv) > 3 else 60

    print(f"Solving reCAPTCHA: sitekey={sk[:20]}... url={su}")
    try:
        token = solve(sk, su, to)
        print(token)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
