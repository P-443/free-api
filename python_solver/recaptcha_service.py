"""reCAPTCHA solver HTTP service — nodriver + audio challenge."""
import json
import os
import sys
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Semaphore

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recaptcha_solver import solve

PORT = int(os.environ.get("RC_PORT", "8192"))
MAX_WORKERS = int(os.environ.get("RC_WORKERS", "2"))
_sem = Semaphore(MAX_WORKERS)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok", "workers": MAX_WORKERS, "active": MAX_WORKERS - _sem._value})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/solve":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length)) if length else {}
            except:
                return self._json({"error": "invalid json"}, 400)

            sitekey = body.get("sitekey")
            siteurl = body.get("siteurl")
            timeout = body.get("timeout", 60)

            if not sitekey or not siteurl:
                return self._json({"error": "sitekey and siteurl required"}, 400)

            if not _sem.acquire(blocking=False):
                return self._json({"error": "all workers busy"}, 503)

            try:
                print(f"[rc-service] Solving {sitekey[:20]}...")
                token = solve(sitekey, siteurl, timeout)
                print(f"[rc-service] Solved! len={len(token)}")
                self._json({"status": "success", "token": token})
            except Exception as e:
                print(f"[rc-service] Error: {e}")
                self._json({"status": "error", "detail": str(e)})
            finally:
                _sem.release()
        else:
            self._json({"error": "not found"}, 404)

    def _json(self, data, code=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # silent

if __name__ == "__main__":
    print(f"[rc-service] reCAPTCHA solver on :{PORT} (workers={MAX_WORKERS})")
    srv = HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()
