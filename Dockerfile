# Kalayaan Stewardship, for a cloud server. See CLOUD.md.
#
# Node, plus a headless Chromium for reading LCR — installed by the same
# Playwright version the app uses, so the two always match.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY . .

# CLOUD: no screen, so LCR sign-in happens inside the app.
# DATA_DIR: reports, prefs and the LCR session live on the persistent
#   volume, which survives every redeploy; the container's own disk does not.
ENV CLOUD=1 NO_OPEN=1 DATA_DIR=/data PORT=8080 HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
