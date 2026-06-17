FROM ubuntu:24.04

WORKDIR /app

# Install Bun runtime on top of Playwright image.
RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates \
	curl \
	unzip \
	&& rm -rf /var/lib/apt/lists/* \
	&& curl -fsSL https://bun.sh/install | bash \
	&& ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
	&& ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

# Install dependencies first (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

# Install Chromium and required OS packages via Playwright helper.
RUN bunx playwright install chromium --with-deps

# Copy application source
COPY src/ ./src/

ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["bun", "run", "src/server.js"]
