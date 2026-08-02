#!/usr/bin/env bash
# FALLBACK ONLY: build on the production host (slow, 15–45 min).
# Daily path: git push → GitHub Actions "YidaLab Production Image" (build on GHCR + SSH deploy).
#
# Requires: CONFIRM_SERVER_BUILD=1
# Optional: NO_CACHE=1 for cold build
set -euo pipefail

if [[ "${CONFIRM_SERVER_BUILD:-0}" != "1" ]]; then
  cat >&2 <<'EOF'
Refusing server-side docker build.

Daily deploy (recommended):
  git push origin main   # or codex/yidalab-custom
  # → Actions builds linux/amd64 → streams image to this host → restarts lobe
  # No compile on the server. Watch: https://github.com/feiqin8311/yidalab/actions

Manual re-deploy existing GHCR tag:
  TAG=prod ./server-pull-image.sh

Emergency build on this host (slow):
  CONFIRM_SERVER_BUILD=1 ./server-rebuild.sh
EOF
  exit 2
fi

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

if ! grep -qE '^\s*build:' docker-compose.yml; then
  cat >&2 <<'EOF'
error: docker-compose.yml has image-only lobe service (no build:).
Server build is disabled by design. Use CI deploy or server-pull-image.sh.
EOF
  exit 1
fi

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
  echo "cached build — reuse layers when possible"
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
docker compose up -d --force-recreate lobe
docker compose ps lobe
echo "done. app: http://$(hostname -I | awk '{print $1}'):3010/ (via nginx) or :3210 direct"
