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

RUN bun --bun run build

ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["bun", "./build/index.js"]
