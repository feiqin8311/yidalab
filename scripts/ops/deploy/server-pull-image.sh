#!/usr/bin/env bash
# Run ON production host: pull pre-built image from GHCR → tag yidalab:v1 → restart.
# No compile. Prefer CI auto-deploy (SSH stream); use this for manual re-pull / rollback.
#
# Env:
#   GHCR_IMAGE   default ghcr.io/feiqin8311/yidalab
#   TAG          default prod  (also: latest, sha-xxxxxxx)
#   LOCAL_TAG    default yidalab:v1  (must match compose image:)
#   GHCR_USER    for docker login (optional if already logged in)
#   GHCR_TOKEN   PAT with read:packages
#   DEPLOY_ROOT  default /yida/yidalab
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/yida/yidalab}"
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/feiqin8311/yidalab}"
GHCR_IMAGE="$(echo "$GHCR_IMAGE" | tr '[:upper:]' '[:lower:]')"
TAG="${TAG:-prod}"
LOCAL_TAG="${LOCAL_TAG:-yidalab:v1}"

cd "$DEPLOY_ROOT"

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  USER_NAME="${GHCR_USER:-${GITHUB_USER:-}}"
  if [[ -z "$USER_NAME" ]]; then
    echo "error: set GHCR_USER (GitHub username) when using GHCR_TOKEN" >&2
    exit 1
  fi
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$USER_NAME" --password-stdin
fi

REF="${GHCR_IMAGE}:${TAG}"
echo "pull $REF"
if ! docker pull "$REF"; then
  cat >&2 <<'EOF'
error: docker pull failed (often 403 on private GHCR packages).

Fix one of:
  1. PAT with read:packages + docker login ghcr.io
  2. GitHub → Packages → yidalab → Package settings → Change visibility to Public
  3. Prefer CI deploy: push code; Actions streams the image over SSH (no server pull)

Daily path does not need this script: push → "YidaLab Production Image" → auto deploy.
EOF
  exit 1
fi

echo "tag → $LOCAL_TAG"
docker tag "$REF" "$LOCAL_TAG"

echo "compose up lobe (no-build)"
docker compose up -d --no-build --force-recreate lobe
docker compose ps lobe

echo "done. image=$(docker image inspect "$LOCAL_TAG" --format '{{.Id}} {{.Created}}')"
