# 오프닝워크 고객 이전 완료 기준과 실행 계획

작성: 2026-10-03. 사용자 목표: 고객이 Workdeck 모집관리로 이전하여 공고 제작과 지원자 관리를 지속할 수 있는 상태. 이 문서는 작업 완료를 의미하지 않는다.

## 완료 기준

- 이전 대상 고객별 계정/Space/권한 연결이 확인되고 데이터 건수·관계·상태·파일 검증 차이가 설명되어야 한다.
- 공고 만들기/복제/템플릿/HTML 복사, 공개 지원/첨부, 지원자 조회/단계/메모/엑셀을 대상 환경에서 검증한다.
- 과거 응답/근무조건/동의/삭제/알림 이력을 임의로 버리거나 현재값으로 덮어쓰지 않는다. 미지원 항목은 명시적 정책 또는 보존 경로가 있어야 한다.
- 동일 이전 계획 재실행 시 추가 생성 0건, 중간 실패 재개, 고객 수정 충돌 차단을 검증한다.
- 기존 공개 URL·이미지 URL, 전환 기간 새 접수, 결제 잔여 권리와 복귀 절차가 결정되어야 한다.
- 코드/마이그레이션/검증 근거가 커밋되고 미검증 사항이 분리되어야 한다. 단순 단위 테스트 통과를 이전 완료로 표시하지 않는다.

## 실행 순서

### 1. 누적 변경 안정화와 보존

대상: `app/d/recruiting`, `app/api/hiring-*`, `src/components/hiring-*`, `src/lib/hiring`, 관련 검증 스키마.

- [x] 별도 `feat/opening-customer-migration` 브랜치 생성. 기존 로컬 변경 유지.
- [x] 전체 단위 테스트 기준선: 215 suites / 1,756 tests 통과.
- [x] 공개 지원/첨부/변환기 독립 코드 리뷰와 중요한 지적 수정. 일반 필수값 API 누락과 유형 변경 시 제한 충돌을 수정하고 UI 저장까지 검증.
- [x] 실패 재현 → 수정 → 전체 215 suites/1,760 tests, typecheck, lint(오류 0/기존 경고 70), 로컬 production build 통과.
- [x] 누적 코드와 테스트 체크포인트 `e7cf7d9a`. 스크린샷/비밀정보 제외.

### 2. 실제 원본과 변환 성공/보류 건수 대조

대상: `scripts/audit-opening-migration.mjs`, `src/lib/hiring/opening-form-migration.ts` 및 합성 테스트.

- [x] 읽기 전용 폼 집계: 18개 유료 ACTIVE 고객, 1,506개 중 1,490개 계획 가능 / 모호한 필드 16개 보류(2026-10-03 06:41 UTC). 202개 파일 항목은 3개/20 MiB. 고객 원문/PII 출력 없음.
- [ ] 원본 콘텐츠·관계의 변환 가능 범위를 확인하고 지원자 과거 폼/표시값의 근거를 구분.
- [x] 참조 범위 내 첨부 262개 HEAD 대조: 모두 존재, 누락/접근 실패 0, 합계 528,799,917 bytes, 10 MiB 초과 11개. 내용 checksum/복사는 별도 미완료.
- [ ] `planned + blocked + excluded = source` 대조 및 잘못된 데이터/범위 이탈 합성 사례 검증.

### 3. 이전 계획과 영속 대응 원장

대상: 신규 `src/lib/hiring/migration/` 모듈, `scripts/migrate-opening-customers.*`, 필요 시 `prisma/schema.prisma`와 migrate dev 생성 파일.

- [ ] 명시적 고객 allowlist/원본 snapshot/대상 Space·계정 대응을 입력으로 받는 읽기 전용 계획 명령 구현.
- [x] BIGINT 문자열 tuple 대응과 snapshot/변환 버전·hash·암호화 원본을 저장하는 원장 helper 구현. 준비된 공고 한 건 CLI에 연결했고 고객별 일괄 이전은 미완료.
- [x] 합성 공고의 실제 개발 DB transaction에서 원자성/재실행/고객 수정 충돌을 검증. 공고·지원서 한 건 executor에 연결했고 실제 고객 적재는 미실행.
- [ ] 객체 복사를 checksum/개별 상태로 분리하고 실패 재개 검증. 알림·결제·공개 접수 부작용 없음.
- [ ] 합성 데이터로 첫 실행/재실행/실패 재개/충돌/교차 Space 거부를 검증.

### 4. 이전 차이 해소와 고객 업무 QA

- [x] 과거 기타 응답의 확정/불확정 의미를 구분하는 암호화 원문 조회 경로. 일반 업무용 구조화 응답 변환은 별도 미완료.
- [ ] 근무조건·담당자·동의·삭제·알림 등 대상 모델 차이를 보존하고 운영 화면에서 확인.
- [ ] 대표 공고 블록·HTML 및 지원자/첨부/엑셀 흐름을 Aside로 확인.
- [ ] 배포 환경의 요청 크기/스토리지/권한/동시성/성능 제한을 확인하고 필요한 보완 적용. npm audit에서 현재 Next.js 보안 업데이트 필요 확인(보안 조치 전 전환 완료 아님).

### 5. 검증 전용 환경 dry-run 및 전환 준비

- [ ] 사용자에게 대표 고객과 검증 전용 대상, 계정/소유자 대응 선택에 필요한 보고서 제시.
- [ ] 실제 고객 데이터는 평소 개발 DB에 복사하지 않고 지정된 검증 대상에서만 처리.
- [ ] 건수·관계·내용·암호화·첨부·권한·재실행 대조 및 고객 업무 확인.
- [ ] URL/이미지 호환·결제·동결/delta·복귀 기준의 미결정 사항 요청.
- [ ] 검증 완료한 커밋/실행계획/전환 목록으로 운영 전환 결정 요청.

## 사용자 개입이 필요한 경계

대표 고객 범위와 대상 Space 소유자, 실제 고객 데이터를 받을 검증 환경, 삭제/이력 보존 정책, 기존 결제와 URL 유지 기간, 최종 운영 전환은 코드만으로 결정하지 않는다. 해당 단계까지 독립적인 구현·테스트를 계속 진행하고, 선택 가능한 구체적 결과와 영향을 제시한다.

상세 근거: [이전 가이드](opening-migration-plan.md). 앱 기능 개선 기록: [누적 평가](../../../audit/2026-09-11-recruiting-product-review.md).

## 직접 업로드와 이전 원장 구현 계약

2026-10-03 원본 HEAD 확인: 첨부 262개 모두 존재, 11개는 10 MiB 초과. 원본 파일 정책 202개 항목은 모두 최대 3개/20 MiB. 파일 내용 checksum은 아직 확인하지 않았다.

- 브라우저는 서버가 발급한 항목별 signed upload URL로 `hiring-files` 비공개 버킷에 직접 PUT한다. API에 파일 본문을 보내지 않아 Vercel body 한도를 피한다.
- `HiringUploadSession`은 임의 token의 hash, 공고/Space, 서버가 정한 파일 ID/경로/크기/MIME/항목, 만료와 최종 지원서 대응을 보관한다. 임의 경로/다른 세션/만료 token/동시 완료는 거부한다.
- 완료 API는 실제 객체 메타데이터·현재 공고 정의·지원서 값을 검증한 뒤 지원서/파일 메타데이터/세션 완료를 DB 트랜잭션으로 확정한다. 같은 token과 같은 제출값의 재시도는 동일 결과를 반환하고 다른 제출값은 충돌 처리한다.
- 미완료 업로드는 만료 후 정리한다. 성공한 지원서가 참조하는 객체는 정리하지 않는다. 세션 만료·서명 URL 수명과 정리 시점의 관계를 검증한다.
- 원본 정책 지원을 위해 최대 파일 크기를 20 MiB로 맞춘다. 운영 버킷 제한/권한 변경은 대상 환경 사전 점검과 전환 실행 목록에 포함한다.
- `HiringMigrationRecord`는 sourceRef unique, targetModel/targetId unique, 원본·대상 hash와 snapshot/변환 버전을 보관한다. 원본 추가 데이터 보존이 필요한 경우 암호화 snapshot을 사용한다. 평문 고객 데이터는 로그나 Git에 저장하지 않는다.
- 새 테이블은 migration에서 RLS를 활성화하고 익명·일반 로그인 DB API 접근을 허용하지 않는다. 서버 권한으로만 사용한다.

## 2026-10-03 직접 업로드 및 원장 검증 결과

- 직접 업로드 API: 파일 본문을 API로 보내지 않고 브라우저에서 private Storage로 PUT. 선언/실제 크기·MIME 메타데이터 대조, token hash, 항목 대응, 중복 완료 방지.
- 완료 응답이 유실되면 파일/입력 변경보다 기존 제출 결과 확인을 먼저 수행. 완료 세션은 만료 후에도 동일 결과 반환. 400/422 검증 오류에는 입력 수정 가능.
- 미완료 세션은 생성 3시간 후 정리. 매시간 실행, 회당 40초/500개 한도 내 반복 배치, 실패 항목 1시간 backoff. `CronRun.detail`의 failed/remaining/truncated 확인 필요. 운영의 시간 단위 cron 지원과 CRON_SECRET 설정은 배포 전 확인한다.
- 공고 삭제 시 세션의 postingId는 SET NULL로 남아 미완료 객체 정리 근거를 유지. 실제 지원서가 참조하는 파일은 정리하지 않는다.
- 버킷은 private + 정확히 20 MiB 제한을 검사한다. 개발 버킷만 10→20 MiB 변경 완료. 운영은 미변경.
- Aside 실제 브라우저: 합성 12 MiB PUT 200, 동시 complete 2회 모두 201/동일 uuid, 실제 지원서 1건/파일 1건/세션 1건. 이름 암호화 및 JSON 평문 제거 확인. QA 공고/파일/세션 정리 완료.
- 실제 개발 DB 원장: 동시 실행 생성 1건, 재실행 existing, 암호화 snapshot 복원, 고객 수정 충돌, 대상과 원장 동시 rollback 확인. 합성 데이터 정리 완료.
- 파일 복사 helper: 안정 경로, 원본·대상 SHA256/크기, 쓰기 후 재다운로드 확인, 실패 후 재실행 합성 검증. 실제 원본 첨부의 복사/내용 checksum은 아직 수행하지 않았다.
- MIME은 Storage 메타데이터 검증이며 바이너리 내용 판별/악성코드 검사를 뜻하지 않는다.

### 마이그레이션 생성·적용 환경

기존 전체 이력은 빈 shadow DB에서 재생되지 않는다. storage/auth 사전 객체와 `CoupangBackfillStatus` enum 생성 전 ALTER 순서 문제가 있다. 별도 브랜치의 적용 이력 3건도 현재 브랜치에 없었다. 기존 이력을 수정하거나 개발 DB를 reset하지 않았다.

이번 새 테이블만 기존 HEAD 스키마를 baseline으로 만든 임시 로컬 PostgreSQL에서 `prisma migrate dev --name hiring_upload_sessions_and_migration_ledger`로 생성·적용 검증했다. RLS 활성화와 anon/authenticated 권한 회수를 포함한다. 유일한 대기 migration임을 확인한 후 개발 DB에 migrate deploy 적용했다. 전체 이력의 신규 환경 재생 문제는 별도 미해결이다. [신규 검증 환경 초기화 방안](validation-environment-bootstrap.md)에 기존 환경과 분리한 baseline, RLS·Storage·seed 보완 및 전용 배포 이력 절차를 정리했다. SQL 생성만 로컬 검증했으며 신규 Supabase 적용은 미실행이다.

Next.js 16.3.8 및 관련 보안 업데이트 내용은 [런타임 점검](../../../audit/2026-10-03-runtime-security.md)을 참조한다. Next 개발 서버의 AGENTS.md 자동 추가는 `agentRules: false`로 꺼 기존 프로젝트 규칙을 유지한다.

검증 체크포인트: Jest 219 suites / 1,824 tests 통과. 읽기 전용 도구 테스트 8개 통과, 선택 SQL integration 1개 미실행. TypeScript 검사 통과, lint 오류 0/기존 경고 70, Next.js 16.3.8 로컬 production build 통과. 로컬 URL로 빌드한 `.next`는 배포 산출물로 사용하지 않는다.

## 공고 한 건의 검증 적재 계약

- 원본 snapshot·고객/작성자 대응·검증된 자산을 명시적으로 입력받는 순수 상세 변환기와 executor를 분리한다. 원본 ID는 문자열로 유지한다.
- 상세 9종의 순서·제목·줄바꿈·원래 외부 링크를 보존한다. 비활성 섹션은 제외 인덱스를 기록하고 암호화 원문에 남긴다. 잘못된 ID/URL/scene/이미지와 알려지지 않은 유형은 전체 공고를 차단한다.
- scene 원본은 실제 편집기가 사용하는 `file_key` 파일이다. DB `data`가 최신이라고 추정하거나 PNG만으로 편집 가능하다고 판단하지 않는다.
- 공고·직무·매장 연결·상세 블록과 원장을 같은 transaction으로 저장한다. 고객/작성자/매장 소속을 검사하며 source status=0 삭제 공고는 정책 결정 전 보류한다.
- 검증 대상은 DRAFT/알림 false로 강제한다. 원래 공개 상태·시각·추가 필드 원문은 암호화 snapshot으로 보존한다. 추가 근무조건의 텍스트 보존은 구조화 편집 기능과 동일하다고 표현하지 않는다.
- 합성 snapshot으로 첫 실행/반복/실패/수정 충돌을 검증하고 Aside에서 HTML·편집 결과를 확인한다. 실제 고객용 추출·계정 연결과 검증 환경 적재는 별도 확인 단계다.

## 2026-10-03 공고 적재와 지원서 원문 조회 검증

- 공고 상세 9종, 전체 상세 이미지의 선행 순서, 반복 resource의 별도 occurrence, 비활성 섹션 제외 기록을 구현했다. 원본 section과 resource image key 불일치, 외부 URL이 남은 scene, 검증되지 않은 자산은 보류한다.
- executor는 명시적 고객/작성자 대응, 같은 Space의 활성 매장·직무를 검사한다. 공고·직무·매장 연결·상세·암호화 이전 원장을 단일 transaction으로 생성하며 DRAFT/알림 false를 유지한다. 원본 삭제 상태 0은 정책 결정 전 차단한다.
- 편집기 4 MiB 저장 제한을 넘는 디자인은 계획 단계에서 보류한다. 실제 이미지와 SHA256/크기의 일치는 CLI apply에서 확인한다. PNG만 존재하는 자료를 편집 가능한 scene으로 취급하지 않는다.
- Aside 및 실제 개발 DB의 합성 데이터: 첫 실행 created/반복 existing, 11개 상세 block, HTML의 회사 소개·근무조건·담당자·매장·외부 링크, 비활성 내용 제외, 활성 매장과 직무 표시를 확인했다. 디자인 캔버스에 사각형을 추가해 scene/export 이미지 저장을 확인했고, 수정 후 재이전은 충돌로 차단했다. 생성한 공고·지원서·매장·원장·이미지는 정리했다.
- 지원서 상세는 같은 Space의 이전 원장을 서버에서 복호화하고 허용한 항목만 표시한다. 현재 폼으로 과거 선택 라벨을 추정하지 않으며, 숫자/문자열/null/누락을 구분한다. 검증되지 않은 파일 연결은 다운로드로 제공하지 않는다.
- Aside 합성 원문 조회: 해석 미확정 표시, 값 타입·누락 구분, 파일 미확정 표시, 스크립트 텍스트 미실행, 비공개 key 및 내부 원문 속성 미노출을 확인했다. 이 화면 구현은 실제 지원서 배치 적재 완료를 뜻하지 않는다.
- 폼 변환은 기본 이름·연락처를 포함한 공개 접수 최대 50항목 제한을 확인한다. 추가 검사 후 2026-10-03 07:37 UTC 재집계에서도 1,490개 계획 가능/16개 AMBIGUOUS_FIELD 보류였다.

### 준비된 공고 packet CLI

`OpeningPostingPacket`/`OpeningPostingTarget` 계약은 `src/lib/hiring/migration/posting-import.ts`, 자산 계약은 `posting-content.ts`를 따른다. 입력은 `{ "packet": ..., "target": ... }` JSON이며 stdin으로만 받는다. 고객 원문 packet은 Git이나 평문 로그에 저장하지 않는다.

```sh
node scripts/import-opening-posting.mjs --source-space SOURCE_ID --target-space TARGET_ID < /secure/prepared-packet.json
```

기본 실행은 DB 쓰기 없는 계획이다. 합성 packet에서 `PLANNED`, writes=0, 공고 1/직무 1/매장 1/상세 11/비활성 제외 1/폼 2를 확인했다. 실제 자산 다운로드/내용 검증은 이 모드에서 하지 않는다.

적재 모드는 `--apply --target-env /secure/validation.env --expected-project-ref PROJECT_REF`를 추가한다. 대상 설정은 `MIGRATION_ENVIRONMENT=validation`, 해당 프로젝트의 Supabase URL·DB URL·service role key, 64자리 hex `ENCRYPTION_KEY`를 요구한다. 선택적으로 `MIGRATION_CA_FILE`을 제공한다. 프로젝트 참조와 DB 호스트/사용자를 대조하고 평소 `.env.local` 개발 프로젝트 적재는 거부한다. 자산 manifest의 SHA256·byte 크기와 실제 Storage 객체를 먼저 대조한 다음 DB transaction을 실행한다.

CLI는 **이미 준비된 공고 한 건**의 실행기다. 원본 DB 추출·scene 파일 읽기·자산 복사·계정 생성·고객별 일괄 실행은 자동으로 수행하지 않는다. 실제 고객용 apply와 별도 검증 프로젝트 연결은 아직 미실행이다.

최종 변경 검증: Jest 224 suites / 1,908 tests, 콘텐츠 audit·CLI Node tests 11개 통과. 전체 lint 오류 0/기존 경고 70. TypeScript 검사를 포함한 로컬 `next build --webpack` 통과. 기본 Turbopack은 이 실행 환경에서 내부 포트 바인딩 `Operation not permitted`로 실패하여 webpack으로 검증했다. 저장소 빌드 설정은 변경하지 않았다. 기존 Sentry 계측 경고와 Node deprecation 경고가 남는다. 로컬 URL 산출물은 배포에 사용하지 않는다.

## 지원서 한 건의 검증 executor

`src/lib/hiring/migration/application-import.ts`는 이전 공고 원장의 원본 고객/공고 대응과 현재 target hash, DRAFT·알림 비활성을 확인한다. 원장에 기록한 직무 대응과 공고 매장 관계를 검사하고 지원서·파일·원장을 한 transaction으로 만든다. 상태와 표준 PII 대응에는 원본 값·항목 index·명시적 판단 근거를 요구한다. 원래 상태·동의·취소·삭제 시각과 원문은 암호화 snapshot에 유지한다.

파일은 SHA256·크기·안정 경로·원문 항목 대응을 확인한다. 이 executor 자체가 원본 다운로드나 Storage byte 검증을 실행하는 것은 아니므로 사전에 파일 복사 helper와 실제 객체 검증을 거친 입력만 사용해야 한다. 실제 고객 파일 복사는 아직 미실행이다.

실제 개발 DB의 합성 데이터로 created/existing의 동일 ID, PII 암호화, 원문 전용 항목 1개 집계, 고객 수정 후 충돌을 확인했다. 생성한 공고·지원서·원장은 정리했다. 알림 전송과 실제 고객 데이터 적재는 없다.

현재 일반 답변은 이전 원문 화면으로 보존되며 일반 `applicationEntries`에는 자동 투입하지 않는다. 따라서 엑셀·검색·필터까지 동일하게 사용할 수 있다고 판단하지 않는다. executor는 `rawOnlyEntryCount`와 `readyForCutover: false`를 반환한다. 고객별 배치 추출, 검증된 답변 변환, 실제 파일 복사 및 업무 QA를 마친 후에만 전환 판정을 할 수 있다.

## 2026-10-03 07:37 UTC 원본 재집계

대상은 선택 시점 ACTIVE 비체험 유료 고객 18개다. 폼과 콘텐츠는 각각 별도 read-only repeatable-read snapshot이므로 두 결과를 같은 DB snapshot이라고 표현하지 않는다. 고객 원문·ID·키·URL은 출력하지 않았고 현재 IP /32 임시 접근 규칙은 회수 후 잔여 0개를 확인했다.

| 대상      |  전체 | 구조 검사 통과 | 자산 검증 대기 | 보류 |
| --------- | ----: | -------------: | -------------: | ---: |
| 공고 상세 | 1,506 |            327 |          1,109 |   70 |

70개 보류 사유는 `image_source_mismatch` 56개, `missing_file` 14개다. 이는 DB 파일 메타데이터 누락이며 S3 객체 없음으로 단정하지 않는다. 이미지 불일치는 원본 상세가 렌더링하는 image key와 현재 resource 이미지가 다르므로 자동으로 최신 이미지로 바꾸지 않는다.

최초 검사에서 274개 공고의 합법적인 `file_key` 속성을 미지원으로 집계했다. 원본 `Card.vue`는 복사 시 section에 이 값을 저장하지만 편집기는 resource의 `file_url`을 읽고 이후 수정은 section의 image key만 갱신한다. 공개 HTML도 section.file_key를 사용하지 않는다. 따라서 문자열 metadata를 허용하고 원문에 보존하며 오래된 값만 집계하도록 수정했다. section.file_key 713회 중 resource와 다른 값은 624회였지만 이것만으로 이전을 차단하지 않는다. 수정 후 공고 차단은 343→70개로 줄었다.

scene 참조 8,403회, 이미지 참조 9,274회, 전체 상세 이미지 63개, 비활성 섹션 427개다. 참조 횟수는 고유 객체 수가 아니다. scene JSON·내장 이미지·실제 이미지 bytes/checksum·원본 file owner/bucket·동적 관계 텍스트·담당자 복호화·공개 지원 URL·객체 복사·대상 적재는 이 집계의 검증 대상이 아니다. 구조 검사 통과 327개도 고객 전환 가능 판정이 아니다.

폼은 1,506개 중 1,490개 계획 가능/16개 AMBIGUOUS_FIELD 보류를 재확인했다. 이 숫자와 콘텐츠 검사의 통과 숫자를 교집합으로 계산하지 않았다.

지원서 최종 리뷰에서 선택 개인정보 null/누락과 빈 파일(null/빈 문자열/누락/빈 배열)의 정상 적재를 보완했다. 개인정보 배열·객체, 파일 배열 내부의 잘못된 참조와 실제 미대응 key는 계속 차단하며 원본 snapshot의 값 타입은 유지한다.
