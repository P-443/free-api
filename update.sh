#!/bin/bash
# Auto-update script for Free Captcha API server
# Pulls latest from 're' branch and restarts

cd "$(dirname "$0")"
echo "[Update] Pulling latest from re branch..."
git checkout re
git pull origin re
echo "[Update] Installing dependencies..."
npm install --no-audit 2>/dev/null
cd python_solver && pip install -r requirements.txt 2>/dev/null && cd ..
echo "[Update] Restarting service..."
pm2 restart free-captcha-api 2>/dev/null || pm2 start main.js --name free-captcha-api
echo "[Update] Done! API running on :9000"
pm2 status
