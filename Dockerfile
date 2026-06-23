FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# ── System deps + Python + Xvfb + Chromium ────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip xvfb wget curl \
    libvulkan1 xdg-utils libu2f-udev libasound2 \
    && rm -rf /var/lib/apt/lists/*

# ── Install Google Chrome ─────────────────────────────────────
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && dpkg -i google-chrome-stable_current_amd64.deb 2>/dev/null || true \
    && apt-get update && apt-get install -fy --no-install-recommends \
    && rm -f google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# ── Python nodriver solver ───────────────────────────────────
COPY python_solver/requirements.txt ./python_solver/
RUN pip install -r python_solver/requirements.txt
COPY python_solver/ ./python_solver/

# ── Node.js deps ─────────────────────────────────────────────
COPY package.json .
RUN npm install

# ── App source ───────────────────────────────────────────────
COPY . .

# ── Ports ────────────────────────────────────────────────────
EXPOSE 9000 8191

# ── main.js auto-starts Xvfb + Python solver + Node.js API ──
CMD ["node", "main.js"]
