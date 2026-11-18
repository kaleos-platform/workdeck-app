#!/bin/bash
# 오프닝 자동 이전 워커(맥미니) 인프라 설정. 단계별로 실행하고 결과를 확인한 뒤 다음 단계로 간다.
#   setup.sh sg        오프닝 RDS SG 에 맥미니 현재 공인 IP 하나만 허용(이전 워커 IP 규칙은 제거)
#   setup.sh db        오프닝 RDS 읽기 역할 생성·회전(기존 권한 초기화 → 테이블 SELECT, member 3컬럼)
#   setup.sh iam       S3 읽기 IAM 사용자(워커가 읽는 파일 prefix 만 GetObject) + 키 회전 → 키체인
#   setup.sh secrets   워크덱 운영 DIRECT_URL·ENCRYPTION_KEY_V1(Vault 사본)·OPENING_HMAC_KEY → 키체인
#   setup.sh verify    키체인 값만으로 권한 경계·양쪽 DB·S3 읽기 확인(쓰기 없음)
#   setup.sh launchd   이 체크아웃 기준으로 ai.workdeck.opening-migrate 설치·로드(10분 주기)
#   setup.sh revoke    launchd·SG·DB 역할·IAM 사용자 회수. 원격 회수가 모두 확인돼야 키체인을 지운다.
# 관리자 자격 증명(`peak` AWS 프로필·오프닝 운영 env)은 이 스크립트 안에서만 쓴다.
# 비밀값은 argv·파일·로그에 남기지 않는다(키체인은 security -i 에 stdin 으로 넘긴다).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export REPO=$(cd "$HERE/../.." && pwd)
APP=${WORKDECK_APP_DIR:-/Users/kaleos/projects/kaleos/workdeck-app}
SG=sg-0ea4bd00200b44d7e
IAM_USER=workdeck-opening-reader
IAM_POLICY=opening-source-read
KC=workdeck-opening-worker
DESC=workdeck-opening-auto-worker
CA_DIR=${OPENING_WORKER_CA_DIR:-$HOME/.local/share/workdeck/opening-migrations/auto/ca}
PEAK="aws --profile peak"
FAIL=0

# 값을 argv 로 넘기지 않도록 security 대화 모드에 stdin 으로 명령을 준다.
kc_put() {
  local q
  q=$(printf '%s' "$2" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  printf 'add-generic-password -U -a workdeck -s "%s" -w "%s"\n' "$KC.$1" "$q" | security -i >/dev/null 2>&1 || return 1
  [ "$(security find-generic-password -a workdeck -s "$KC.$1" -w 2>/dev/null)" = "$2" ] || return 1
}
kc_del() { security delete-generic-password -a workdeck -s "$KC.$1" >/dev/null 2>&1; }
# 키체인 조회: 0=있음(값 출력), 44=명시적으로 없음, 그 밖=조회 실패(잠김·거부 등)
kc_state() { security find-generic-password -a workdeck -s "$KC.$1" -w 2>/dev/null; }

opening_env() { $PEAK s3 cp s3://peak-cdk-assets-prod/opening/opening_api.prod.env - 2>/dev/null; }
env_val() { printf '%s\n' "$1" | grep -E "^$2=" | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//'; }
strip_ssl() { V="$1" node -e '
  const u = new URL(process.env.V)
  for (const k of [...u.searchParams.keys()]) if (/^(ssl|uselibpqcompat)/i.test(k)) u.searchParams.delete(k)
  process.stdout.write(u.toString())'; }
admin_url() { local e; e=$(opening_env); strip_ssl "$(env_val "$e" DATABASE_URL)"; }
admin() { OPENING_ADMIN_URL="$1" CA="$CA_DIR/rds-global-bundle.pem" MODE="$2" node "$HERE/opening-admin.mjs"; }

ensure_ca() {
  mkdir -p -m 700 "$CA_DIR"
  [ -s "$CA_DIR/rds-global-bundle.pem" ] ||
    curl -fsS -o "$CA_DIR/rds-global-bundle.pem" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
  [ -s "$CA_DIR/supabase-prod-ca-2021.crt" ] ||
    curl -fsS -o "$CA_DIR/supabase-prod-ca-2021.crt" https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
}

# 조회 실패는 빈 결과(규칙 없음)로 착각하지 않도록 종료 상태를 그대로 돌려준다.
worker_cidrs() {
  local out
  out=$($PEAK ec2 describe-security-groups --group-ids $SG \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].IpRanges[?Description=='$DESC'].CidrIp[]" --output text) || return 1
  [ "$out" = None ] && out=""
  printf '%s' "$out"
}
# IAM 사용자 존재: 0=있음, 1=명시적으로 없음(NoSuchEntity), 2=조회 실패
iam_user_state() {
  local err
  err=$($PEAK iam get-user --user-name $IAM_USER 2>&1 >/dev/null) && return 0
  printf '%s' "$err" | grep -q NoSuchEntity && return 1
  return 2
}
revoke_cidr() {
  $PEAK ec2 revoke-security-group-ingress --group-id $SG \
    --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=$1,Description=$DESC}]" >/dev/null
}

# IAM 사용자가 우리 인라인 정책 하나만 갖는지(관리형 정책·그룹·다른 인라인 정책이 있으면 중단)
iam_clean() {
  local inline attached groups
  inline=$($PEAK iam list-user-policies --user-name $IAM_USER --query 'PolicyNames' --output text) || return 1
  attached=$($PEAK iam list-attached-user-policies --user-name $IAM_USER --query 'length(AttachedPolicies)' --output text) || return 1
  groups=$($PEAK iam list-groups-for-user --user-name $IAM_USER --query 'length(Groups)' --output text) || return 1
  [ "$attached" = 0 ] && [ "$groups" = 0 ] && { [ -z "$inline" ] || [ "$inline" = None ] || [ "$inline" = "$IAM_POLICY" ]; }
}

case "${1:-}" in
  sg)
    IP=$(curl -fsS https://checkip.amazonaws.com) || { echo '{"code":"IP_LOOKUP_FAILED"}'; exit 1; }
    CIDRS=$(worker_cidrs) || { echo '{"code":"SG_LOOKUP_FAILED"}'; exit 1; }
    for cidr in $CIDRS; do [ "$cidr" = "$IP/32" ] || revoke_cidr "$cidr" || FAIL=1; done
    if ! printf '%s\n' $CIDRS | grep -qx "$IP/32"; then
      $PEAK ec2 authorize-security-group-ingress --group-id $SG \
        --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=$IP/32,Description=$DESC}]" >/dev/null || FAIL=1
    fi
    NOW=$(worker_cidrs) || { echo '{"code":"SG_LOOKUP_FAILED"}'; exit 1; }
    LEFT=$(printf '%s' "$NOW" | wc -w | tr -d ' ')
    [ "$FAIL" = 0 ] && [ "$LEFT" = 1 ] && [ "$NOW" = "$IP/32" ] \
      && echo '{"sg":"ok","workerRules":1}' || { echo "{\"code\":\"SG_NOT_CLEAN\",\"workerRules\":$LEFT}"; exit 1; }
    ;;
  db)
    ensure_ca
    ADMIN=$(admin_url); [ -n "$ADMIN" ] || { echo '{"code":"SOURCE_URL_NOT_FOUND"}'; exit 1; }
    PW=$(openssl rand -hex 24)
    printf '%s' "$PW" | admin "$ADMIN" grant || { unset ADMIN PW; exit 1; }
    READER=$(U="$ADMIN" P="$PW" node -e '
      const u = new URL(process.env.U); u.username = "workdeck_opening_reader"; u.password = process.env.P
      process.stdout.write(u.toString())')
    unset ADMIN PW
    kc_put opening-reader-url "$READER" && echo '{"keychain":"opening-reader-url"}' || { echo '{"code":"KEYCHAIN_WRITE_FAILED"}'; exit 1; }
    unset READER
    ;;
  iam)
    ensure_ca
    ADMIN=$(admin_url); ROWS=$(admin "$ADMIN" prefixes) || { unset ADMIN; exit 1; }; unset ADMIN
    # 첫 경로 조각이 있는 키만 prefix 로 좁힌다. 경로 없는 키·prefix 가 너무 많으면 사람 판단으로 넘긴다.
    RES=$(printf '%s' "$ROWS" | node -e '
      const rows = JSON.parse(require("fs").readFileSync(0, "utf8"))
      if (!rows.length) { console.error("NO_FILES"); process.exit(2) }
      if (rows.some((r) => !r.nested)) { console.error("FLAT_KEYS"); process.exit(3) }
      if (rows.length > 30) { console.error("TOO_MANY_PREFIXES"); process.exit(4) }
      const ok = (s) => /^[a-z0-9.-]{3,63}$/.test(s.storage) && /^[A-Za-z0-9._=-]{1,100}$/.test(s.prefix)
      if (!rows.every(ok)) { console.error("BAD_NAME"); process.exit(5) }
      process.stdout.write(JSON.stringify(rows.map((r) => `arn:aws:s3:::${r.storage}/${r.prefix}/*`)))') \
      || { echo '{"code":"S3_SCOPE_NEEDS_REVIEW"}'; exit 1; }
    POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\",\"Resource\":$RES}]}"
    iam_user_state; ST=$?
    if [ "$ST" = 0 ]; then
      iam_clean || { echo '{"code":"IAM_USER_HAS_EXTRA_PERMISSIONS"}'; exit 1; }
    elif [ "$ST" = 2 ]; then
      echo '{"code":"IAM_LOOKUP_FAILED"}'; exit 1
    else
      $PEAK iam create-user --user-name $IAM_USER \
        --tags Key=owner,Value=workdeck Key=purpose,Value=opening-auto-migration >/dev/null || exit 1
    fi
    $PEAK iam put-user-policy --user-name $IAM_USER --policy-name $IAM_POLICY --policy-document "$POLICY" || exit 1
    iam_clean || { echo '{"code":"IAM_USER_HAS_EXTRA_PERMISSIONS"}'; exit 1; }
    OLD=$($PEAK iam list-access-keys --user-name $IAM_USER --query 'AccessKeyMetadata[].AccessKeyId' --output text) \
      || { echo '{"code":"IAM_KEY_LOOKUP_FAILED"}'; exit 1; }
    [ "$OLD" = None ] && OLD=""
    # 기존 키체인 항목을 키 생성 전에 확인한다(조회 오류면 아무것도 바꾸지 않고 중단).
    PREV=$(kc_state s3-credentials); PST=$?
    case $PST in 0|44) ;; *) echo '{"code":"KEYCHAIN_LOOKUP_FAILED"}'; exit 1 ;; esac
    KEYJSON=$($PEAK iam create-access-key --user-name $IAM_USER --output json) || exit 1
    KID=$(printf '%s' "$KEYJSON" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).AccessKey.AccessKeyId)')
    KSEC=$(printf '%s' "$KEYJSON" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).AccessKey.SecretAccessKey)')
    unset KEYJSON
    # ID·secret 을 한 항목(JSON)에 함께 저장해 한쪽만 바뀐 상태가 생기지 않게 한다.
    PAIR=$(ID="$KID" SECRET="$KSEC" node -e 'process.stdout.write(JSON.stringify({ id: process.env.ID, secret: process.env.SECRET }))')
    if kc_put s3-credentials "$PAIR"; then
      # 새 키를 키체인에 넣은 뒤에만 이전 키를 지운다(회전 중 끊김 방지)
      for k in $OLD; do $PEAK iam delete-access-key --user-name $IAM_USER --access-key-id "$k" || FAIL=1; done
    else
      FAIL=1
      # 저장 확인 실패: 기존 항목을 되돌린 게 확인될 때만 새 키를 지운다. 아니면 새 키를 남기고 재시도하게 한다.
      if [ "$PST" = 0 ] && kc_put s3-credentials "$PREV"; then
        $PEAK iam delete-access-key --user-name $IAM_USER --access-key-id "$KID"
      elif [ "$PST" = 44 ] && { kc_del s3-credentials; kc_state s3-credentials >/dev/null; [ $? = 44 ]; }; then
        $PEAK iam delete-access-key --user-name $IAM_USER --access-key-id "$KID"
      else
        echo '{"code":"KEYCHAIN_RESTORE_FAILED","newKeyKept":true}'
      fi
    fi
    unset PREV
    unset KSEC PAIR
    # 회전 뒤 새 키 하나만 남았는지 다시 확인한다.
    NOWKEYS=$($PEAK iam list-access-keys --user-name $IAM_USER --query 'AccessKeyMetadata[].AccessKeyId' --output text) || FAIL=1
    [ "$NOWKEYS" = "$KID" ] || FAIL=1
    [ "$FAIL" = 0 ] && echo "{\"iamUser\":\"$IAM_USER\",\"resources\":$(printf '%s' "$RES" | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0)).length))'),\"keychain\":\"s3-credentials\"}" \
      || { echo '{"code":"IAM_KEY_ROTATION_INCOMPLETE"}'; exit 1; }
    ;;
  secrets)
    ensure_ca
    E=$(opening_env); HK=$(env_val "$E" OPENING_HMAC_KEY); unset E
    [ -n "$HK" ] || { echo '{"code":"HMAC_KEY_NOT_FOUND"}'; exit 1; }
    kc_put opening-hmac-key "$HK" || { echo '{"code":"KEYCHAIN_WRITE_FAILED"}'; exit 1; }; unset HK
    S=$(mktemp "${TMPDIR:-/tmp}/wd-prod-env.XXXXXX"); chmod 600 "$S"
    trap 'rm -f "$S"' EXIT INT TERM HUP
    (cd "$APP" && vercel env pull "$S" --environment=production --yes >/dev/null 2>&1) || { echo '{"code":"ENV_PULL_FAILED"}'; exit 1; }
    RAW=$(grep -E '^DIRECT_URL=' "$S" | head -1 | cut -d= -f2- | sed -E 's/^"//; s/"$//'); rm -f "$S"
    WD=$(strip_ssl "$RAW"); unset RAW
    # ENCRYPTION_KEY_V1 은 Vercel Sensitive 라 pull 이 비어 온다 → 운영 Vault 복구 사본(어드민 /admin/recovery 관리)
    KEY=$(DIRECT_URL="$WD" CA="$CA_DIR/supabase-prod-ca-2021.crt" node -e '
      const fs = require("fs"); const { Client } = require(process.env.REPO + "/node_modules/pg")
      ;(async () => { const u = new URL(process.env.DIRECT_URL)
        const c = new Client({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password), database: u.pathname.slice(1) || "postgres",
          ssl: { rejectUnauthorized: true, ca: fs.readFileSync(process.env.CA, "utf8") } })
        c.on("error", () => {}); await c.connect()
        try { await c.query("BEGIN READ ONLY")
          const { rows } = await c.query("SELECT decrypted_secret AS v FROM vault.decrypted_secrets WHERE name = $1", ["workdeck.platform.encryption-v1.k1"])
          if (rows.length !== 1 || !/^[a-fA-F0-9]{64}$/.test(rows[0].v)) throw Error("VAULT_KEY_INVALID")
          process.stdout.write(rows[0].v); await c.query("ROLLBACK") } finally { await c.end() } })()
        .catch((e) => { console.error(JSON.stringify({ code: /^[A-Z_]+$/.test(e.message) ? e.message : "VAULT_READ_FAILED" })); process.exitCode = 1 })') \
      || { unset WD; exit 1; }
    kc_put workdeck-direct-url "$WD" && kc_put encryption-key-v1 "$KEY" || { unset WD KEY; echo '{"code":"KEYCHAIN_WRITE_FAILED"}'; exit 1; }
    unset KEY WD
    echo '{"keychain":["opening-hmac-key","workdeck-direct-url","encryption-key-v1"]}'
    ;;
  verify)
    ensure_ca
    exec "$HERE/run.sh" --verify
    ;;
  launchd)
    LOG=$HOME/.local/share/workdeck/opening-migrations/auto/worker.log
    PL=$HOME/Library/LaunchAgents/ai.workdeck.opening-migrate.plist
    mkdir -p -m 700 "$(dirname "$LOG")"; touch "$LOG"; chmod 600 "$LOG"
    sed -e "s#__REPO__#$REPO#g" -e "s#__LOG__#$LOG#g" "$HERE/ai.workdeck.opening-migrate.plist" > "$PL"
    launchctl bootout "gui/$(id -u)/ai.workdeck.opening-migrate" 2>/dev/null
    launchctl bootstrap "gui/$(id -u)" "$PL" && echo '{"launchd":"loaded","interval":600}'
    ;;
  revoke)
    launchctl bootout "gui/$(id -u)/ai.workdeck.opening-migrate" 2>/dev/null
    rm -f "$HOME/Library/LaunchAgents/ai.workdeck.opening-migrate.plist"
    if CIDRS=$(worker_cidrs); then
      for cidr in $CIDRS; do revoke_cidr "$cidr" || FAIL=1; done
      LEFT=$(worker_cidrs) || LEFT=lookup_failed
      [ -z "$LEFT" ] || { FAIL=1; echo '{"sg":"rules_remaining_or_unknown"}'; }
    else
      FAIL=1; echo '{"sg":"lookup_failed"}'
    fi
    ensure_ca
    ADMIN=$(admin_url)
    if [ -n "$ADMIN" ]; then admin "$ADMIN" drop || FAIL=1; else FAIL=1; echo '{"db":"admin_url_missing"}'; fi
    unset ADMIN
    iam_user_state; ST=$?
    if [ "$ST" = 0 ]; then
      KEYS=$($PEAK iam list-access-keys --user-name $IAM_USER --query 'AccessKeyMetadata[].AccessKeyId' --output text) || FAIL=1
      for k in $KEYS; do [ "$k" = None ] || $PEAK iam delete-access-key --user-name $IAM_USER --access-key-id "$k" || FAIL=1; done
      $PEAK iam delete-user-policy --user-name $IAM_USER --policy-name $IAM_POLICY >/dev/null 2>&1
      $PEAK iam delete-user --user-name $IAM_USER >/dev/null || FAIL=1
      iam_user_state; [ $? = 1 ] || { FAIL=1; echo '{"iam":"user_remaining_or_unknown"}'; }
    elif [ "$ST" = 2 ]; then
      FAIL=1; echo '{"iam":"lookup_failed"}'
    fi
    if [ "$FAIL" = 0 ]; then
      for k in opening-reader-url s3-credentials opening-hmac-key workdeck-direct-url encryption-key-v1; do kc_del $k; done
      echo '{"revoked":["launchd","sg","db-role","iam-user","keychain"]}'
    else
      echo '{"code":"REVOKE_INCOMPLETE","keychain":"kept_for_retry"}'; exit 1
    fi
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1 ;;
esac
