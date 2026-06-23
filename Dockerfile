FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# ── System deps + Python + Xvfb + Chrome ─────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip xvfb wget curl \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome (for nodriver)
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb 2>/dev/null \
    || (dpkg -i google-chrome-stable_current_amd64.deb && apt-get install -fy) \
    && rm -f google-chrome-stable_current_amd64.deb

# ── Python nodriver solver ───────────────────────────────────
COPY python_solver/requirements.txt ./python_solver/
RUN pip install -r python_solver/requirements.txt --break-system-packages
COPY python_solver/ ./python_solver/

# ── Node.js ──────────────────────────────────────────────────
COPY package.json .
RUN npm install
COPY . .

# ── Ports: 9000 (Node.js API), 8191 (Python solver) ─────────
EXPOSE 9000 8191

# ── Start both services ──────────────────────────────────────
CMD Xvfb :99 -screen 0 1280x900x24 & \
    export DISPLAY=:99 && \
    cd /app/python_solver && python3 service.py & \
    cd /app && node main.js
