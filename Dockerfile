# Keep this tag and package.json's Playwright version identical.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY lib ./lib
COPY worker.mjs ./worker.mjs

# Browser artifacts and intermediate media live in a private temporary directory.
# No credentials are accepted as Docker build arguments or copied into the image.
USER pwuser
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "worker.mjs", "--once"]
