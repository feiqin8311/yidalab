#!/usr/bin/env bash
# From laptop: SSH to prod and run server-pull-image.sh
# Env: DEPLOY_HOST, TAG, GHCR_IMAGE, GHCR_USER, GHCR_TOKEN, SSHPASS
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-root@116.205.229.31}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/yida/yidalab}"
TAG="${TAG:-prod}"
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/feiqin8311/yidalab}"

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

scp_cmd "$REPO_ROOT/scripts/ops/deploy/server-pull-image.sh" "${DEPLOY_HOST}:${DEPLOY_ROOT}/server-pull-image.sh"
ssh_cmd "$DEPLOY_HOST" "chmod +x '${DEPLOY_ROOT}/server-pull-image.sh' && \
  cd '${DEPLOY_ROOT}' && \
  GHCR_IMAGE='${GHCR_IMAGE}' TAG='${TAG}' \
  GHCR_USER='${GHCR_USER:-}' GHCR_TOKEN='${GHCR_TOKEN:-}' \
  ./server-pull-image.sh"
