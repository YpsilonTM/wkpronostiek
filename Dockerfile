FROM oven/bun:1-debian

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install Playwright Chromium + system dependencies
RUN bunx playwright install chromium --with-deps

# Copy application source
COPY src/ ./src/

EXPOSE 3000

CMD ["bun", "run", "src/server.js"]
