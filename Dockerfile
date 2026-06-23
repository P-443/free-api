FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# Install Google Chrome for additional browser support
RUN apt-get update && apt-get install -y wget \
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb 2>/dev/null \
    || (dpkg -i google-chrome-stable_current_amd64.deb && apt-get install -fy) \
    && rm -f google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

COPY package.json .
RUN npm install

COPY . .

ENV PORT=9000
ENV REDIS_URL=
ENV MAX_WORKERS=1

EXPOSE 9000
CMD ["node", "main.js"]
