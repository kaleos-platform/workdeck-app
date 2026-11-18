# 오프닝 고객 가입 시 자동 대조·이전 계획

작성: 2026-11-18. 브랜치 `feat/opening-auto-migration`(origin/develop 기준).

## 목표

오프닝 고객이 워크덱 계정을 만들면 오프닝 브랜드와 자동 대조하고 이전 계획(dry-run)까지 자동으로 만든다. 운영자가 어드민에서 한 번 승인하면 적용 → 사후 검증 → 보장가 부여 → 완료 메일까지 자동 진행한다.

## 확정된 결정(grill 2026-11-17~18)

| 항목              | 결정                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 자동 범위         | 대조·계획 자동, 적용은 운영자 승인                                                                                                                                                                                                                                                                                                                                        |
| 대조 기준         | 워크덱 인증 이메일(`auth.users.email_confirmed_at` 존재, Google 포함) = 오프닝 활성 브랜드(`brand.status=1`)의 활성 admin(`brand_member.member_type='admin' AND status=1`, `member.status=1`) 회원 이메일. 오프닝은 이메일을 `member.email_hash`(HMAC-SHA256, `OPENING_HMAC_KEY`)로만 비교 가능하므로 워크덱 이메일 변형(원문·trim·lower·trim+lower)의 HMAC으로 일치 판정 |
| 실행 위치         | 맥미니 launchd 워커. 오프닝 RDS는 맥미니 공인 IP만 허용 + 읽기 전용 DB 계정                                                                                                                                                                                                                                                                                               |
| 고객 동의         | 고객이 워크덱 계정을 만든 것이 이전 요청이다(사용자 결정). 운영자 승인 후 완료 메일만 보낸다                                                                                                                                                                                                                                                                              |
| 대상 Space        | 고객이 OWNER인 Space 중 모집 관리(recruiting)가 켜진 가장 오래된 1곳. 매칭 브랜드 2개 이상이면 자동 진행하지 않고 BLOCKED                                                                                                                                                                                                                                                 |
| 승인 채널         | 어드민 「오프닝 이전」 큐 + Slack #agent-dev 알림. 워크덱 DB에는 건수·경고 코드와 연락처 감지 조각만(아래), 원문은 맥미니에만                                                                                                                                                                                                                                             |
| 승인 후           | 한 번 승인으로 원본 재검증 → APPLYING(apply) → 사후 검증 → 보장가 → 완료 메일. 상태별 처리기가 이어받고, 실패 단계에서 멈춤, 혜택·메일은 1회만                                                                                                                                                                                                                            |
| 범위·기간         | 기존 가입자도 첫 실행에 1회 대조. 이미 이전된 브랜드(job backfill)는 제외. 오프닝 종료 시 워커 중지·RDS 접근 회수                                                                                                                                                                                                                                                         |
| 차단(승인 불가)   | 소유권 불일치 자산, 형제 브랜드 자산, 다중 브랜드, 원장 충돌(conflicts), 대상 Space에 기존 모집 공고·템플릿 존재, 대상 Space 없음                                                                                                                                                                                                                                         |
| 표시만(승인 가능) | 디자인 용량 초과 제외, 기간 밖·삭제·제목 없음 제외 건수                                                                                                                                                                                                                                                                                                                   |
| 연락처 감지 항목  | 항목 제목 + 감지 문구 앞뒤 짧은 조각만 어드민(운영자 전용)에 표시, 운영자가 보고 승인. 조각은 DONE 시 삭제(Codex #4 반영, 사용자 결정 11-18)                                                                                                                                                                                                                              |

## 현재 코드·자산 사실

- `scripts/opening-migrate.ts`: `prepare`(원본 읽기 전용) / `import`(기본 dry-run, `--apply`). review.json(items contentHash·images sha·assetScopes)이 승인 근거다. 출력은 건수·고정 코드뿐.
- 원장 `HiringMigrationRecord.sourceRef` 전역 unique(항목 단위) → 재실행 멱등성의 근거. 브랜드 단위 판정에는 못 쓴다(Codex #1).
- `scripts/billing-admin.mjs migrate-grant <spaceId>`: 한 transaction에서 SpaceSubscription upsert, 첫 모집 체험 생성(없을 때), ENDED item lockedPrice upsert. item이 ENDED 아니면 롤백·오류.
- 어드민: `app/admin/*`, `app/api/admin/*`, 모든 핸들러 첫 줄 `requireOperator()`, `AdminAuditLog`.
- 메일: `src/lib/email/`(공용 레이아웃). 지난 완료 메일 본문은 영구 기록 `followup/mail-*.html`.
- **사라진 도구**: 지난 실행의 `verify-migration.ts`, `followup-mails.ts`, `run-*.sh`, `vault-key.cjs`는 `/tmp/opening-pilot`에 있었고 11-17 정리로 삭제됐다. 필요한 기능을 저장소 안 코드로 다시 만든다(아래 3단계).
- 맥미니 워커 관례: `ai.workdeck.sc-worker` 등 launchd plist.

## 설계

### 상태 테이블(스키마 변경 1개)

`OpeningMigrationJob` — **브랜드 단위 예약**(1차 #1). 원장은 항목 단위(sourceSystem·table·id·occurrence)라 브랜드 완료 여부를 알 수 없으므로 브랜드 id를 직접 유일 키로 둔다.

- `id`, `openingBrandId String @unique`, `userId String?`(FK User — backfill 행은 null, 2차 #6), `targetSpaceId String?`
- 다중 브랜드 사용자는 브랜드마다 job이 생기고 모두 `BLOCKED: MULTI_BRAND`.
- `status`: `MATCHED` → `PLANNED` | `BLOCKED` → `APPROVED` → `APPLYING` → `APPLIED` → `GRANTED` → `DONE`, 그 밖에 `GRANT_MANUAL` / `FAILED` / `HELD`
- `summary Json?`(건수·경고 코드·브랜드명만), `blockReasons String[]`
- `contactHitsEnc String?`, `contactHitsIv String?`(연락처 감지 항목별 제목·조각을 `src/lib/crypto/field-crypto.ts`로 암호화 저장 — 원장 스냅샷과 같은 방식. 복호화는 어드민 API에서만. DONE·HELD·FAILED 확정 시 null로 비움)
- `approvedBy String?`, `approvedAt`, `packetDir String?`(APPLYING 때 쓴 packet 경로 — 재개용)
- `approvedSnapshot Json?` — **이전 대상 전체**(2차 #1): packet 파일 단위로 모든 공고·템플릿·매장·직무의 `{kind, sourceId, contentHash}`(packet의 스냅샷 시각 등 실행 메타는 제외하고 정규화한 내용의 sha256) + image sha 집합 + 승인 사용자 id·대상 Space id·원본 admin 매칭 여부. 연락처 review 목록과 별개.
- `applyStartedAt DateTime?`, `grantAt DateTime?`, `mailSentAt DateTime?`, `error String?`(고정 코드만), `attempts Int @default(0)`, `createdAt`, `updatedAt`
- 마이그레이션은 `npx prisma migrate dev --name opening_migration_job`.

브랜드명은 오프닝 측 정보지만 운영자 판단에 필요하므로 summary에 브랜드명만 넣는다(연락처 아님).

**backfill**(2차 #6): 기존 5개 브랜드(1·378·511·484·271)는 영구 기록(`2026-11-17-three-spaces/` 등)의 브랜드→대상 Space 매핑을 원장 `spaceId`와 대조해 `{openingBrandId, targetSpaceId, userId: null, status: DONE, summary.backfilled: true}`로 넣는다. 브랜드 1(피크페이)은 A안(종료만, 기존 이전분 유지)이므로 같은 방식으로 DONE. 브랜드 510(대성산업)은 별도 이전 대상이 아니므로 `HELD`(userId null, summary.reason `SIBLING_OF_511`)로 넣는다. 워커는 시작할 때 이 6개 브랜드 행이 모두 있는지 확인하고, 하나라도 없으면 `BACKFILL_MISSING`으로 중단한다(코드 상수 목록).

### 워커(맥미니, `scripts/opening-auto-migrate.ts` + launchd `ai.workdeck.opening-migrate`)

10분 주기 1회 실행(launchd `StartInterval`, 장기 프로세스 아님). 전역 lock 파일. 한 주기에 job 1건씩, **상태별 처리기**를 차례로 조회해 실행한다(2차 #4·#5). 각 처리기는 조건부 update(`where: {id, status: <기대 상태>}`)로만 전이한다.

| 처리기 | 조회 조건                                                                | 하는 일                                                                                                                                                                                        | 다음 상태                                |
| ------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| match  | 인증 사용자 중 `checked.json`·job에 없는 사용자                          | 오프닝 RDS에서 admin 이메일 일치 활성 브랜드 조회(읽기 전용 트랜잭션). 일치 0 → `checked.json` 기록. 일치 → 브랜드마다 job insert(`openingBrandId` unique 충돌 시 건너뜀 = 이미 예약된 브랜드) | `MATCHED`                                |
| plan   | `MATCHED`, 또는 `BLOCKED` 중 blockReasons = [`NO_TARGET_SPACE`] 뿐인 job | 대상 Space 판정 → **2단계 prepare**(아래) → import dry-run → summary·contactHits·approvedSnapshot 후보 저장                                                                                    | `PLANNED` / `BLOCKED`                    |
| apply  | `APPROVED`, `APPLYING`                                                   | 아래 apply 절차                                                                                                                                                                                | `APPLIED` / `PLANNED`(재승인) / `FAILED` |
| grant  | `APPLIED`                                                                | 보장가(아래)                                                                                                                                                                                   | `GRANTED` / `GRANT_MANUAL`               |
| mail   | `GRANTED`                                                                | 완료 메일(아래)                                                                                                                                                                                | `DONE` / `FAILED`                        |

**2단계 prepare**(코드 확인: `gateContacts`는 review 승인이 없는 연락처 항목을 `HELD_CONTACT_PATTERN`으로 packet에서 빼고, 이미지도 review 승인이 있어야 import가 통과시킨다): ① review-dir만으로 prepare → `candidates.json`(연락처 항목 contentHash·hits, 이미지 sha·owners) ② 차단 사유 없는 연락처 항목 전부 + 소유권 확인된 이미지 전부로 자동 review.json 작성 ③ `--review-file --write-packets`로 다시 prepare → 연락처 항목까지 포함된 packet ④ dry-run. 그래서 큐에 보이는 항목·건수·snapshot은 연락처 항목을 포함한 최종 대상이다. 운영자가 승인하지 않으면 apply가 일어나지 않으므로, 자동 review.json은 "운영자 승인을 전제로 한 후보"다. APPROVED 재검증도 같은 review.json으로 다시 prepare하므로, 내용이 바뀌면 contentHash 불일치(REVIEW_STALE)로 잡힌다.

일치 0 사용자를 `checked.json`에 남기는 전제: 가입 이메일은 바뀌지 않고 오프닝은 신규 가입이 없다(0단계에서 확인).

**apply 절차**

- **권한·원본 재검증(APPROVED·APPLYING 공통, 2차 #2)**: 매번 오프닝 원본에서 admin 이메일 매칭·브랜드 활성, 워크덱에서 승인 사용자가 대상 Space의 OWNER인지 확인한다(importer의 "아무 OWNER 존재" 검사와 별도). 실패 시 쓰기 없이 `FAILED: OWNERSHIP_CHANGED` + Slack. 부분 적용분은 그대로 두고 운영자 판단.
- **APPROVED일 때만**: 원본에서 prepare를 **새로** 실행해 전체 snapshot을 만들고 `approvedSnapshot`과 비교한다(1차 #2, 2차 #1). 대상 Space 기존 모집 공고·템플릿 0건도 확인한다. 하나라도 다르면 승인 폐기 → `PLANNED`(새 summary) + Slack "재승인 필요". 같으면 `APPLYING`(applyStartedAt, packetDir 기록).
- **APPLYING**: `packetDir`의 packet으로 `import --apply`. 재개 시에도 같은 packet을 쓴다 — 파일 복사는 내용 주소 경로 + 기존 파일 해시 검증(`copyMigrationFile` status `existing`), 원장은 항목 단위 unique라 이어서 진행된다(1차 #3). attempts ≤ 3, 초과 시 `FAILED: APPLY_RETRY_EXHAUSTED`. orphan 파일(복사됐지만 원장 없는 파일)은 재실행 시 `existing`으로 재사용되므로 따로 지우지 않는다.
- **사후 검증(2차 #3)**: apply 결과 `refused` 0·`conflicts` 0, 같은 packet으로 dry-run 재실행해 생성 0·refused 0·충돌 0, 그리고 원장에서 대상 Space의 이 브랜드 sourceRef 집합이 `approvedSnapshot`의 대상 항목 집합과 정확히 같아야(targetModel별 건수·식별자) `APPLIED`. 다르면 `FAILED: VERIFY_MISMATCH`.

**보장가**(1차 #5): billing-admin `migrate-grant` SQL을 공용 함수로 분리하고(CLI도 이 함수 사용), 같은 transaction에서 job을 `APPLIED → GRANTED`(grantAt)로 조건부 update한다. 실제 동작: SpaceSubscription upsert, 첫 모집 체험(7일) 없으면 생성, ENDED item에 lockedPrice upsert(재실행 시 같은 값이라 멱등). item이 ENDED가 아니면(이미 유료 구독) 롤백하고 별도 update로 `GRANT_MANUAL` + Slack, 메일 보류. commit 직후 종료되면 job은 이미 `GRANTED`이므로 mail 처리기가 이어받는다. mail 처리기는 시작 시 lockedPrice=12,273·item ENDED를 다시 읽어 확인하고, 다르면 `FAILED: GRANT_NOT_FOUND`.

**완료 메일**: `mailSentAt`이 null일 때만 발송한다. 발송 직전 `mailSentAt`을 먼저 기록하고 Resend 호출 → 성공하면 `DONE`(+ contactHits 비움, review-dir 삭제). `mailSentAt`은 있는데 `GRANTED`로 남은 job(발송 중 종료)은 재발송하지 않고 `FAILED: MAIL_UNCERTAIN` + Slack → 운영자가 Resend 기록으로 확인한다. Resend 오류도 `FAILED: MAIL_FAILED`. 재발송은 운영자 수동.

자동 review.json 규칙: plan 단계 ②에서 생성한다. 승인 대상 = 차단 사유 없는 전 항목(items의 contentHash — 연락처 감지 항목은 어드민에서 조각을 본 운영자 승인으로 포함, 소유권 확인된 images sha). `assetScopes`는 비움(형제·예외 자산은 차단이므로). reviewer = `auto:<jobId>`, 운영자 승인 시 approvedBy를 job에 기록.

원문 보관: `~/.local/share/workdeck/opening-migrations/auto/<jobId>/`(0700) — packets·review·dry-run·apply 결과. 지난 영구 기록과 같은 형식. review-dir(연락처 원문)는 DONE·HELD·FAILED 확정 시 삭제, packets는 보관.

비밀값: 운영 DB URL·Supabase service role·ENCRYPTION_KEY_V1·Resend 키·오프닝 읽기 계정·**오프닝 S3 읽기 자격 증명**(Codex #6)·`OPENING_HMAC_KEY`를 맥미니 키체인에서 읽어 자식 프로세스 환경으로만 넘긴다. ENCRYPTION_KEY_V1은 Vault 사본을 1회 키체인에 저장(운영자 승인 필요).

### 어드민 큐(`app/admin/opening-migrations`, `app/api/admin/opening-migrations`)

- 목록: 사용자 이메일, 브랜드명, 대상 Space, 상태, 건수(공고/템플릿/매장/직무/자산), 경고·차단 코드.
- 버튼: PLANNED → 승인 / 보류(HELD). BLOCKED·FAILED → 보류만(해결은 수동 도구).
- API: `requireOperator()` 첫 줄, 상태 전이 조건부 update(`where: {id, status: 'PLANNED'}`), `AdminAuditLog` 기록.
- 기존 어드민 목록 패턴(users/leads 화면) 재사용. 새 route라 구현 전에 `ui-plan` 와이어프레임으로 합의한다.

### 완료 메일

`src/lib/email/` 공용 레이아웃으로 지난 완료 메일(`followup/mail-511.html`) 내용 이식: 이전 건수, 공고·템플릿 확인, 편집·미리보기·HTML 복사·게시 방법, 보장가 안내. 오프닝 링크·이미지 용량 문장 제외(11-16 사용자 피드백). 발신 `Workdeck <hello@workdeck.work>`, 수신 = Space OWNER(가입자 본인).

## 0단계 결과(2026-11-18, 양쪽 읽기 전용, SG 임시 규칙 철회·잔존 0)

- 오프닝 `member` 컬럼: `email_enc`·`email_hash`·`phone_*`·`name_*`·약관 동의 시각. **이메일 인증 여부 컬럼 없음**. 활성 회원 사이 `email_hash` 공유 0건(회원별 유일), 활성 admin 중 email_hash 없음 0건.
- 오프닝 활성 규모: 활성 브랜드 858, 활성 admin 회원 818, 여러 브랜드를 가진 admin 26.
- 워크덱 인증 사용자 17명(email 13, google 4). 이 중 7명이 오프닝 활성 브랜드 11개와 일치(모두 원문 이메일 그대로 일치 — 정규화 불필요), 여러 브랜드 사용자 2명, 한 브랜드에 여러 사용자 0.
- 일치 브랜드 중 이미 이전 5개(1·271·378·484·511), **새 후보 6개: 134·136·137·211·387·510**. 510(대성산업)은 11-17 결정상 별도 이전 대상이 아니다(511 자산 소유 확인용) → backfill 목록에 `HELD`로 추가. 나머지 5개는 운영자 계정·테스트 브랜드일 가능성이 있어 첫 plan-only 실행에서 브랜드명으로 확인.
- 판단: 지금 워크덱 가입자 중 실제 신규 대상은 많지 않다. 자동화의 가치는 앞으로 가입할 오프닝 고객(활성 브랜드 858)이다. 이메일 인증 여부를 오프닝이 보장하지 않으므로, 오프닝 계정을 남의 이메일로 만든 경우 그 이메일 주인에게 브랜드가 매칭될 수 있다 → 운영자 승인 단계에서 브랜드명·가입자 이메일을 대조하는 것으로 막는다(큐에 둘 다 표시).
- 추가 비밀값: `OPENING_HMAC_KEY`(오프닝 운영 env, S3 `peak-cdk-assets-prod`)를 워커가 써야 한다. 키체인 등록 대상에 추가.

## 단계

0. **사전 확인(읽기 전용, 승인 필요)**: 오프닝 회원 이메일 컬럼·인증 여부 확인, 활성 admin 중 이메일 중복(한 이메일이 여러 회원) 여부, 워크덱 인증 사용자와 일치하는 후보 수. 결과는 건수만 기록.
   **1차 출시(A): match + plan + 어드민 큐 + Slack.** 운영 쓰기는 job 테이블뿐. 첫 고객의 적용은 기존 수동 도구로 사용자 입회하에 진행한다.
   **2차 출시(B): apply·grant·mail 처리기.** A가 운영에서 검증된 뒤.

1. (A) 스키마 + backfill 스크립트 + 워커 시작 시 `BACKFILL_MISSING` 가드 + 상태 전이 순수 함수(`src/lib/hiring/migration/auto-job.ts`) + 단위 테스트.
2. (A) 매칭·대상 Space 판정·차단 분류·2단계 prepare·snapshot 함수 + 단위 테스트(다중 브랜드, Space 없음, 기존 데이터, 이미 이전, 미인증 이메일).
3. (A: match·plan / B: apply·grant·mail) 워커 스크립트: prepare/import 를 함수 호출로 재사용(`opening-migrate.ts` 내부 함수 export), 자동 review 생성, apply·검증·grant(billing-admin 로직을 함수로 분리해 공유)·메일. dev DB + 합성 packet 으로 dry-run 테스트.
4. (A) 어드민 큐 화면·API(ui-plan 합의 후). 승인 버튼은 B 출시 전까지 "수동 적용 대기" 표시만.
5. 인프라(0단계 결과로 방식 확정 후 일괄 승인 요청): 오프닝 RDS 읽기 전용 계정 생성, SG에 맥미니 공인 IP 추가, **오프닝 S3 원본 bucket 읽기 전용 IAM 사용자**(GetObject만, 대상 bucket prefix 한정 — 기존 `peak` profile 재사용 금지) 생성·키체인 저장, 키체인 비밀값 등록, launchd plist 등록. 오프닝 종료 시 모두 회수.
6. 운영 첫 실행: 워커를 `--plan-only`로 1회 실행 → 기존 가입자 대조 결과 큐 확인 → 사용자 보고 → 첫 승인은 사용자와 함께.

## 검증

- 단위: 상태 전이(허용/거부), 매칭 정규화, 차단 분류, 자동 review 생성(차단 자산 미포함), 메일·grant 1회 보장.
- 통합: dev DB에 합성 packet으로 plan → approve → apply → 재 dry-run 생성 0 → grant 멱등 → 메일 dry 모드.
- 실패 주입: 파일 복사 직후·항목 쓰기 직후·각 상태 저장 직후·grant commit 직후·mailSentAt 기록 직후 강제 종료 → 다음 주기 재개로 생성 중복 0·최종 건수 일치, grant 1회, 메일 재발송 0(MAIL_UNCERTAIN). 재개 전 OWNER 제거 → OWNERSHIP_CHANGED·추가 쓰기 0. 승인 후 contact 없는 공고·매장·직무 변경 → 승인 폐기. refused 항목 존재 → APPLIED 미전이. backfill 누락 → 워커 시작 거부. 같은 브랜드 두 사용자 매칭 → job 1건. 승인 후 원본 항목 변경·대상 Space에 공고 추가 → 승인 폐기 확인. grant 대상이 ACTIVE → GRANT_MANUAL·메일 미발송.
- S3: 이미지 포함 합성 fixture로 실제 prepare 경로(새 IAM 자격 증명) 검증.
- 어드민 API: 비운영자 404, 상태 경쟁(두 번 승인) 1회만 반영.
- `npm run lint`, `tsc`, migration 테스트 전체, `npm run build`.
- 운영: 첫 실행은 plan-only, 첫 apply는 사용자 입회.

## 위험과 대응

- **오매칭으로 다른 고객 데이터 이전**: 인증 이메일 정확 일치 + 다중 브랜드 차단 + 운영자 승인 3중. 오프닝 이메일이 인증되지 않은 값이면(0단계에서 확인) 추가 조건 필요 → 그때 재논의.
- **상시 RDS 접근**: 읽기 전용 계정·단일 IP·TLS(CA 고정). 오프닝 종료 시 회수. 공인 IP 변경 시 연결 실패 → Slack 알림(조용한 실패 금지).
- **맥미니에 운영 비밀값 상주**: 키체인 보관, 파일·로그 출력 금지. 워커 로그는 고정 코드·건수만.
- **이중 실행**: lock 파일 + 조건부 상태 전이 + 원장 unique + grantAt/mailSentAt 선기록.
- **계획과 적용 사이 원본 변경**: apply 직전 원본 새 prepare + approvedSnapshot 비교 → 다르면 승인 폐기·재승인.
- **이미지 안 글자(연락처 등)**: 자동 review가 소유권 확인된 이미지를 모두 승인하므로 이미지 속 글자는 운영자가 보지 않는다. 고객 자신의 브랜드 소유 이미지이고 지난 수동 이전에서도 글자 검사는 불가능했다(prepare 경고와 같음)는 점에서 위험을 받아들인다(코드 리뷰 P1, 11-18).
- **고객이 이미 공고를 만든 Space**: 차단(덮어쓰기·섞임 방지). 운영자가 수동 판단.

## 롤백

- 코드: 워커 launchd 언로드로 즉시 중지. 어드민 화면은 남아도 무해.
- 스키마: 신규 테이블만 추가 — 롤백 시 drop 마이그레이션.
- 데이터: 적용된 이전은 지난 운영과 같이 원장 기준으로 대상 행 확인 후 수동 정리(고객 수정 여부 대조). 일괄 삭제 금지.
- 인프라: SG 규칙 삭제, 읽기 계정 drop, 키체인 항목 삭제.

## 범위 밖

지원자·계정 이전, 공고 자동 게시, 오프닝 원본 수정·삭제, 고객 화면 내 이전 안내 UI.

## Codex 적대적 검토(2026-11-18) — 지적 6건: 반영 6, 보류 0

1. 브랜드 단위 판정 불가 → `openingBrandId @unique` job + 기존 5개 브랜드 backfill.
2. planHash로 원본 변경 감지 불가 → apply 직전 원본 새 prepare + approvedSnapshot 비교, 다르면 승인 폐기.
3. 부분 적용 복구 없음 → APPLYING 상태 + 같은 packet 재실행 재개(파일 `existing` 검증·원장 항목 unique), attempts 상한, 실패 주입 테스트.
4. 연락처 자동 승인 → 감지 조각을 운영자 전용 큐에 표시하고 보고 승인(사용자 결정), DONE 시 삭제.
5. 보장가 실제 동작 불일치 → grant SQL 함수화 + job 상태와 같은 transaction, ACTIVE면 GRANT_MANUAL·메일 보류, commit 후 재확인.
6. S3 자격 증명 누락 → 오프닝 bucket 읽기 전용 IAM 사용자·키체인, 이미지 fixture 검증.

## Codex 적대적 검토 2차(2026-11-18) — 지적 6건: 반영 6, 보류 0

1. snapshot이 연락처 review 목록뿐 → 모든 공고·템플릿·매장·직무 정규화 내용 해시 + image sha 전체 snapshot.
2. 재개 시 소유권 재검증 없음 → APPROVED·APPLYING 공통으로 승인 사용자 OWNER·원본 admin 재확인, 실패 시 OWNERSHIP_CHANGED로 쓰기 중단.
3. refused 항목 누락을 성공 처리 → refused 0 + 원장 sourceRef 집합과 snapshot 대상 집합 일치를 APPLIED 조건으로.
4. APPLIED·GRANTED 재개 처리기 없음 → 상태별 처리기 표(grant=APPLIED, mail=GRANTED), mailSentAt 선기록 후 종료는 MAIL_UNCERTAIN.
5. 예약과 plan 건너뛰기 충돌 → unique는 match insert에만, plan은 MATCHED·NO_TARGET_SPACE만 조회.
6. backfill userId 불가 → userId nullable, 영구 기록·원장으로 대상 Space 검증, 5개 미완료 시 워커 시작 거부.

## 5단계 인프라 확정(2026-11-18) — `scripts/opening-worker/`

- `setup.sh sg|db|iam|secrets|verify|launchd|revoke` 단계별 실행. 관리자 자격 증명(`peak` 프로필·오프닝 운영 env)은 이 스크립트 안에서만 쓴다.
- DB: 전용 역할 `workdeck_opening_reader` — 같은 이름 역할은 소유 객체·다른 DB 접근이 없을 때만 지우고 재생성, 12개 테이블 SELECT + member(id·status·email_hash), read-only 기본값·statement_timeout.
- S3: IAM `workdeck-opening-reader` — 워커가 읽는 target_type 4종의 `storage/첫경로/*` GetObject 만. 키 ID·secret 은 키체인 단일 JSON 항목.
- SG: 설명 `workdeck-opening-auto-worker` 규칙을 현재 공인 IP 하나만 유지.
- 비밀값은 키체인(`workdeck-opening-worker.*`), `security -i` stdin 으로 저장(argv 미노출). `run.sh` 가 실행 때만 환경으로 넘긴다.
- `verify`: 카탈로그 유효 권한(쓰기 테이블·컬럼 0, 허용 밖 읽기 컬럼 0, CREATE 0, 멤버십 0, 승격 없음) + target_type prefix 별 S3 읽기.
- `revoke`: 원격 회수가 모두 확인돼야 키체인을 지운다.
- Codex 적대적 검토 7회(지적 16건 반영, 소유권 이전 경쟁 1건은 ponytail 주석으로 수용) — 마지막 approve.
