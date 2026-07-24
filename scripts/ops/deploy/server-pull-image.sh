#!/usr/bin/env bash
# Run ON production host (or via ssh). Pull pre-built image from GHCR and restart lobe.
# No compile on server — typically 1–5 minutes.
#
# Env:
#   GHCR_IMAGE   default ghcr.io/feiqin8311/yidalab
#   TAG          default prod  (also: latest, sha-xxxxxxx)
#   LOCAL_TAG    default yidalab:v1  (must match compose image:)
#   GHCR_USER    for docker login (optional if already logged in)
#   GHCR_TOKEN   PAT with read:packages (or password via stdin login once)
#   DEPLOY_ROOT  default /yida/yidalab
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/yida/yidalab}"
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/feiqin8311/yidalab}"
# GHCR image names are lowercase
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
docker pull "$REF"

echo "tag → $LOCAL_TAG"
docker tag "$REF" "$LOCAL_TAG"

echo "compose up lobe"
docker compose up -d lobe
docker compose ps lobe

echo "done. image=$(docker image inspect "$LOCAL_TAG" --format '{{.Id}} {{.Created}}')"
