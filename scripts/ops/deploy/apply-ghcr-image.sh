#!/usr/bin/env bash
# Apply a GHCR image already present on this host (self-hosted runner).
# Usage: apply-ghcr-image.sh <image-ref>
set -euo pipefail

REF=${1:?image ref e.g. ghcr.io/feiqin8311/yidalab:prod}
LOCAL_TAG=${LOCAL_TAG:-yidalab:v1}
DEPLOY_ROOT=${DEPLOY_ROOT:-/yida/yidalab}

cd "$DEPLOY_ROOT"

PREV_ID=$(
  docker inspect --format '{{.Image}}' "$(docker compose ps -q lobe 2>/dev/null | head -1)" 2>/dev/null || true
)
echo "previous image id: ${PREV_ID:-none}"

echo "tag $REF → $LOCAL_TAG"
docker tag "$REF" "$LOCAL_TAG"
docker compose up -d --no-build --force-recreate lobe
docker compose ps lobe
docker image inspect "$LOCAL_TAG" --format 'done id={{.Id}} created={{.Created}}'

code=""
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3210/ || true)
  echo "health try $i: http $code"
  case "$code" in 200|301|302|307|308|401|403) break ;; esac
  sleep 3
done

if [[ "$code" =~ ^(200|301|302|307|308|401|403)$ ]]; then
  echo "running database migrations"
  docker compose exec -T lobe node /app/docker.cjs
  echo "database migrations completed"
  exit 0
fi

echo "::error::health check exhausted without ready response — deploy failed"
docker compose ps lobe || true
docker compose logs --tail=80 lobe || true
if [[ -n "${PREV_ID:-}" ]]; then
  echo "::warning::rolling back to previous image id=$PREV_ID"
  docker tag "$PREV_ID" "$LOCAL_TAG" || true
  docker compose up -d --no-build --force-recreate lobe || true
  sleep 5
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3210/ || true)
  echo "rollback health: http $code"
else
  echo "::warning::no previous image id — cannot auto-rollback"
fi
exit 1
