"""
EzSolver - Cloudflare Turnstile Solver (persistent browser)
=============================================================
Chrome stays OPEN between solves - no restart, CPU efficient.
Injects Turnstile widget into REAL page.

Usage:
  python solver.py <sitekey> <siteurl>
  python service.py  (HTTP API on port 8191)
"""
import asyncio
import json
import os
import platform
import random
import subprocess
import threading
import time
from typing import Optional
import nodriver as uc


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
    if os.environ.get("TS_PROFILE_DIR"):
        return os.environ["TS_PROFILE_DIR"]
    if platform.system() == "Windows":
        base = os.environ.get("TEMP") or os.environ.get("TMP") or r"C:\Temp"
        return os.path.join(base, "ts_profile")
    return "/tmp/ts_profile"


def _start_xvfb_if_needed() -> Optional[subprocess.Popen]:
    if platform.system() != "Linux":
        return None
    if os.environ.get("DISPLAY"):
        return None
    proc = subprocess.Popen(
        ["Xvfb", ":99", "-screen", "0", "1280x900x24"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    os.environ["DISPLAY"] = ":99"
    time.sleep(0.5)
    return proc


# ---- Persistent browser + event loop ----
_loop: asyncio.AbstractEventLoop = None
_browser = None
_lock = threading.Lock()
_ready = threading.Event()


def _run_loop():
    """Background thread: persistent asyncio event loop."""
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    _loop.run_forever()


def _init_browser():
    """Start persistent loop + browser (called once on first solve)."""
    global _loop, _browser
    with _lock:
        if _browser is not None:
            return  # already initialized

        # Start event loop in background thread
        t = threading.Thread(target=_run_loop, daemon=True)
        t.start()
        time.sleep(0.3)  # let loop start

        # Create browser in the persistent loop
        async def _create():
            return await uc.start(
                browser_executable_path=_find_chrome(),
                headless=False,
                user_data_dir=_get_profile_dir(),
            )

        future = asyncio.run_coroutine_threadsafe(_create(), _loop)
        _browser = future.result(timeout=30)
        _ready.set()
        print("[solver] Persistent browser started (stays open)")


async def _solve_page(sitekey: str, siteurl: str, timeout: int) -> str:
    """Solve Turnstile on a NEW page in the persistent browser."""
    global _browser

    page = await _browser.get(siteurl)
    await asyncio.sleep(random.uniform(1.5, 2.5))

    # Inject Turnstile widget into REAL page DOM
    await page.evaluate(f"""
        (() => {{
            if (document.getElementById('_ts_box')) return;
            window._tsToken = null;
            const wrap = document.createElement('div');
            wrap.id = '_ts_box';
            wrap.style = 'position:fixed;top:20px;left:20px;z-index:2147483647;background:white;padding:10px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
            document.body.appendChild(wrap);
            window._tsLoad = function () {{
                turnstile.render('#_ts_box', {{
                    sitekey: '{sitekey}',
                    callback: function(tk) {{ window._tsToken = tk; }}
                }});
            }};
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=_tsLoad&render=explicit';
            s.async = true;
            document.head.appendChild(s);
        }})();
    """)

    await asyncio.sleep(4.0)

    async def get_token() -> Optional[str]:
        return await page.evaluate("""
            (() => {
                if (window._tsToken) return window._tsToken;
                const inp = document.querySelector('#_ts_box [name="cf-turnstile-response"]');
                return (inp && inp.value) ? inp.value : null;
            })()
        """)

    async def get_cf_iframe_rect() -> Optional[dict]:
        raw = await page.evaluate("""
            JSON.stringify((() => {
                for (const f of document.querySelectorAll('iframe')) {
                    const src = f.src || f.getAttribute('src') || '';
                    if (!src.includes('challenges.cloudflare.com')) continue;
                    const r = f.getBoundingClientRect();
                    if (r.width > 50 && r.height > 20) return {x:r.x, y:r.y, w:r.width, h:r.height};
                }
                return null;
            })())
        """)
        if raw and raw != 'null':
            return json.loads(raw)
        return None

    async def do_click(rect: Optional[dict]):
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

    # Wait for checkbox iframe
    rect = None
    for _ in range(15):
        rect = await get_cf_iframe_rect()
        if rect:
            break
        await asyncio.sleep(0.5)

    # Click loop
    deadline = asyncio.get_event_loop().time() + timeout
    click_count = 0
    last_click = 0.0

    while asyncio.get_event_loop().time() < deadline:
        token = await get_token()
        if token:
            break

        now = asyncio.get_event_loop().time()
        if click_count == 0 or (not token and now - last_click > 6):
            if click_count >= 3:
                await asyncio.sleep(0.3)
                continue
            await do_click(rect)
            last_click = asyncio.get_event_loop().time()
            click_count += 1
            await asyncio.sleep(1.0)
            rect = await get_cf_iframe_rect() or rect
            continue

        await asyncio.sleep(0.3)

    if not token:
        raise TimeoutError(f"Turnstile token not obtained within {timeout}s")

    return token


def solve(sitekey: str, siteurl: str, timeout: int = 45) -> str:
    """Solve Turnstile. Browser stays OPEN between calls (CPU efficient)."""
    global _loop, _browser

    # Init on first call (browser opens once)
    if _browser is None:
        _init_browser()

    _ready.wait(timeout=10)

    # Submit solve to persistent event loop
    future = asyncio.run_coroutine_threadsafe(
        _solve_page(sitekey, siteurl, timeout), _loop
    )
    return future.result(timeout=timeout + 30)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python solver.py <sitekey> <siteurl>")
        sys.exit(1)
    xvfb = _start_xvfb_if_needed()
    try:
        token = solve(sys.argv[1], sys.argv[2])
        print(token)
    finally:
        if xvfb:
            xvfb.terminate()
