#!/usr/bin/env bash
# From developer machine: pack git HEAD → upload → server cached rebuild + up.
# Env:
#   DEPLOY_HOST   default root@116.205.229.31
#   DEPLOY_ROOT   default /yida/yidalab
#   SSHPASS       if set, uses sshpass -e
#   NO_CACHE=1    cold build on server
#   SKIP_BUILD=1  only upload src, do not build
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

DEPLOY_HOST="${DEPLOY_HOST:-root@116.205.229.31}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/yida/yidalab}"
REV="$(git rev-parse --short HEAD)"
TGZ="/tmp/yidalab-src-${REV}.tgz"

ssh_cmd() {
  if [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no "$@"
  else
    ssh -o StrictHostKeyChecking=no "$@"
  fi
}

scp_cmd() {
  if [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no "$@"
  else
    scp -o StrictHostKeyChecking=no "$@"
  fi
}

echo "archive $REV → $TGZ"
git archive --format=tar.gz HEAD -o "$TGZ"
ls -lh "$TGZ"

echo "upload → ${DEPLOY_HOST}:${DEPLOY_ROOT}/yidalab-src.tgz"
ssh_cmd "$DEPLOY_HOST" "mkdir -p '${DEPLOY_ROOT}'"
scp_cmd "$TGZ" "${DEPLOY_HOST}:${DEPLOY_ROOT}/yidalab-src.tgz"

echo "extract on server"
ssh_cmd "$DEPLOY_HOST" "bash -s" <<REMOTE
set -euo pipefail
cd '${DEPLOY_ROOT}'
rm -rf src.bak.prev
if [ -d src ]; then mv src src.bak.prev; fi
mkdir -p src
tar -xzf yidalab-src.tgz -C src
# keep FBA host-gateway for container → tunnel
if ! grep -q host.docker.internal docker-compose.yml 2>/dev/null; then
  python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
if not p.exists():
    raise SystemExit(0)
text = p.read_text()
old = """    env_file:
      - .env
    environment:"""
new = """    env_file:
      - .env
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:"""
if old in text and "host.docker.internal" not in text:
    p.write_text(text.replace(old, new, 1))
    print("patched extra_hosts")
PY
fi
if grep -q 'USE_CN_MIRROR:' docker-compose.yml; then
  sed -i 's/USE_CN_MIRROR: "false"/USE_CN_MIRROR: "true"/' docker-compose.yml || true
fi
# install rebuild helper next to compose
mkdir -p scripts/ops/deploy
REMOTE

# ship rebuild script (from local tree)
scp_cmd \
  "$REPO_ROOT/scripts/ops/deploy/server-rebuild.sh" \
  "${DEPLOY_HOST}:${DEPLOY_ROOT}/server-rebuild.sh"
ssh_cmd "$DEPLOY_HOST" "chmod +x '${DEPLOY_ROOT}/server-rebuild.sh'"

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "SKIP_BUILD=1 — source uploaded only"
  exit 0
fi

echo "remote rebuild (NO_CACHE=${NO_CACHE:-0})"
ssh_cmd "$DEPLOY_HOST" "cd '${DEPLOY_ROOT}' && NO_CACHE='${NO_CACHE:-0}' ./server-rebuild.sh"
echo "ship complete @ $REV"
