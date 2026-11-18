#!/bin/bash
# 오프닝 자동 이전 워커 실행기(launchd ai.workdeck.opening-migrate 가 10분마다 호출).
# 키체인(workdeck-opening-worker.*)에서 비밀값을 꺼내 이 프로세스 환경으로만 넘긴다. 파일·로그에 남기지 않는다.
#   run.sh            워커 1회(match·plan)
#   run.sh --dry      DB·checked.json 쓰기 없이 할 일만
#   run.sh --verify   키체인 값으로 양쪽 DB·S3 접근만 확인(쓰기 없음)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
KC=workdeck-opening-worker
ROOT=$HOME/.local/share/workdeck/opening-migrations/auto
CA_DIR=${OPENING_WORKER_CA_DIR:-$ROOT/ca}
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

kc_get() { security find-generic-password -a workdeck -s "$KC.$1" -w 2>/dev/null; }
need() { local v; v=$(kc_get "$1"); [ -n "$v" ] || { echo "{\"status\":\"BLOCKED\",\"code\":\"KEYCHAIN_MISSING\",\"item\":\"$1\"}"; exit 1; }; printf '%s' "$v"; }

DIRECT_URL=$(need workdeck-direct-url) || exit 1; export DIRECT_URL
OPENING_SOURCE_URL=$(need opening-reader-url) || exit 1; export OPENING_SOURCE_URL
OPENING_HMAC_KEY=$(need opening-hmac-key) || exit 1; export OPENING_HMAC_KEY
ENCRYPTION_KEY_V1=$(need encryption-key-v1) || exit 1; export ENCRYPTION_KEY_V1
OPENING_READER_KIND=$(kc_get opening-reader-kind); export OPENING_READER_KIND
need s3-credentials >/dev/null || exit 1
export OPENING_CA_FILE=$CA_DIR/rds-global-bundle.pem MIGRATION_CA_FILE=$CA_DIR/supabase-prod-ca-2021.crt
[ -s "$OPENING_CA_FILE" ] && [ -s "$MIGRATION_CA_FILE" ] || { echo '{"status":"BLOCKED","code":"CA_MISSING"}'; exit 1; }

# S3 는 전용 IAM 키만 쓰도록 이 실행 전용 AWS 설정을 만든다(credential_process 가 키체인에서 읽음).
mkdir -p -m 700 "$ROOT"
AWS_CFG=$ROOT/aws-config
printf '[profile opening-reader]\nregion = ap-northeast-2\ncredential_process = %s/aws-creds.sh\n' "$HERE" > "$AWS_CFG"
chmod 600 "$AWS_CFG"
export AWS_CONFIG_FILE=$AWS_CFG AWS_SHARED_CREDENTIALS_FILE=/dev/null OPENING_AWS_PROFILE=opening-reader

cd "$REPO" || exit 1
# tsx 는 저장소 의존성이 아니다(기존 스크립트도 npx tsx). 버전을 고정하고 첫 실행 뒤에는 npx 캐시를 쓴다.
TSX=(npx --yes tsx@4.23.15)
if [ "${1:-}" = "--verify" ]; then
  exec "${TSX[@]}" "$HERE/verify.ts"
fi
exec "${TSX[@]}" scripts/opening-auto-migrate.ts "$@"
