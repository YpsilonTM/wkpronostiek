FROM ubuntu:24.04

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates \
	curl \
	unzip \
	nodejs \
	npm \
	&& rm -rf /var/lib/apt/lists/* \
	&& curl -fsSL https://bun.sh/install | bash \
	&& ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
	&& ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

RUN bunx playwright install chromium --with-deps

COPY . .

RUN chmod +x scripts/docker-entrypoint.sh

RUN bun --bun run build

ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 3000

# Mount a volume here so wkpronostiek.db and legacy files survive container rebuilds.
VOLUME ["/app/data"]

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
