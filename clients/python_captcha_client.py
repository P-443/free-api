#!/usr/bin/env python3
"""
Free Captcha API Client — hc.ar-senik.pro + local fallback
===========================================================
Supports: reCAPTCHA v2, hCaptcha, Cloudflare Turnstile

Usage:
  from captcha_api_client import CaptchaAPI
  api = CaptchaAPI(server="https://hc.ar-senik.pro")  # or "http://127.0.0.1:9000"
  token = api.solve_recaptcha(sitekey="...", siteurl="...")
"""

import requests
import time
import json
from typing import Optional


class CaptchaAPI:
    """Unified captcha solving client for Free Captcha API."""

    def __init__(self, server: str = "https://hc.ar-senik.pro",
                 timeout: int = 90, verbose: bool = True):
        self.server = server.rstrip("/")
        self.timeout = timeout
        self.verbose = verbose

    def _log(self, msg):
        if self.verbose: print(msg)

    def _post(self, endpoint: str, payload: dict) -> Optional[dict]:
        """Call API endpoint with retry logic."""
        url = f"{self.server}{endpoint}"
        self._log(f"  [*] {url} -> {json.dumps(payload)[:80]}...")

        t0 = time.time()
        try:
            r = requests.post(url, json=payload, timeout=self.timeout + 30)
            elapsed = time.time() - t0
            data = r.json()
            self._log(f"  [{r.status_code}] {data.get('status','?')} ({elapsed:.1f}s)")
            return data
        except requests.Timeout:
            self._log(f"  [!] Timeout after {self.timeout+30}s")
            return {"status": "error", "detail": "timeout"}
        except Exception as e:
            self._log(f"  [!] Error: {e}")
            return {"status": "error", "detail": str(e)}

    # ── reCAPTCHA v2 ───────────────────────────────────

    def solve_recaptcha(self, sitekey: str, siteurl: str,
                        headless: bool = True, proxy: str = None) -> Optional[str]:
        """
        Solve reCAPTCHA v2 (invisible/checkbox).
        Returns token string or None.
        """
        payload = {"sitekey": sitekey, "siteurl": siteurl, "headless": headless}
        if proxy: payload["proxy"] = proxy

        self._log(f"[reCAPTCHA] Solving {sitekey[:20]}...")
        result = self._post("/solve/recaptcha", payload)

        if result and result.get("status") == "success":
            token = result.get("token")
            self._log(f"  [+] Token: {token[:30] if token else 'MISSING'}...")
            return token
        else:
            err = (result or {}).get("detail", "unknown")
            self._log(f"  [!] reCAPTCHA failed: {err}")
            return None

    # ── hCaptcha ───────────────────────────────────────

    def solve_hcaptcha(self, sitekey: str, siteurl: str,
                       proxy: str = None) -> Optional[str]:
        """
        Solve hCaptcha.
        Returns token string or None.
        """
        payload = {"sitekey": sitekey, "siteurl": siteurl}
        if proxy: payload["proxy"] = proxy

        self._log(f"[hCaptcha] Solving {sitekey[:20]}...")
        result = self._post("/solve/hcaptcha", payload)

        if result and result.get("status") == "success":
            return result.get("token")
        return None

    # ── Cloudflare Turnstile ───────────────────────────

    def solve_turnstile(self, sitekey: str, siteurl: str,
                        timeout: int = 45) -> Optional[str]:
        """
        Solve Cloudflare Turnstile.
        Returns token string or None.
        """
        payload = {"sitekey": sitekey, "siteurl": siteurl, "timeout": timeout}

        self._log(f"[Turnstile] Solving {sitekey[:20]}...")
        result = self._post("/solve/turnstile", payload)

        if result and result.get("status") == "success":
            return result.get("token")
        return None

    # ── Health / Stats ─────────────────────────────────

    def health(self) -> dict:
        """Check API health."""
        try:
            r = requests.get(f"{self.server}/health?json=1", timeout=10)
            return r.json()
        except:
            return {"status": "error"}

    def stats(self) -> dict:
        """Get server solve stats."""
        try:
            r = requests.get(f"{self.server}/stats", timeout=10)
            return r.json()
        except:
            return {"totalSolved": 0}


# ═══════════════════════════════════════════════════════
#  CLI test
# ═══════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=" * 55)
    print("  Free Captcha API Client — Test")
    print("=" * 55)
    print()

    # Test local server first, then remote
    for server in ["http://127.0.0.1:9000", "https://hc.ar-senik.pro"]:
        print(f"Testing: {server}")
        api = CaptchaAPI(server=server, verbose=True)

        h = api.health()
        print(f"  Health: {h}")
        if h.get("status") != "ok":
            print(f"  -> Server not available, trying next...")
            continue
        break
    else:
        print("[!] No server available")
