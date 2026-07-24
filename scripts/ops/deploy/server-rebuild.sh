#!/usr/bin/env bash
# Run ON the production host: /yida/yidalab
# Default: cached docker compose build + up. Set NO_CACHE=1 for cold build.
set -euo pipefail

ROOT="${DEPLOY_ROOT:-/yida/yidalab}"
cd "$ROOT"

if [[ ! -f docker-compose.yml ]]; then
  echo "error: docker-compose.yml not found in $ROOT" >&2
  exit 1
fi

if [[ ! -f src/Dockerfile ]]; then
  echo "error: src/Dockerfile missing — unpack source into $ROOT/src first" >&2
  exit 1
fi

# Prefer China mirrors for on-server builds (edit compose if you must use official npm).
if grep -q 'USE_CN_MIRROR:' docker-compose.yml; then
  sed -i 's/USE_CN_MIRROR: "false"/USE_CN_MIRROR: "true"/' docker-compose.yml || true
fi

export DOCKER_BUILDKIT=1
LOG="${ROOT}/build.log"
: >"$LOG"

BUILD_ARGS=(compose build --progress=plain lobe)
if [[ "${NO_CACHE:-0}" == "1" ]]; then
  echo "NO_CACHE=1 — cold build (slow)"
  BUILD_ARGS=(compose build --progress=plain --no-cache lobe)
else
  echo "cached build (default) — reuse pnpm/deps layers when possible"
fi

echo "building... log: $LOG"
set +e
docker "${BUILD_ARGS[@]}" >>"$LOG" 2>&1
code=$?
set -e
echo "EXIT:$code" >>"$LOG"

if [[ "$code" -ne 0 ]]; then
  echo "build failed (exit $code). tail of $LOG:" >&2
  tail -40 "$LOG" >&2
  exit "$code"
fi

echo "starting lobe..."
docker compose up -d lobe
docker compose ps lobe
echo "done. app: http://$(hostname -I | awk '{print $1}'):3010/ (via nginx) or :3210 direct"
