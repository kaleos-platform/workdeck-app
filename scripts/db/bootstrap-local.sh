#!/usr/bin/env bash
# 로컬/CI 전용 DB 부트스트랩 — 로컬 Supabase(127.0.0.1)에서만 실행한다.
#
# 마이그레이션 이력은 빈 DB에서 재생되지 않는다(db push 시절 누락 객체, 순서 오류).
# 그래서 #1060 머지 시점(BASE_REF)의 schema.prisma로 기준 스키마를 만들고,
# 20261009120000 이전 마이그레이션은 적용됨으로 표시한 뒤
# 20261009120000(Data API 잠금)과 그 이후 마이그레이션만 실제로 실행한다.
# 기준 스키마를 현재 schema.prisma가 아닌 BASE_REF로 고정해야 새 마이그레이션의 CREATE TABLE 이 실제로 실행된다.
set -euo pipefail

BASE_REF=8a2fdcdd319792610c267f627103276f94223090
FIRST_REAL=20261009120000

cd "$(git rev-parse --show-toplevel)"

# prisma.config.ts 와 같은 방식(.env → .env.local override, DIRECT_URL ?? DATABASE_URL)으로 실제 접속 URL 을 구한다.
DB_URL="$(node -e "
const { config } = require('dotenv')
config({ quiet: true })
config({ path: '.env.local', override: true, quiet: true })
process.stdout.write(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '')
")"
# supabase db reset 은 supabase/config.toml 의 스택을 초기화한다 — prisma 가 붙을 DB 도 그 스택이어야 한다.
DB_PORT="$(awk '/^\[db\]/{f=1;next} /^\[/{f=0} f&&/^port *=/{print $3}' supabase/config.toml)"
if [[ -z "$DB_PORT" || ! "$DB_URL" =~ @(127\.0\.0\.1|localhost):${DB_PORT}/ ]]; then
  echo "접속 URL 이 supabase/config.toml 의 로컬 DB(포트 ${DB_PORT:-?})가 아닙니다 — 중단" >&2
  exit 1
fi

supabase db reset

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git show "$BASE_REF:prisma/schema.prisma" > "$tmp/base.prisma"
npx prisma migrate diff --from-empty --to-schema "$tmp/base.prisma" --script > "$tmp/base.sql"
npx prisma db execute --file "$tmp/base.sql"

for dir in prisma/migrations/*/; do
  name="$(basename "$dir")"
  [[ "$name" < "$FIRST_REAL" ]] || continue
  npx prisma migrate resolve --applied "$name" > /dev/null
done

npx prisma migrate deploy
