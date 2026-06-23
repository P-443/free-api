#!/bin/bash
# ── Free Captcha API — Start All Services ──────────────────

echo "Starting Xvfb (virtual display)..."
Xvfb :99 -screen 0 1280x900x24 &
export DISPLAY=:99
sleep 1

echo "Starting Python Turnstile Solver (nodriver) on :8191..."
cd python_solver
python3 service.py &
PY_PID=$!
cd ..

echo "Starting Node.js API + Panel on :9000..."
node main.js &
NODE_PID=$!

echo ""
echo "═════════════════════════════════════════════"
echo "  API + Panel : http://0.0.0.0:9000"
echo "  Python Solver: http://0.0.0.0:8191 (internal)"
echo "  Docs        : http://0.0.0.0:9000/docs"
echo "  Health      : http://0.0.0.0:9000/health"
echo "═════════════════════════════════════════════"
echo ""

# Wait for either process to exit
wait -n $NODE_PID $PY_PID 2>/dev/null
echo "Service stopped."
