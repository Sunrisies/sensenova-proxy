#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
CONFIG_FILE="$DEPLOY_DIR/server.local.env"
IMAGE_NAME="sensenova-proxy"
IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
ARCHIVE="$DEPLOY_DIR/${IMAGE_NAME}-${IMAGE_TAG}.tar.gz"

if [[ ! -f "$CONFIG_FILE" ]]; then
  printf 'Missing %s. Copy server.local.env.example and configure the server.\n' "$CONFIG_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$CONFIG_FILE"

for name in DEPLOY_HOST DEPLOY_USER DEPLOY_PATH; do
  if [[ -z "${!name:-}" ]]; then
    printf '%s is required in %s.\n' "$name" "$CONFIG_FILE" >&2
    exit 1
  fi
done

REMOTE="$DEPLOY_USER@$DEPLOY_HOST"
REMOTE_ARCHIVE="$DEPLOY_PATH/${IMAGE_NAME}-${IMAGE_TAG}.tar.gz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

echo '[1/6] Checking SSH access and server prerequisites...'
ssh "$REMOTE" "command -v docker >/dev/null && test -f '$DEPLOY_PATH/.env'"

echo '[2/6] Building image...'
docker build -t "$IMAGE_NAME:$IMAGE_TAG" -t "$IMAGE_NAME:latest" "$ROOT_DIR"

echo '[3/6] Exporting image...'
docker save "$IMAGE_NAME:$IMAGE_TAG" | gzip -9 > "$ARCHIVE"

echo '[4/6] Uploading image...'
ssh "$REMOTE" "mkdir -p '$DEPLOY_PATH'"
scp "$ARCHIVE" "$REMOTE:$DEPLOY_PATH/"

echo '[5/6] Loading image and recreating container...'
ssh "$REMOTE" "docker load -i '$REMOTE_ARCHIVE' && docker rm -f sensenova-proxy www_sensenova-proxy_1 >/dev/null 2>&1 || true; docker run -d --name sensenova-proxy --restart unless-stopped --env-file '$DEPLOY_PATH/.env' -p 127.0.0.1:3001:3001 '$IMAGE_NAME:$IMAGE_TAG'; rm -f '$REMOTE_ARCHIVE'"

echo '[6/6] Verifying container health...'
ssh "$REMOTE" 'for i in $(seq 1 20); do status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3001/api/status || true); if [ "$status" = "200" ] || [ "$status" = "401" ]; then exit 0; fi; sleep 2; done; docker ps -a --filter name=sensenova-proxy; docker logs --tail=100 sensenova-proxy; exit 1'

echo "Deployment complete: $IMAGE_NAME:$IMAGE_TAG"
