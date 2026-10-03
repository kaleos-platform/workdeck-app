# 신규 검증 환경 초기화 방안

2026-10-03 조사. 대상은 Opening 고객 이전을 검증할 **고객 데이터가 없는 신규 Supabase 프로젝트**다. 이 문서는 실행 계획이며 원격 DB 생성·쓰기, 기존 migration 수정·reset·적용 이력 변경은 수행하지 않았다.

## 결론

현재 `prisma/migrations` 전체를 빈 DB에 순서대로 적용하는 방식은 막혀 있다. 신규 검증 환경은 **확정한 코드 revision의 Prisma schema를 기준으로 별도 baseline migration 이력**을 사용한다. 기존 개발·운영 이력과 저장 경로를 분리하며, 기존 프로젝트에 이 baseline을 적용하지 않는다. 전체 이력의 정상 재생 문제를 해결한 것으로 간주하지 않는다.

기존 `prisma.config.ts`는 `.env.local`을 `override: true`로 읽는다. 셸에서 URL만 바꿔 같은 config를 실행하면 기존 개발 DB를 선택할 수 있다. 신규 환경은 dotenv를 읽지 않는 별도 config와 명시적 `--config`가 필수다.

## 확인한 장애와 근거

| 구분                  | 확인한 사실                                                                                                                             | 결과                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Supabase 전제         | `20260304231000_add_reports_storage_bucket_policies`가 `storage.buckets`, `storage.objects`, `auth.uid()`, `authenticated`를 사용       | 빈 PostgreSQL shadow에서 `P3006`, `P1014`, `storage.buckets` 없음으로 실패               |
| migration 순서        | `20260606120000_coupang_backfill_cancelled`가 enum을 ALTER하지만 생성은 `20260623000000_coupang_channel_externalsource_toggle_backfill` | storage/auth 전제를 보완해도 `ERROR: type "CoupangBackfillStatus" does not exist`로 실패 |
| 브랜치와 개발 DB 차이 | 아래 migration 3개가 개발 DB에 적용됐다는 선행 조사 기록이 있으나 현재 브랜치에는 없음                                                  | 현재 schema baseline이 공유 개발 DB 전체와 같다고 주장할 수 없음                         |
| schema 바깥 상태      | Prisma schema에는 Storage bucket/policy, RLS·GRANT, 데이터 seed가 표현되지 않음                                                         | `migrate diff --from-empty`만으로 Supabase 앱 실행 상태를 복원할 수 없음                 |

enum 이름은 현재 schema에 있고 `CANCELLED`도 포함돼 있다. 기존 migration 파일명을 바꾸거나 과거 SQL을 고치는 방식은 이미 적용된 환경의 checksum과 이력을 바꾸므로 사용하지 않는다. 단순히 마지막에 보정 migration을 추가해도 앞에서 실패하는 빈 DB 재생은 해결되지 않는다.

개발 DB 적용 여부는 이번 조사에서 원격으로 다시 조회하지 않았다. 파일 존재와 내용은 로컬 Git의 다음 commit에서 확인했다.

| 현재 브랜치에 없는 migration                              | 파일 확인 commit | 주요 변경                                                     |
| --------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `20260913100000_add_exempt_expiry_and_billing_policy`     | `ae12d179`       | `SpaceSubscription.exemptEndsAt/exemptUntil`, `BillingPolicy` |
| `20260922130000_coupang_price_write`                      | `943aadf0`       | `CoupangProductItem`, `CoupangWriteJob` 및 관련 enum/index    |
| `20260926100000_product_category_exclude_sales_analytics` | `86cfb94d`       | `InvProductGroup.excludeFromSalesAnalytics`, 기존 행 backfill |

검증 환경은 현재 채용 브랜치 revision을 검증하는 것으로 범위를 고정한다. 공유 개발 DB와 동일성을 요구한다면 해당 기능의 코드·schema·migration을 정상 통합한 다음 baseline을 다시 생성해야 한다. 3개 SQL만 복사하거나 적용됐다고 표시하는 것으로 대체하지 않는다.

## 신규 환경 전용 baseline 절차

1. 기준 Git revision, schema checksum, 원본 migration 목록·checksum을 manifest로 고정한다. 이 목록은 비교 자료이며 기존 migration을 새 DB에 적용됐다고 표시하는 입력이 아니다. 작업 중인 schema를 쓸 경우 해당 diff도 보관한다.
2. Supabase가 직접 만든 신규 프로젝트와 별도 shadow 환경을 준비한다. `auth`/`storage` 시스템 schema와 `anon`, `authenticated`, `service_role`이 존재하는지 확인한다. 가짜 `auth.uid()`나 최소 테이블 stub은 SQL 실험용일 뿐 실제 Supabase 검증 환경을 대체하지 못한다.
3. 별도 디렉터리의 `schema.prisma`, `migrations/`, `prisma.config.ts`를 준비한다. config는 전용 `VALIDATION_DATABASE_URL`/`VALIDATION_SHADOW_DATABASE_URL`만 읽고, 누락되면 실패해야 한다. URL을 출력하지 않는다. 두 대상이 서로 다르고 등록된 검증 프로젝트인지 확인한다. `migrate dev`의 shadow는 지워질 수 있으므로 애플리케이션 DB를 shadow로 지정하지 않는다.
4. **로컬 일회용 빈 PostgreSQL에서** 별도 config로 `prisma migrate dev --name validation_baseline --create-only`를 실행해 최초 migration을 생성한다. 현재 저장소 규칙에 맞게 `migrate dev`로 migration 파일을 만든다. 아래 `migrate diff` 결과는 내용 검토와 교차 확인에만 사용한다. 기존 `prisma/migrations`는 수정하지 않는다.
5. 아직 적용하지 않은 baseline에 schema 외 보완 SQL을 검토해 포함하거나, 같은 별도 이력에 후속 bootstrap migration으로 넣는다. 아래 보완 목록이 확정되기 전 원격 적용하지 않는다. 로컬에서는 SQL 구조를 검증하고, 실제 auth/storage 정책은 Supabase 환경에서 따로 검증한다.
6. baseline과 보완 migration, 전용 config, manifest를 함께 커밋해 재현 가능한 artifact로 만든다. 빈 검증 DB임을 확인한 후에만 **전용 config의 `migrate deploy`**로 신규 환경에 적용한다. 현재 조사에서는 이 파일 묶음을 생성·커밋하거나 원격 배포하지 않았다.
7. 아래 검증이 모두 통과하면 합성 계정·공고·지원서로 smoke test를 진행한다. 실제 고객 복사는 별도 readiness 기준에 따른다.

빈 새 DB에서는 baseline SQL을 실제 적용해야 한다. `migrate resolve --applied`만 실행하면 테이블은 생성되지 않는다. Prisma 공식 baseline 문서의 `resolve`는 이미 존재하는 스키마를 기록하는 용도이며, 이 신규 환경 절차에 기존 migration 일괄 `resolve`를 추가하지 않는다. [Prisma ORM v7 baseline 문서](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/baselining)

### schema 외 필수 보완

- `reports` bucket과 owner 기반 Storage 정책은 기존 `20260304231000...`의 의도를 검토해 재현한다. `storage.objects.owner` 및 `auth.uid()` 타입·호환성을 실제 신규 Supabase 버전에서 확인한다.
- `hiring-assets`는 공개 이미지 용도, `hiring-files`는 비공개 첨부 용도다. 현재 업로드 경로는 `hiring-files`의 `public = false`, `file_size_limit = 20971520`을 검사한다. bucket 자체 설정과 읽기·쓰기 정책을 모두 검증한다. schema baseline은 bucket을 생성하지 않는다.
- `HiringUploadSession`, `HiringMigrationRecord`의 RLS 활성화 및 `anon`/`authenticated` 권한 회수는 `20261003062710_hiring_upload_sessions_and_migration_ledger` 마지막 SQL에 있다. schema diff에는 빠지므로 반드시 보완한다.
- 나머지 public 테이블의 노출·권한은 schema diff로 확인할 수 없다. 특히 지원서 PII, 블랙리스트, 사용자·Space 정보가 `anon`/일반 `authenticated`로 조회되지 않는지 확인한다. 실제 환경의 정책을 점검하지 않은 상태에서 RLS 동일성을 주장하지 않는다.
- 최종 `DeckApp`의 `recruiting` seed는 `20260707100000_merge_hiring_decks_to_recruiting`에 있다. 새 DB에는 기존 Space가 없으므로 과거 고객별 backfill 전체를 실행할 이유가 없다. 앱이 필요로 하는 최종 카탈로그·시스템 템플릿 seed만 추려 보완한다. 전체 앱 검증이 필요하면 다른 Deck 카탈로그도 별도 확인한다.
- 사용자 인증 설정, redirect URL, 서비스 키, `ENCRYPTION_KEY`, `HIRING_HMAC_KEY`, 알림 설정은 SQL baseline에 포함되지 않는다. 검증 전용 값으로 구성하고 실메일·SMS 발송은 막는다. 운영 키·고객 데이터를 복제하지 않는다.

### 이후 migration 관리

신규 환경은 원본 이력과 다른 이력을 갖는다. 저장소 기본 `vercel.json` 배포의 `prisma migrate deploy`를 그대로 이 환경에 연결하면 과거 CREATE migration이 다시 실행될 수 있다. 검증 환경 전용 배포는 baseline 이력과 기준 revision 이후의 migration만 포함하는 별도 config/artifact를 사용해야 한다. 기준 이전 migration은 다시 넣지 않는다.

이 이중 이력은 채용 이전 검증용으로 한정한다. 장기 공용 환경으로 승격하려면 팀 차원의 migration 통합 정책과 코드 revision 대응 규칙을 먼저 결정한다. 기존 운영 환경을 baseline으로 바꾸는 작업은 이 문서 범위 밖이다.

## 검증 명령

아래 `$VALIDATION_CONFIG`는 dotenv를 읽지 않는 전용 config의 파일 경로다. DB URL이 아니다. 적용 명령은 위 절차의 대상 확인·artifact 검토 이후 신규 환경에서만 실행한다.

```bash
# 로컬 schema만으로 SQL 생성: DB 접속·쓰기 없음
node node_modules/prisma/build/index.js migrate diff \
  --config "$VALIDATION_CONFIG" \
  --from-empty --to-schema prisma/schema.prisma --script \
  --output /private/tmp/workdeck-validation-baseline-review.sql

# 일회용 로컬 DB에서 전용 schema/migrations 경로로 생성
node node_modules/prisma/build/index.js migrate dev \
  --config "$VALIDATION_CONFIG" --name validation_baseline --create-only

# 검토한 신규 환경 전용 artifact 적용
node node_modules/prisma/build/index.js migrate deploy --config "$VALIDATION_CONFIG"
node node_modules/prisma/build/index.js migrate status --config "$VALIDATION_CONFIG"

# DB와 고정 schema 차이가 없어야 exit 0; 차이 2, 오류 1
node node_modules/prisma/build/index.js migrate diff \
  --config "$VALIDATION_CONFIG" --from-config-datasource \
  --to-schema prisma/schema.prisma --exit-code
```

schema diff 통과는 RLS·Storage·seed 검증을 대신하지 않는다. 읽기 전용 SQL로 아래를 확인하고 결과에는 객체 이름·개수만 남긴다.

```sql
SELECT to_regclass('storage.buckets'), to_regclass('storage.objects'),
       to_regprocedure('auth.uid()');
SELECT rolname FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role');
SELECT id, public, file_size_limit FROM storage.buckets
WHERE id IN ('reports', 'hiring-assets', 'hiring-files');
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies WHERE schemaname IN ('public', 'storage');
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('HiringUploadSession', 'HiringMigrationRecord');
SELECT grantee, table_name, privilege_type FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('HiringUploadSession', 'HiringMigrationRecord')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC');
SELECT id, "isActive" FROM "DeckApp" WHERE id = 'recruiting';
```

さらに API 経由で匿名の private 添付読み取り拒否、他 Space の閲覧拒否、同一 Space の authorized 操作、20 MiB 境界の添付、upload session の期限・再使用防止を合成データで確認する。接続先・API key・暗号鍵・実データはログや文書に記録しない。

## 今回のローカル検証結果

- 既存ローカル実行ログで storage 欠落と enum 順序の二段階の失敗を確認した。今回新たに migration 再生や DB 書き込みは行っていない。
- dotenvを読まない一時 configと接続不能な localhost URLを使い、インストール済み Prisma CLIで `migrate diff --from-empty --to-schema ... --script` を実行した。DBを使わず SQL 生成成功。
- 生成 SQLは `CREATE TABLE` 144件、`CREATE TYPE` 79件。`HiringMigrationRecord`と`CANCELLED`を含む。RLS、Storage bucket、INSERT seedは含まれないことを確認した。
- 一時出力は `/private/tmp/workdeck-bootstrap-audit/baseline.sql`。恒久 artifactではない。SQL生成成功は新規 Supabaseへの適用成功・アプリ稼働確認ではない。
- 未完了: 新規検証プロジェクト確定、schema外設定の棚卸し完了、恒久baseline artifactの生成・レビュー、Supabase上の権限/API検証。
