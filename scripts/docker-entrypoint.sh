#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
export DATA_DIR

if [ -z "${DATABASE_URL:-}" ]; then
	export DATABASE_URL="file:${DATA_DIR}/wkpronostiek.db"
fi

mkdir -p "$DATA_DIR"

# Schema migrations (legacy JSONL/auth import runs in SvelteKit server init)
bunx --bun prisma migrate deploy

exec bun ./build/index.js
