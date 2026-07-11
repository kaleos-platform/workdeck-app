# 워크덱 전체 코드베이스 감사 보고서

- **일자**: 2026-07-05
- **감사 기준**: `origin/develop` @ `9372d5e` (감사 시점 최신 배포 라인)
- **방법**: 영역별 finder 에이전트 14개 병렬 스캔 → 발견 항목별 적대적 검증(반박 시도) → 커버리지 크리틱 → High 전건 메인 세션 코드 재확인. 총 136 에이전트.
- **범위**: 4개 Deck(seller-ops, finance, coupang-ads, sales-content) + 플랫폼(인증·워커·cron) + 날짜/금액 횡단 검사. 페이지 86개 / API 라우트 229개 / 손코딩 약 12만 라인.
- **결과**: 발견 121건 중 **확정 97건** (High 10 / Medium 46 / Low 41), 오탐 기각 24건. 검증 단계에서 finder의 critical 주장은 전부 High 이하로 하향됨(유니크 제약·재시도 경로 등 상류 방어 확인).

> 항목의 라인 번호는 `origin/develop@9372d5e` 기준이다. 코드 수정은 하지 않았다(분석·보고만).

## 요약 — 반복되는 구조적 패턴 6가지

개별 버그보다 중요한 것은 같은 패턴이 여러 영역에서 반복된다는 점이다. 패턴 단위로 고치면 수십 건이 함께 해소된다.

1. **delete → insert 비원자 패턴**: 기존 데이터를 지운 뒤 트랜잭션 없이 재삽입 — 중간 실패 시 데이터 소실. (`upload-processor.ts`, `inventory-upload-processor.ts`, `reconciliation-processor.ts` 매핑, ads 캠페인 delete+insert 등)
2. **KST/UTC 날짜 경계 혼용**: `new Date(param)` + `setHours()`(서버 로컬=UTC)와 `T00:00:00+09:00` 방식이 혼재 — 하루 밀림/월 버킷 오분류. (`product-trends`, finance `yearMonth()`, `sales-by-option`, `revenue`, `export` 등)
3. **상태 전이 ↔ 재고 원장 비동기화**: 생산차수 상태를 되돌려도 INBOUND 이동은 역산되지 않음 — 역행 후 재전환 시 재고 이중 계상. (production-runs transition 3건, 재고대조 cancel)
4. **부분 실패 무음 처리**: 루프 안 try/catch가 오류를 삼키고 성공처럼 응답 — 사용자가 실패 항목을 알 수 없음. (재고대조 confirm, Slack 알림, 배치 처리 다수)
5. **파일 업로드 크기/형식 가드 불일치**: 일부 라우트만 10MB 가드, 무거운 파싱 경로(`sh/shipping/import` 암호화 xlsx 포함) 다수는 무제한.
6. **워커 인증의 단일 테넌트 가정**: `x-workspace-id` 부재 시 `findFirst()` 첫 워크스페이스 폴백, credentials `findFirst({isActive:true})` — 멀티테넌트 확장 시 데이터 오염 경로.

## High 10건 한눈에

| # | 영역 | 위치 | 문제 |
|---|---|---|---|
| 1 | 쿠팡광고 | `src/lib/upload-processor.ts:123` | 광고 레코드 delete→insert 비원자, 중간 실패 시 기간 전체 데이터 소실 |
| 2 | 쿠팡광고 | `app/api/campaigns/[campaignId]/product-trends/route.ts:44` | 날짜 필터가 UTC 기준 — 상품 트렌드가 항상 KST 하루 밀림 |
| 3 | 쿠팡광고 | `src/lib/upload-processor.ts:121` | "중복 제외" 선택도 실제로는 기존 데이터 전체 삭제 후 교체 — UI 약속과 반대 동작 |
| 4 | 쿠팡광고 | `app/api/collection/credentials/route.ts:11` | ENCRYPTION_KEY 미설정 환경(preview 확인됨)에서 쿠팡 비밀번호 평문 저장 |
| 5 | 재고동기화 | `prisma/schema.prisma:994` | InvMovement.referenceId 유니크 제약 없음 — 동시 실행 시 OUTBOUND 중복 생성·재고 이중 차감 |
| 6 | 재고동기화 | `src/lib/inventory-upload-processor.ts:80` | 재고 스냅샷 재업로드 시 구 데이터 삭제 후 삽입 실패하면 복원 불가 |
| 7 | 생산 | `app/api/sh/production-runs/[runId]/transition/route.ts:159` | STOCKED_IN 전환 INBOUND가 옵션별 개별 트랜잭션 — 부분 실패 시 재고·상태 불일치, 재시도 시 이중 입고 |
| 8 | 생산 | 같은 파일 `:223` | STOCKED_IN→ORDERED→STOCKED_IN 역행·재전환을 서버가 허용 — 재고 이중 추가 |
| 9 | 생산 | 같은 파일 `:231` | STOCKED_IN→PLANNED 회귀 시 표시값만 초기화, 실제 재고는 롤백 안 됨 |
| 10 | 배송 | `app/api/sh/shipping/orders/[orderId]/items/[itemId]/match/route.ts:88` | option/listing 재매칭 시 이전 manual fulfillment 미삭제 — 다음 임포트부터 잘못된 자동 매칭 |

특히 **7·8·9는 같은 파일의 동일 계열 결함**으로, "생산차수 상태 전이와 재고 원장의 정합성"을 한 번에 재설계(전이 가드 + 역행 시 reverseMovement 또는 역행 금지)하는 것이 효율적이다.

## 추가 확인 권고 (커버리지 크리틱 — 미검증, 후속 조사 대상)

1. `app/api/finance/export/route.ts` — `findMany`에 `take` 상한 없음(대량 스페이스 OOM/타임아웃) + from/to 경계 UTC 파싱(KST 하루 밀림 패턴).
2. `app/api/sh/shipping/aliases/bulk-import/route.ts` — 최대 5,000항목 × 2쿼리 순차 루프, 트랜잭션 없음 — 타임아웃·부분 반영.
3. `app/api/sc/insights/generate/route.ts` — 워커 경로에서 `x-workspace-id` DB 존재 검증 없이 LLM 파이프라인 트리거 가능.
4. `app/api/sh/inventory/import/route.ts` — 파일 크기 가드 없음(다른 라우트에서 확정된 패턴과 동일).
5. `src/lib/workspace.ts:29` — `user.upsert`가 트랜잭션 밖 + 트랜잭션 내 findUnique→create — 동시 가입 시 unique 위반 가능(크리틱이 코드 확인).
6. `app/api/execution/tasks/route.ts` POST의 `campaignId` 미검증 — 크리틱은 cross-tenant로 지목했으나 campaignId가 외부 쿠팡 캠페인 ID 문자열(FK 아님)로 보여 영향은 제한적일 가능성. 확인 필요.

---

## 1. High — 우선 수정 권고 (10건)

모든 High 항목은 메인 세션이 origin/develop 실제 코드로 재확인했다.

#### Non-atomic delete+insert in upload processor — data loss on crash

- **위치**: `src/lib/upload-processor.ts:123` · **분류**: 데이터 무결성 · **영역**: 쿠팡광고 캠페인
- **문제**: The upload flow executes AdRecord.deleteMany (line 123), then ReportUpload.create (line 133), then up to N sequential AdRecord.createMany chunks (line 179–182) outside any database transaction. If the process crashes or the DB connection drops after the delete but before all chunk inserts complete, the campaign's ad records for the entire period are permanently gone with no ReportUpload entry to indicate what happened.
- **트리거**: Any file upload with overwrite=true or overwrite=false (user confirms overwrite) on a file that contains 2001+ rows, or any transient DB error / OOM / deployment restart during the chunk loop.
- **사용자 영향**: All historical ad records for the affected campaign and date range are silently deleted with no way to recover them. The upload UI returns an error, but the data is already gone.
- **수정 방향**: Wrap lines 121–182 in a prisma.$transaction() with appropriate timeout, or use a two-phase approach: insert new records first (with a staging flag), then atomically swap/delete within a transaction.
- **검증 노트**: 사실관계는 정확하나 critical은 과대평가. 파싱이 삭제 전에 완료되므로 삭제 후 실패는 대부분 일시적 장애이고 같은 파일 재업로드로 데이터가 복원됨(신규 파일이 기존보다 좁은 범위일 때만 실손실). "복구 불가·흔적 없음" 주장은 delete→ReportUpload.create 사이 좁은 창에만 해당. 원자성 결함 자체는 실재하므로 high가 적절.

#### product-trends date range uses server local time instead of KST

- **위치**: `app/api/campaigns/[campaignId]/product-trends/route.ts:44` · **분류**: 버그 · **영역**: 쿠팡광고 캠페인
- **문제**: When fromParam/toParam are provided, currentStart is built as `new Date(fromParam)` followed by `currentStart.setHours(0,0,0,0)`. On a UTC server (Vercel production), this sets midnight UTC. AdRecords are stored as KST midnight (`T00:00:00+09:00` = `T15:00:00Z` previous day in UTC). A query with `gte: 2024-01-15T00:00:00Z` will miss all KST Jan 15 records (stored as `2024-01-14T15:00:00Z`) and instead capture KST Jan 16 records. Every other endpoint in the codebase uses `new Date(param + 'T00:00:00+09:00')`. The fallback period path (line 50–57) has the same bug.
- **트리거**: Any user viewing the Product Trends tab on a production (UTC) server with an explicit date range filter, or the default period-based view.
- **사용자 영향**: Product trends data is shifted by one KST day: the first day of the selected range shows no data and the last KST day's data appears as if belonging to the next day. ROAS and order trends are therefore wrong for every request.
- **수정 방향**: Replace `new Date(fromParam)` + `setHours(0,0,0,0)` with `new Date(fromParam + 'T00:00:00+09:00')` and `new Date(toParam + 'T23:59:59+09:00')` consistent with all other API endpoints.

#### overwrite=false is functionally identical to overwrite=true — 'skip duplicates' misleads users

- **위치**: `src/lib/upload-processor.ts:121` · **분류**: UX · **영역**: 쿠팡광고 캠페인
- **문제**: Both `overwrite === true` and `overwrite === false` trigger `adRecord.deleteMany` for the period and affected campaigns (line 121–130), then reinsert everything from the file. The `skipDuplicates: true` in `createMany` (line 180) only deduplicates rows within the uploaded file itself against the DB unique constraint — but since existing DB records were already deleted, there is nothing to skip. Users who click 'skip duplicates / keep existing data' get exactly the same result as users who click 'overwrite', believing their old data is preserved while it is silently replaced.
- **트리거**: User sees the duplicate confirmation dialog and chooses the 'skip duplicates' option (overwrite=false).
- **사용자 영향**: Users believe their existing records are preserved, but all campaign records in the date range are replaced. Manual corrections or entries in the original data are overwritten without warning.
- **수정 방향**: For overwrite=false, do not delete existing records first. Instead, use skipDuplicates-only insertion to add genuinely new rows while leaving existing rows untouched. Rename the UI option to make the delete+reinsert behavior explicit if the current approach is intentional.
- **검증 노트**: 사용자가 선택한 행동(기존 데이터 보존)이 실제로는 반대(데이터 교체)로 수행되므로, 단순 UX 오해가 아니라 경고 없는 데이터 유실 버그입니다. medium → high 상향이 적절합니다.

#### ENCRYPTION_KEY 미설정 시 쿠팡 자격증명 평문 저장

- **위치**: `app/api/collection/credentials/route.ts:11` · **분류**: 권한/격리 · **영역**: 쿠팡광고 수집·실행
- **문제**: encryptPassword()에서 process.env.ENCRYPTION_KEY가 없으면 비밀번호를 평문 그대로 loginPassword 컬럼에 저장하고 encryptionIv='none'으로 저장한다. 이 분기는 '개발 환경'이라고 주석되어 있지만 env var을 빠뜨린 프리뷰/운영 배포에서도 동일하게 동작하는 안전장치가 없다. 메모리에도 preview ENCRYPTION_KEY 미설정 이슈가 별도로 기록되어 있어 실제 발생 가능성이 확인된다.
- **트리거**: ENCRYPTION_KEY 환경변수가 설정되지 않은 환경(preview 포함)에서 사용자가 쿠팡 자격증명을 저장할 때
- **사용자 영향**: 쿠팡 로그인 아이디·비밀번호가 DB에 평문으로 저장되어 DB 유출 시 자격증명 즉시 노출. 기존에 저장된 평문 값을 후속 복호화 시 오류 없이 그대로 반환하여 워커가 평문을 비밀번호로 사용하므로 로그인은 동작하지만 보안 침해 상태가 지속됨.
- **수정 방향**: ENCRYPTION_KEY가 없으면 즉시 오류를 반환하고 저장하지 않도록 변경: if (!key) throw new Error('ENCRYPTION_KEY is required'). 프로덕션 배포 전 env var 존재 여부를 startup check에서 검증.
- **검증 노트**: critical→high: 악용에는 env 미설정 + DB 유출이라는 2중 전제가 필요하고 prod는 ENCRYPTION_KEY가 설정되어 워커 복호화가 정상 동작 중. preview는 실제 키 미설정이 확인되나 테스트 계정 정책으로 실계정 노출 범위 제한. 또한 분류는 authz가 아니라 crypto/data-protection이 정확.

#### InvMovement.referenceId에 DB 유니크 제약 없음 — 동시 실행 시 동일 옵션×일자 OUTBOUND 중복 생성 및 재고 이중 차감

- **위치**: `prisma/schema.prisma:994` · **분류**: 데이터 무결성 · **영역**: 쿠팡 판매→재고 동기화
- **문제**: InvMovement 모델의 referenceId 필드(line 994)는 Nullable String이며 @@unique 제약이 없다(모델 인덱스: line 1008~1012 — 모두 @@index만 존재). upsertOutboundMovement(coupang-sales-to-movement.ts:244)는 findFirst로 기존 레코드를 조회한 뒤 없으면 create 하는데, findFirst와 create 사이에 referenceId에 대한 DB 레벨 잠금이 없다. lockStockLevel(line 256)은 InvStockLevel 행만 잠근다.
- **트리거**: 동일 spaceId에 대해 coupang-sales-sync cron이 동시에 2회 이상 실행(cron 재시도, 백필 범위와 일일 sync 겹침, 수동 호출 중복)되면 두 트랜잭션이 각각 findFirst → existing=null → create 경로를 밟아 같은 referenceId로 InvMovement 2건이 생성된다.
- **사용자 영향**: 같은 옵션×일자의 OUTBOUND가 2건 존재하면 재고가 두 배로 차감된다. InvStockLevel이 음수로 떨어지거나 실제보다 낮은 재고가 모든 발주 예측·재고 부족 알림에 영구적으로 반영된다. 재고 ledger는 자동 복원 수단이 없어 수동 조정 전까지 손상 상태가 유지된다.
- **수정 방향**: prisma/schema.prisma InvMovement에 @@unique([referenceId]) 또는 @@unique([referenceId, type])을 추가해 DB가 중복을 거부하게 한다. findFirst 전에 SELECT FOR UPDATE (lockStockLevel처럼 raw query)를 referenceId에도 적용하거나, Prisma upsert를 사용하도록 리팩터링한다.
- **검증 노트**: critical→high 하향. 레이스 자체는 실재하나 (1) 호출자가 단일 워커의 순차 체이닝이라 동시 실행은 수동 트리거 겹침·재시도 등 예외 경로에서만 발생, (2) 재고 수치는 설계상 수동 대조 절대값 set(coupang-sales-to-movement.ts:16 주석)으로 복구 가능, (3) stock 행 미존재 최초 케이스는 InvStockLevel optionId_locationId 유니크가 T2를 P2002로 실패시켜 부분 방어. 단 중복 InvMovement 행과 발주예측 수요 이중 계산은 수동 삭제 전까지 영구 잔존.

#### 재고 재업로드 시 이전 스냅샷 삭제 후 배치 삽입 실패 → 영구 데이터 손실 (트랜잭션 없음)

- **위치**: `src/lib/inventory-upload-processor.ts:80` · **분류**: 데이터 무결성 · **영역**: 쿠팡 판매→재고 동기화
- **문제**: processInventoryUpload(line 20~169)는 같은 (workspaceId, snapshotDate, fileType)의 이전 InventoryRecord/InventoryUpload를 line 85~91에서 먼저 삭제한 뒤, line 97~144에서 청크 배치로 새 레코드를 삽입한다. 이 두 단계는 단일 Prisma 트랜잭션 안에 없다. 삽입 실패 시 catch(line 146~154)에서 새 업로드 레코드만 정리하지만, 이미 삭제된 이전 데이터는 복원되지 않는다.
- **트리거**: 동일 스냅샷 날짜의 재업로드(덮어쓰기) 도중 DB 타임아웃, 제약 위반, 연결 끊김 등으로 배치 삽입이 실패하면 발생. 특히 10k+ 행 파일에서 중간 배치에 오류가 생길 경우.
- **사용자 영향**: 해당 snapshotDate의 INVENTORY_HEALTH 또는 VENDOR_ITEM_METRICS 데이터 전체가 사라진다. 재고 분석, 발주 예측, 재고 부족 알림 모두 해당 날짜 이후 스냅샷을 잃는다. 사용자는 재업로드가 실패했음을 알지만 데이터 복구 수단이 없다.
- **수정 방향**: 삭제(line 85~91)와 배치 삽입(line 97~144) 전체를 prisma.$transaction(async (tx) => { ... })으로 감싸 원자성을 보장한다. 단일 트랜잭션이 너무 길면 새 upload 레코드에 먼저 신규 데이터를 삽입한 뒤, 성공 시에만 이전 데이터를 삭제하는 순서(write-then-delete)로 바꾼다.
- **검증 노트**: critical→high: 손실 범위가 단일 (snapshotDate, fileType)에 한정되고, 파싱은 이미 성공한 상태라 삽입 실패는 일시적 DB 오류일 가능성이 높으며 원본 Excel 재업로드로 복구 가능. '영구 손실'은 원본 파일까지 유실된 경우에만 성립. 다만 delete-before-insert 무트랜잭션 구조 자체는 실재하는 data-integrity 결함.

#### STOCKED_IN 전환 시 INBOUND 처리가 비원자적 — 부분 실패 시 재고·상태 불일치

- **위치**: `app/api/sh/production-runs/[runId]/transition/route.ts:159` · **분류**: 데이터 무결성 · **영역**: 상품·리스팅·생산
- **문제**: STOCKED_IN 전환 시 각 옵션×위치 조합마다 `processMovement`를 별도 트랜잭션으로 순차 호출한다. N번째 movement가 성공하고 N+1번째가 실패하면, 이미 커밋된 INBOUND 재고는 롤백되지 않지만 productionRun.status는 여전히 ORDERED로 남는다. 이후 재시도하면 동일 옵션에 재고가 중복 추가된다. 코드 주석에서도 '부분실패 노출 구조' 라고 자인하고 있다.
- **트리거**: 입고 위치가 2개 이상이거나 옵션이 여러 개인 STOCKED_IN 전환 중 DB 오류 또는 네트워크 타임아웃이 발생할 때
- **사용자 영향**: 일부 옵션에는 재고가 추가되고 다른 옵션에는 추가되지 않은 채 생산 차수는 '진행중' 상태에 머문다. 재시도 시 이미 처리된 옵션에 재고가 이중 추가되며, 실제 재고 수치가 현실과 어긋난다.
- **수정 방향**: 모든 processMovement 호출을 단일 상위 트랜잭션 내에서 실행하거나, processMovement가 트랜잭션 클라이언트를 받을 수 있도록 확장하여 상태 업데이트와 모든 INBOUND를 원자적으로 묶는다.
- **검증 노트**: critical→high: 트리거가 movement 루프 도중의 일시적 DB/네트워크 장애로 확률이 낮고, InvMovement 원장의 referenceId(prodrun:...)로 사후 탐지·수동 복구가 가능함. 다만 발생 시 무음 재고 오염 + 사용자 재시도로 이중 입고되는 실제 결함이므로 high는 유지.

#### STOCKED_IN → ORDERED → STOCKED_IN 경로로 재고 이중 추가 가능

- **위치**: `app/api/sh/production-runs/[runId]/transition/route.ts:223` · **분류**: 데이터 무결성 · **영역**: 상품·리스팅·생산
- **문제**: 서버는 STOCKED_IN 상태의 차수를 ORDERED로 되돌리는 것을 허용하며(lines 223–244, 단순 status 업데이트만 수행), 이후 다시 STOCKED_IN으로 전환하면 INBOUND processMovement가 재실행된다. UI의 상태 전환 드롭다운(production-runs-table.tsx:175)은 현재 상태를 제외한 나머지 두 상태를 모두 노출하므로, 정상 UI를 통해 이 경로를 밟을 수 있다. 서버에는 '이미 STOCKED_IN이었던 차수를 ORDERED로 역행 후 재전환 차단' 로직이 없다.
- **트리거**: 운영자가 STOCKED_IN 차수의 상태 드롭다운에서 '발주완료'를 선택한 뒤 다시 '입고완료'로 전환하는 경우
- **사용자 영향**: 동일 옵션에 재고가 두 배로 추가되어 재고 수치가 실제보다 많게 집계된다. 이중 입고 여부를 감지할 수단이 없어 발주·안전재고 계산이 전부 오염된다.
- **수정 방향**: transition API에서 현재 status가 STOCKED_IN이고 목표 status가 ORDERED인 경우를 별도로 처리하여 재고 역행 처리(OUTBOUND) 또는 전환 차단을 구현한다.
- **검증 노트**: critical → high 하향. 이중 입고는 실재하지만 (1) 운영자의 명시적 UI 조작 2회가 필요하고, (2) INBOUND movement가 reason/referenceId(`prodrun:...`)와 함께 기록되므로 이동 이력으로 사후 감지·복구가 가능함. '감지 수단이 전무하다'는 주장은 과장 — 자동 가드는 없으나 감사 흔적은 남음. 다만 잘못 입고한 차수를 되돌려 재입고하는 것은 자연스러운 정정 시도라 실제 발생 가능성이 높아 high 유지.

#### STOCKED_IN → PLANNED 회귀 시 재고 역행 없이 stockedInQty만 초기화

- **위치**: `app/api/sh/production-runs/[runId]/transition/route.ts:231` · **분류**: 데이터 무결성 · **영역**: 상품·리스팅·생산
- **문제**: PLANNED 회귀 처리(lines 231–244)는 `productionRunItem.stockedInQty`와 `productionRunSet.stockedInSetQty`를 null로 초기화하지만, STOCKED_IN 전환 시 적재된 `invStockLevel`과 `invMovement` 레코드는 그대로 남는다. 즉 UI 표시(실입고량)만 지워지고 실제 재고 수치는 롤백되지 않는다.
- **트리거**: STOCKED_IN 상태 차수의 드롭다운에서 '계획중'을 선택하는 경우(UI가 이 전환을 허용함)
- **사용자 영향**: PLANNED로 되돌린 차수의 재고가 시스템에 그대로 남아 실제 입고 수량보다 재고가 많게 집계된다. 이후 재입고 처리 시 재고가 다시 추가되어 이중 계상된다.
- **수정 방향**: PLANNED 회귀 시 기존 STOCKED_IN에서 생성된 movement의 referenceId(`prodrun:{id}:*`)를 조회하여 각 optionId×locationId에 OUTBOUND 역행 movement를 생성하거나, 해당 movement를 취소 처리한다.
- **검증 노트**: 심각도 high 그대로 확정. 추가로 STOCKED_IN → ORDERED 회귀는 stockedInQty 초기화조차 하지 않아 동일 계열 갭이 하나 더 있고, DELETE 핸들러([runId]/route.ts:266-281)도 movement를 남긴 채 run만 삭제함 — 수정 시 함께 다룰 것.

#### option/listing 재매칭 시 이전 수동(manual) alias fulfillment 미삭제 — 다음 임포트에서 잘못된 자동 매칭

- **위치**: `app/api/sh/shipping/orders/[orderId]/items/[itemId]/match/route.ts:88` · **분류**: 데이터 무결성 · **영역**: 배송
- **문제**: `PATCH .../match` 에서 'option' 모드(line 230)와 'listing' 모드(line 88)로 alias를 저장할 때 `channelProductAlias.upsert`만 호출하고 기존 `ChannelProductAliasFulfillment` 레코드를 삭제하지 않는다. 반면 'manual' 모드(line 178)는 `deleteMany` 후 재생성한다. ChannelProductAlias 우선순위는 fulfillments > listingId > optionId이므로(import/route.ts line 213), 이전에 수동 매칭된 alias에 fulfillment가 남아 있으면 새 optionId/listingId가 무시된다.
- **트리거**: 상품 A를 manual 모드로 매칭(fulfillment 생성) → 이후 같은 상품을 option 또는 listing 모드로 재매칭 → 다음 파일 임포트 시 buildAliasLookup이 stale fulfillment를 발견하고 새 optionId 대신 이전 수동 구성으로 매칭한다.
- **사용자 영향**: 사용자가 매칭을 수정했음에도 다음 임포트부터 잘못된 옵션으로 자동 매칭된다. 출고 수량 계산 오류로 실재고와 괴리 발생.
- **수정 방향**: 'option'과 'listing' 모드의 alias upsert 후에 `channelProductAliasFulfillment.deleteMany({ where: { aliasId: alias.id } })`를 호출한다. 이를 같은 트랜잭션 내에서 처리해 일관성 확보.
- **검증 노트**: 심각도 정정 불필요 — 주장대로 high가 타당. 무음(silent) 데이터 정합성 손상이며 사용자 수정 행위가 오히려 트리거가 되는 패턴. 수정은 option/listing 모드 alias upsert 트랜잭션에 manual 모드와 동일한 channelProductAliasFulfillment.deleteMany({ where: { aliasId } }) 추가로 간단함.

## 2. Medium (46건)

### 쿠팡광고 캠페인 (ads-campaigns)

#### Campaign DELETE transaction omits ProductStatus cleanup — orphaned rows

- **위치**: `app/api/campaigns/[campaignId]/route.ts:82` · **분류**: 데이터 무결성 · **영역**: 쿠팡광고 캠페인
- **문제**: The DELETE handler wraps cleanup in a $transaction that deletes adRecords, reportUploads, dailyMemos, campaignMetas, keywordStatuses, and campaignTargets — but not ProductStatus records. After campaign deletion, ProductStatus rows for (workspaceId, campaignId, productName, optionId) are orphaned in the database. If the user re-uploads data for the same campaign ID later (which is possible since campaignId comes from the external Coupang system), all previously marked 'removed' products will re-appear with their old removedAt timestamps, corrupting product analysis displays.
- **트리거**: Any campaign deletion followed by a re-upload of any data containing the same campaignId.
- **사용자 영향**: Product items the user has never marked as removed may appear as 'removed' in the Product Analysis tab, causing incorrect ROAS/cost analysis filtering and incorrect display.
- **수정 방향**: Add `tx.productStatus.deleteMany({ where: { workspaceId: workspace.id, campaignId } })` inside the existing $transaction block alongside the other cleanup steps.
- **검증 노트**: 진짜 결함이지만 high는 과대평가. 영향은 (a) 고아 행 잔존(용량/정합성 문제만), (b) 동일 campaignId 재업로드 시 과거 '제거' 플래그 재적용 — 표시/필터링 오류이며 원본 광고 데이터 손상·손실은 없음. 사용자가 product-status DELETE 엔드포인트로 개별 해제 가능해 복구 가능. 트리거도 삭제 후 동일 캠페인 재업로드라는 특정 시퀀스 필요. data-integrity 분류는 타당하나 medium이 적절.

#### Duplicate detection counts all campaigns in period — false positives

- **위치**: `src/lib/upload-processor.ts:97` · **분류**: 버그 · **영역**: 쿠팡광고 캠페인
- **문제**: The first-pass duplicate check (overwrite=null) counts AdRecords for the entire workspace within the upload's date range, without filtering by the campaignIds present in the uploaded file: `prisma.adRecord.count({ where: { workspaceId, date: { gte: periodStart, lte: periodEnd } } })`. If the workspace already has data for other campaigns in that period, `existingCount` will be non-zero even though the uploaded file has zero overlapping records. The response reports `duplicateCount: existingCount` and `newCount: rows.length` as if all existing records are duplicates of the upload.
- **트리거**: User uploads a file for campaign A when the DB already has campaign B data in the same date range.
- **사용자 영향**: A spurious 'X duplicate records found' confirmation dialog appears. Confused users who cancel lose the upload; users who accept are shown misleading counts ('2000 duplicates, 500 new') that don't correspond to reality. This can erode trust and cause valid uploads to be abandoned.
- **수정 방향**: Filter the duplicate count by the campaignIds contained in the uploaded rows: `where: { workspaceId, date: ..., campaignId: { in: campaignIdsFromFile } }`.
- **검증 노트**: 데이터 손상 없음. 오직 중복 감지 단계의 카운트만 부정확하며, 실제 삭제·삽입 경로(lines 122-129)는 campaignId로 올바르게 범위를 제한한다. 사용자 혼란 및 유효 업로드 포기 가능성은 실재하므로 medium이 적합하다.

#### keyword-status batch POST has no array size limit — DoS vector

- **위치**: `app/api/campaigns/[campaignId]/keyword-status/route.ts:50` · **분류**: 엣지케이스 · **영역**: 쿠팡광고 캠페인
- **문제**: The POST handler filters the `keywords` array to strings but sets no maximum size. It then fires `Promise.all(keywords.map(k => prisma.keywordStatus.upsert(...)))`, creating as many concurrent DB connections as there are keywords in the request. An authenticated user can submit thousands of keywords in a single request, exhausting the Prisma connection pool (default 10 connections) and causing 'max client connections' errors that block all other DB operations.
- **트리거**: POST /api/campaigns/[campaignId]/keyword-status with a body containing thousands of keywords, e.g., `{ keywords: Array(5000).fill('kw') }`.
- **사용자 영향**: Database connection pool exhaustion for the entire workspace, degrading or blocking all concurrent API requests until the connection pool recovers.
- **수정 방향**: Add a maximum keywords count validation (e.g., max 500) and consider batching the upserts with prisma.$transaction or a chunked sequential loop instead of unlimited Promise.all.
- **검증 노트**: 원 보고서의 medium 판정이 타당하다. 인증 필요 조건이 critical/high를 낮추는 요인이고, 피해가 일시적(풀 회복)이며 영속적 데이터 손실은 없다. 다만 수정은 간단하다: keywords 배열 상한(예: 500)을 line 46 직후에 추가하거나 prisma.$transaction + createMany/upsertMany 배치로 교체하면 된다.

### 쿠팡광고 수집·실행 (ads-ops)

#### PENDING 상태 수집 런이 만료 후에도 DB에 잔존하여 신규 수집 영구 차단

- **위치**: `app/api/collection/runs/route.ts:15` · **분류**: 데이터 무결성 · **영역**: 쿠팡광고 수집·실행
- **문제**: GET /collection/runs의 stale 정리 쿼리(line 15-27)는 status { in: ['RUNNING','DOWNLOADING','PARSING'] }만 대상으로 한다. PENDING 런은 포함되지 않아 만료 후에도 status=PENDING으로 남는다. 반면 POST /collection/runs의 중복 방지 체크(line 131-138)는 PENDING을 포함하므로, 워커가 클레임하지 못한 PENDING 런이 하나라도 있으면 해당 워크스페이스의 모든 신규 수집 요청이 409로 실패한다. GET /pending은 10분 이상 된 PENDING을 무시하지만 DB는 정리하지 않는다.
- **트리거**: 워커가 런을 클레임하기 전 다운, 배포 재시작, 또는 스케줄 오류로 PENDING 런이 10분 이상 방치될 때
- **사용자 영향**: 사용자가 수동 수집을 시도하면 '이미 진행 중인 수집 작업이 있습니다' 409 오류만 반복되어 영구적으로 수집 불가. 해당 스테일 런 ID를 알아야만 DELETE로 해제 가능하며 UI에서 이를 발견·삭제하는 명확한 흐름 없음.
- **수정 방향**: GET /collection/runs stale 정리 쿼리에 PENDING 포함: status: { in: ['PENDING','RUNNING','DOWNLOADING','PARSING'] }, 단 PENDING은 startedAt 대신 createdAt을 기준으로 10분 초과 시 FAILED 처리.
- **검증 노트**: 버그 자체는 진짜지만 '영구 차단·UI 복구 경로 없음' 주장이 과장. src/components/settings/collection-history.tsx:121-239에서 PENDING이 ACTIVE_STATUSES에 포함되어 스테일 런이 활성으로 표시되고, '강제 종료' 버튼이 activeRun.id로 자동 DELETE하므로 사용자는 런 ID를 몰라도 원클릭 복구 가능. 다만 스케줄 수집도 409로 무음 차단되고 수동 개입 전까지 수집이 중단되므로 medium 유지가 타당.

### 날짜/금액 횡단 (cross-date-money)

#### 재무 현금흐름 뷰 기본 기간이 서버 UTC 기준: 한국 자정~09시에 이전 달이 표시됨

- **위치**: `app/api/finance/cashflow/route.ts:39` · **분류**: UX · **영역**: 날짜/금액 횡단
- **문제**: `cashflow/route.ts`의 `ymOf(new Date())`는 Vercel(UTC) 서버 시간 기준으로 현재 월을 계산한다. 반면 `cashflow-view.tsx` 클라이언트는 `from`/`to` 파라미터를 API에 전달하지 않으므로(line 129: `params = new URLSearchParams({ grain, groupBy })`) 서버 기본값 `nowYm`과 `defaultFrom`이 항상 사용된다. 한국 자정~09:00(= UTC 이전날 15:00~00:00)에는 서버 UTC 기준 `nowYm`이 이전 달이 되어 `to = 이전 달`이 된다. 예: KST 2024-02-01 01:00에 접속하면 서버 UTC는 2024-01-31이므로 `to = '2024-01'`로 1월 데이터만 보인다.
- **트리거**: 사용자가 새로운 달 KST 자정~09:00 사이에 재무 현금흐름 화면을 열 때.
- **사용자 영향**: 한국 사용자가 새 달 첫날 자정~오전 9시에 현금흐름 차트를 보면 당월이 누락된 이전 달 기준으로 렌더링된다. 금액이 0으로 보이거나 없는 기간이 표시되어 재무 데이터가 사라진 것처럼 오해할 수 있음.
- **수정 방향**: `cashflow-view.tsx`에서 `currentYm()`(브라우저 로컬 KST)으로 계산한 `from`/`to`를 params에 포함해 서버 기본값에 의존하지 않도록 한다. 또는 서버에서 `ymOf`를 KST 유틸(`getTodayStrKst` 방식)로 교체한다.
- **검증 노트**: 원 주장의 medium 심각도가 적절합니다. 한 달에 9시간(KST 00:00~09:00)만 영향을 주고, 데이터 손실이 아닌 잘못된 기간 표시라는 점에서 high까지는 아닙니다. 그러나 재무 대시보드에서 당월 데이터가 완전히 누락되어 보이는 UX 오류이므로 low도 아닙니다.

#### 발주 계획 번호 UTC 날짜 사용: KST 자정~09시 생성 계획의 날짜가 하루 앞선 전날 날짜로 잘못 표기됨

- **위치**: `src/lib/inv/reorder-seq.ts:8` · **분류**: 버그 · **영역**: 날짜/금액 횡단
- **문제**: `todayStart()`가 `new Date(); d.setHours(0,0,0,0)` (로컬 = Vercel UTC 자정)을 반환하고 `dateStr(d)`가 `getFullYear()`, `getMonth()`, `getDate()` (UTC)로 날짜 문자열을 생성한다. Vercel에서 UTC 기준이므로 한국 시각 자정~09:00(= 전날 UTC 15:00~현재 UTC 00:00)에 생성된 계획은 전날 UTC 날짜를 사용한다. 예: KST 2024-02-01 02:00 생성 → `todayStart()` = 2024-01-31T00:00:00Z(UTC), 계획 번호 = '20240131-NNN'. 또한 일별 순번 카운트 기준(`createdAt: { gte: today }`)도 UTC 자정이라 KST 하루에 걸친 두 UTC 날짜의 계획이 별개로 카운트된다.
- **트리거**: 한국 사용자가 KST 00:00~09:00 사이에 발주 계획을 생성할 때. 서버가 UTC로 운영되는 한 항상 재현 가능.
- **사용자 영향**: 발주 계획 번호(예: '20240131-001')에 전날 날짜가 표기되어 운영팀의 날짜 기반 추적/정렬/필터 시 혼란 발생. 계획 번호는 공급업체에 전달될 수 있어 커뮤니케이션 오류를 유발할 수 있음.
- **수정 방향**: `todayStart()`를 KST 자정 기준으로 변경: `Date.now() + 9*3600*1000`에서 `toISOString().split('T')[0]`으로 날짜 추출 후 Prisma `createdAt >= ${kstMidnightUtc}` 비교.
- **검증 노트**: 주장된 medium 심각도를 그대로 유지한다. 발주 계획 번호에 전날 날짜가 표기되는 운영 혼란이지만, 데이터 손실·보안·기능 불능은 없다. 트리거 조건(KST 00:00~09:00)은 실제 운영에서 충분히 발생 가능하므로 low로 낮출 근거도 없다.

#### 발주 재고 뷰 window truncation cutoff가 UTC 날짜 키로 KST 수요 날짜 키와 비교됨

- **위치**: `app/api/sh/inventory/reorder/route.ts:133` · **분류**: 버그 · **영역**: 날짜/금액 횡단
- **문제**: `toDateStr(d)` (line 9-13)은 `getFullYear/getMonth/getDate`(로컬 = Vercel UTC)로 날짜 문자열을 반환한다. `loadOptionDemand`의 수요 행은 `toKstDateKey`(KST +9h)로 키잉된다. `cutoff = toDateStr(now - (wd-1)*days)` 비교에서 cutoff는 UTC 날짜, 수요 keys는 KST 날짜이다. 파일 맨 위 주석(line 8)이 '로컬 일자 YYYY-MM-DD (loadOptionDemand 의 KST 키와 윈도우 절단 비교용)'라고 KST 비교 의도를 명시하지만 실제로는 UTC를 사용한다. 매일 KST 00:00~09:00에 cutoff가 하루 이른 UTC 날짜가 되어 분석 창이 1일 더 넓게 동작하거나 마지막 날 수요 일부가 포함/제외된다.
- **트리거**: 발주 예측 화면 접근 또는 발주 계획 생성 시. KST 자정~09:00 사이 특히 월 경계 날짜에 영향이 크다.
- **사용자 영향**: 재고 발주 예측 화면에서 분석 창(window days) 마지막 날의 판매 수요가 약 9시간 분 더 포함되거나 누락될 수 있어 일평균 출고량이 미미하게 과다/과소 계산되고 발주 수량 권장이 비일관적으로 변동함.
- **수정 방향**: `toDateStr`를 KST 기준으로 교체: `new Date(d.getTime() + 9*3600*1000).toISOString().slice(0, 10)`. 또는 `getTodayStrKst`/`getDaysAgoStrKst`(date-range.ts 유틸) 사용.
- **검증 노트**: 90일 기본 창에서는 ~1% 오차로 미미하지만, 사용자 설정으로 짧은 창(예: 7일)을 사용할 경우 ~14% 수요 과다 산정으로 발주 권장 수량이 부풀 수 있다. 데이터 손상이나 보안 문제는 없고 9시간/일 주기로 반복되는 일시적 오차이므로 medium이 적절하며 주장된 심각도와 일치한다.

### 재무 업로드·확정 (finance-import)

#### 거래후잔액 컬럼 미매핑 시 동일 날짜·금액 은행 거래가 무음으로 중복 제거됨

- **위치**: `src/lib/finance/parser.ts:453` · **분류**: 데이터 무결성 · **영역**: 재무 업로드·확정
- **문제**: 은행 identityKey = sha([accountId, txnDate, direction, amount, balanceAfter ?? '']). balanceAfter 컬럼이 매핑되지 않으면 네 번째 인자가 빈 문자열이 되고, 같은 날 같은 금액·방향 거래 2건이 동일 해시를 갖는다. commit-staging에서 두 번째 건은 seenInBatch에 의해 DUP_SAME으로 처리되어 스테이징에만 남고 commit 시 완전히 제외된다. 코드 주석(452~453줄)이 이를 인정하지만 사용자 경고는 없다.
- **트리거**: 은행 파일에 '거래후잔액' 컬럼이 없거나 사용자가 해당 컬럼을 매핑하지 않은 상태에서, 같은 날 같은 금액의 거래(예: 50,000원 이체 2건)를 포함한 파일을 가져올 때
- **사용자 영향**: 거래가 무음으로 유실된다. 사용자는 스테이징 화면에서 DUP_SAME 표시를 보지 않는 한 인지하기 어렵고, 확정 후 장부에 거래가 영구 누락된다.
- **수정 방향**: balanceAfter 미매핑 시 경고 배지를 미리보기 화면에 표시하거나, 같은 파일 내 identityKey 충돌 건수를 count하여 응답에 포함시켜 사용자가 인지하도록 한다.
- **검증 노트**: 심각도 high→medium. (1) 트리거가 주장보다 좁음: identityKey는 시각 포함 txnDate를 사용(parser.ts:453, normalizeDateTime parser.ts:312-327이 HH:MM:SS 보존)하므로, 시간 정보가 있는 은행 export에서는 같은 날 같은 금액이어도 시각이 다르면 충돌하지 않음. 충돌은 '잔액 미매핑 + 날짜만 있는(또는 동일 시각) export'라는 이중 조건에서만 발생. (2) 완전한 무음이 아님: commit-staging 응답이 dupSame 카운트를 반환(route.ts:243)하고, 스테이징 UI에 '중복' 필터·배지 및 DUP_SAME→NEW(유지) 전환 수단이 존재(transactions-view.tsx:664,857-968, staging/[id]/route.ts:63-66). 다만 기본 동작이 확정 시 제외이므로(data-integrity 리스크 자체는 실재) low는 아님.

#### staging/commit 단일 트랜잭션 내 행별 순차 DB 호출로 30초 타임아웃 초과 가능

- **위치**: `app/api/finance/staging/commit/route.ts:90` · **분류**: 엣지케이스 · **영역**: 재무 업로드·확정
- **문제**: $transaction({ timeout: 30000 }) 내부에서 staged 행마다 개별 upsert(finTransaction) + delete(finStagedRow) = 행당 2 DB 호출, 이후 영향 계좌마다 finTransaction.findMany (전체 이력 조회) + 월별 finBalanceSnapshot.upsert 반복 실행. 500행·3계좌·24개월 케이스에서 ~1072 DB 호출 × 레이턴시로 30초 임박. 대형 배치(월 거래내역 전체 확정)에서 타임아웃 현실적으로 발생.
- **트리거**: 스테이징 큐에 500건 이상 CLASSIFIED 행을 한 번에 commit할 때
- **사용자 영향**: 트랜잭션 타임아웃 → 전체 롤백 → 500 응답. 스테이징 행이 그대로 남아 사용자가 반복 시도해도 같은 결과. 거래를 확정할 방법이 없어지는 기능 완전 실패.
- **수정 방향**: upsert를 배치 createMany/updateMany로 전환하거나 importId 단위로 청크 분할 커밋을 도입. 잔고 스냅샷 계산을 별도 비동기 작업으로 분리한다.
- **검증 노트**: 원래 심각도 medium 유지. 추가로 L137 finTransaction.findMany가 계좌 전체 이력을 무제한 조회하므로 실제 위험은 "500행" 트리거보다 계좌 이력 크기에도 의존함 — 설명보다 위험 요인이 한 가지 더 있음.

#### classified 탭 카운트에 DUP_SAME 행이 포함되어 실제 커밋 건수와 불일치

- **위치**: `app/api/finance/staging/route.ts:81` · **분류**: UX · **영역**: 재무 업로드·확정
- **문제**: classified 카운트: { classStatus: 'CLASSIFIED' } 는 resolution=DUP_SAME 이면서 classStatus=CLASSIFIED인 행도 포함한다(auto-classify가 DUP_SAME 행에도 실행되므로 이런 행이 실제로 존재). 하지만 staging/commit/route.ts(34줄)는 resolution: { not: 'DUP_SAME' } 조건으로 이 행들을 커밋에서 제외한다. 결과적으로 '50건 분류 완료'로 표시되어도 커밋하면 45건만 저장될 수 있다.
- **트리거**: auto-classify가 규칙으로 DUP_SAME 행을 CLASSIFIED로 분류했을 때, 사용자가 classified 탭에서 전체 확정 시
- **사용자 영향**: 사용자가 'N건 확정' 결과를 기대하지만 실제로는 더 적은 수가 확정된다. 숫자 불일치로 인해 장부 입력이 완료되지 않았다고 혼동하거나, 누락 여부를 재확인하는 시간을 낭비한다.
- **수정 방향**: classified 카운트 쿼리에 resolution: { not: 'DUP_SAME' } 조건을 추가하거나, UI에서 'classified 중 N건은 중복으로 커밋 제외됩니다' 안내를 표시한다.
- **검증 노트**: 심각도 변경 없음. 데이터 손실이 아니라 카운트 불일치로 인한 UX 혼란 문제이므로 medium이 정확하다. 수정 방향: staging/route.ts:81의 classified 카운트 쿼리에 resolution: { not: 'DUP_SAME' } 조건을 추가하거나, classified 탭 필터에도 동일 조건을 반영해 표시 건수와 커밋 건수를 일치시키면 된다.

### 재무 화면·API (finance-views)

#### 거래 내역 요약(수입/지출 합계)에 이체 거래가 포함됨

- **위치**: `app/api/finance/transactions/route.ts:84` · **분류**: 데이터 무결성 · **영역**: 재무 화면·API
- **문제**: GET /api/finance/transactions의 groupBy 집계(incomeTotal, expenseTotal)는 `where`에 `isTransfer: false` 조건이 없다. 대시보드·현금흐름 API는 집계 시 이체(isTransfer=true) 거래를 명시적으로 제외하지만(aggregate.ts의 `if (r.isTransfer) continue`), 거래 내역 탭의 요약은 이체 거래를 그대로 합산한다.
- **트리거**: 계좌 간 이체 거래가 존재하는 공간에서 거래 내역 탭의 '전체' 또는 방향 필터 없이 조회하면 항상 발생한다.
- **사용자 영향**: 거래 내역 탭의 수입·지출 합계가 대시보드·현금흐름의 같은 기간 숫자보다 높게 표시된다. 사용자가 두 화면의 숫자를 비교할 때 숫자가 맞지 않아 데이터 오류로 오인한다.
- **수정 방향**: `where`에 `isTransfer: false`를 추가하거나, 별도 groupBy 쿼리를 사용하여 이체를 제외한 합계를 계산한다.
- **검증 노트**: 진짜 불일치이지만 데이터 자체는 손상되지 않는 표시 계층 문제. 쓰기 경로·K-IFRS export·대시보드 집계는 영향 없음. 화면 간 숫자 불일치로 인한 사용자 신뢰 저하가 주 영향이므로 high(data-integrity)보다는 medium(consistency/display)이 적절.

#### 확정 거래 일괄 삭제 확인 다이얼로그 버튼에 비활성화(disabled) 상태 없음

- **위치**: `src/components/finance/transactions-view.tsx:1209` · **분류**: UX · **영역**: 재무 화면·API
- **문제**: `runBulkDelete` async 함수가 실행되는 동안 삭제 확인 다이얼로그의 '삭제' 버튼이 `disabled`되지 않는다. `setDeleteOpen(false)`는 `await onBulkDelete()`가 완료된 후에 호출되므로, 응답이 느릴 때 사용자가 버튼을 여러 번 클릭할 수 있다. 동일한 ID 배열로 복수의 DELETE 요청이 서버로 전송된다.
- **트리거**: 느린 네트워크 환경에서 사용자가 삭제 버튼을 빠르게 두 번 이상 클릭할 때 발생한다.
- **사용자 영향**: 스냅샷 재계산 로직이 불필요하게 여러 번 실행되어 응답 지연이 발생하고, UI가 혼란스러운 상태에 빠질 수 있다(첫 번째 성공 토스트 이후 로딩 중).
- **수정 방향**: `runBulkDelete`에 `deleting` 상태를 추가하고 실행 중엔 버튼을 `disabled`로 설정한다.
- **검증 노트**: 심각도 변경 없음. 중복 DELETE 요청은 idempotent한 경우가 많아 데이터 손상 위험은 낮지만, 스냅샷 재계산 중복 실행과 토스트 이후 로딩 잔류 등 UX 혼란은 실제 발생한다. medium이 적절하다.

#### 거래 내역 탭에 페이지네이션 없이 최대 100건만 표시되나 합계는 전체 기준

- **위치**: `src/components/finance/transactions-view.tsx:242` · **분류**: UX · **영역**: 재무 화면·API
- **문제**: `loadTransactions`는 `take`/`skip` 파라미터를 전달하지 않아 서버 기본값 `take=100`이 적용된다. 그러나 income/expense 합계는 서버의 groupBy로 계산되므로 전체 매칭 거래 합계가 반환된다. UI에 페이지네이션 컨트롤이 없어 100건 초과 데이터는 영구적으로 노출되지 않지만, 요약 합계('수입 X원', '지출 Y원')는 전체 기간의 합계를 표시한다.
- **트리거**: 거래가 100건을 초과하는 공간에서 날짜 범위 필터 없이 전체 거래 탭을 조회할 때 발생한다.
- **사용자 영향**: 사용자는 요약 합계를 보며 전체 데이터를 보고 있다고 생각하지만, 실제로는 100건만 테이블에 표시된다. 나머지 거래는 검색 없이는 접근이 불가능하여 거래 내역 파악이 불완전하다.
- **수정 방향**: 테이블 하단에 '다음 페이지' 또는 '더 보기' 버튼을 추가하거나, `take` 기본값을 전체 데이터 범위로 올리고 서버 측에서 커서 기반 페이지네이션을 지원한다.
- **검증 노트**: 주장된 medium 심각도가 적절합니다. 요약 합계는 전체 기준, 테이블은 100건 제한이라는 불일치는 실재하나, "총 X건" 카운터가 전체 건수를 노출하므로 완전한 숨김은 아닙니다. 보안·데이터 손실 문제가 없으므로 high/critical 상향은 부적절합니다.

### 쿠팡 판매→재고 동기화 (inv-coupang-sync)

#### GET /api/inventory — fileType 필터 누락으로 VENDOR 데이터가 재고 목록에 혼입

- **위치**: `app/api/inventory/route.ts:28` · **분류**: 버그 · **영역**: 쿠팡 판매→재고 동기화
- **문제**: 최신 snapshotDate 결정 쿼리(line 26~34)에 fileType 필터가 없어 VENDOR_ITEM_METRICS 업로드가 INVENTORY_HEALTH보다 최신이면 targetDate가 VENDOR 날짜로 설정된다. 이후 InventoryRecord 조회(line 90~96)에도 fileType 조건이 없으므로 해당 날짜의 VENDOR 레코드가 반환된다. VENDOR 레코드는 availableStock, returns30d, storageFee 등 재고 분석 필드가 모두 null이다.
- **트리거**: 워커가 VENDOR_ITEM_METRICS를 수집하는 시점이 INVENTORY_HEALTH 업로드보다 나중이거나, 같은 snapshotDate에 두 fileType이 모두 존재할 때. 일상적인 워커 수집 흐름에서 자주 발생.
- **사용자 영향**: 재고 목록 페이지의 판매가능재고, 반품율, 보관료 등 모든 수치가 빈 값으로 보인다. 재고 부족 분석도 동일 날짜 조건으로 실행되면 VENDOR 행도 포함해 결과가 오염된다. 사용자는 UI 오류로 인식하지 못하고 빈 데이터를 보고 혼란스러워한다.
- **수정 방향**: line 28 쿼리에 fileType: 'INVENTORY_HEALTH' 조건 추가. line 48의 where 객체에도 fileType: 'INVENTORY_HEALTH' 추가. productNames 집계 쿼리(line 98)도 같은 fileType 조건이 필요하다.
- **검증 노트**: 버그 자체는 진짜지만 두 가지 과장이 있다. (1) "일상적인 워커 수집 흐름에서 자주 발생"은 사실이 아님 — 워커 흐름에서 HEALTH snapshotDate는 업로드 시각(new Date(), upload-worker/route.ts:27, snapshotDate 미전달)이고 VENDOR는 어제 KST 자정(orchestrator.ts:495~498)이라 HEALTH가 항상 더 최신이며, snapshotDate 정확 일치 조회라 혼입도 없다. 실제 트리거는 (a) HEALTH 수집이 2일 이상 연속 실패하며 VENDOR만 성공, (b) 사용자가 업로드 다이얼로그로 VENDOR(셀러 인사이트) 파일을 수동 업로드(date-only 스냅샷이 최신이 됨), (c) 같은 기준일로 두 타입 수동 업로드 시 혼합 표시 — 발생 가능하지만 간헐적. (2) "재고 부족 분석도 오염" 주장은 거짓 — inventory-analyzer.ts:67,88이 fileType: 'INVENTORY_HEALTH'로 이미 필터링함. 따라서 high → medium.

#### resolveWorkspace() 워커 인증 fallback — x-workspace-id 미지정 시 DB 첫 번째 워크스페이스 반환 (테넌트 격리 없음)

- **위치**: `src/lib/api-helpers.ts:33` · **분류**: 권한/격리 · **영역**: 쿠팡 판매→재고 동기화
- **문제**: isWorkerAuthenticated()가 true이고 x-workspace-id 헤더가 없으면 line 33에서 prisma.workspace.findFirst()를 호출해 DB 순서상 첫 번째 워크스페이스를 반환한다. 주석에 '단일 테넌트'라고 적혀 있지만, 실제 시스템은 멀티테넌트 Space 구조다. GET /api/inventory는 이 함수를 사용한다.
- **트리거**: 유효한 WORKER_API_KEY를 가진 요청에서 x-workspace-id 헤더를 생략하는 경우 (버그 있는 워커, 또는 키를 탈취한 공격자).
- **사용자 영향**: 공격자가 WORKER_API_KEY만으로 x-workspace-id를 지정하지 않아도 임의 워크스페이스(DB에서 first)의 재고 데이터를 읽을 수 있다. 신규 테넌트 추가 시 findFirst 결과가 바뀌면 어느 테넌트가 노출될지 예측 불가.
- **수정 방향**: 워커 인증 경로에서도 x-workspace-id가 없으면 401/400을 반환해 암묵적 fallback을 제거한다. 단일 테넌트 운영이 확실하다면 코드와 주석을 일치시키되, 멀티테넌트 확장을 고려하면 반드시 명시적 workspaceId 요구.
- **검증 노트**: high(authz)→medium. 공격자 관점에서 findFirst fallback은 추가 권한을 주지 않는다 — 같은 함수의 상단 경로(api-helpers.ts:26-30)가 x-workspace-id 지정 시 소유권/스코프 검증 없이 findUnique 존재확인만 하므로, WORKER_API_KEY를 탈취한 공격자는 fallback 없이도 이미 임의 워크스페이스를 헤더로 직접 지정해 접근 가능하다. 즉 진짜 신뢰 경계는 WORKER_API_KEY 자체이고, fallback은 그 경계를 넓히지 않는다. 남는 실질 리스크는 정상 워커가 헤더를 빠뜨렸을 때 비결정적 워크스페이스(다중 유저 DB에서 first)로 조용히 라우팅되는 정합성/격리 버그이며, resolveWorkspace가 쓰기 라우트(collection/credentials POST, execution/tasks, backfill 등)에도 쓰이므로 무시할 수 없어 medium.

#### stale 알림 dedupe 마커가 Slack 전송 성공 여부와 무관하게 생성 — 일시적 Slack 오류 시 영구 알림 침묵

- **위치**: `app/api/cron/inventory-stale-check/route.ts:84` · **분류**: UX · **영역**: 쿠팡 판매→재고 동기화
- **문제**: line 73~95: Slack 전송(line 74~80)이 예외를 throw해도 catch(line 81~83)에서 잡힌 뒤, line 84에서 inventoryAnalysis stale-skip 마커가 무조건 생성된다. 같은 패턴이 inventory-analyzer.ts line 278~289에도 존재한다. 마커가 생성되면 이후 cron 실행에서 '같은 snapshotDate에 이미 마커 있음'으로 판단해 Slack을 영구적으로 skip한다.
- **트리거**: Slack API 일시 장애, 네트워크 오류 등으로 notifyInventoryStaleData가 실패하는 경우. 다음 cron 실행 시 마커가 있어 재시도하지 않는다.
- **사용자 영향**: 재고 데이터가 수일째 stale 상태인데도 운영자가 Slack 알림을 받지 못한다. 워커 다운·데이터 미수집 사고가 탐지되지 않아 판매·발주 의사결정이 잘못된 데이터 기반으로 진행된다.
- **수정 방향**: 마커 생성을 Slack 전송 성공(notified=true) 조건부로 실행한다. 또는 마커에 notifiedAt 타임스탬프를 저장하고 일정 기간(예: 24h) 내에 성공 전송이 없으면 재시도한다.
- **검증 노트**: 주장된 medium 심각도가 적절하다. 수정 방향: prisma.inventoryAnalysis.create를 try 블록 내부로 이동하거나, Slack 전송 성공 시에만(notified === true) 마커를 생성하도록 조건을 추가해야 한다.

#### coupang-sales-sync 일일 잡 이력: findFirst + create/update 비원자적 — 동시 실행 시 중복 이력 레코드 생성

- **위치**: `app/api/cron/coupang-sales-sync/route.ts:92` · **분류**: 데이터 무결성 · **영역**: 쿠팡 판매→재고 동기화
- **문제**: line 92~122의 daily 모드 이력 기록 로직은 findFirst(line 92~99)로 기존 잡을 조회한 뒤 없으면 create(line 115), 있으면 update(line 113)한다. 이 두 단계 사이에 트랜잭션이나 DB 유니크 제약이 없다. CoupangBackfillJob 스키마(schema.prisma)에 (workspaceId, days, trigger, createdAt≥todayKstStart) 유니크 제약도 없다.
- **트리거**: cron이 짧은 간격으로 2회 이상 실행(Vercel cron 재시도, 수동 manual 트리거와 scheduled 동시 실행)될 때, 두 인스턴스가 모두 findFirst=null을 보고 create를 시도한다.
- **사용자 영향**: 같은 날 같은 워크스페이스의 이력 잡이 여러 건 생성되어 수집 이력 패널에 중복 행이 표시된다. 집계 지표(변환 건수, 매출 합산)가 두 배로 보여 운영자가 실적을 오독할 수 있다.
- **수정 방향**: findFirst + conditional create/update를 prisma.$transaction 또는 Prisma upsert로 교체. 또는 (workspaceId, days, trigger, date) 복합 유니크 인덱스를 추가해 DB가 중복을 거부하게 한다.
- **검증 노트**: 핵심 재고/매출 원장 데이터는 referenceId 멱등으로 보호되어 있어 실제 데이터 손상은 없다. 피해 범위가 이력 패널 UI 중복 표시와 집계 수치 오독에 한정되므로 critical이 아닌 medium이 정확한 심각도다.

### 재고·발주·재고대조 (inv-reorder)

#### confirmReconciliation 조정 루프 — 오류 무음 삼킴으로 재고 반영 실패가 보고되지 않음

- **위치**: `src/lib/inv/reconciliation-processor.ts:193` · **분류**: 데이터 무결성 · **영역**: 재고·발주·재고대조
- **문제**: confirmReconciliation(193~207행)에서 모든 processMovement 호출이 개별 try/catch로 감싸져 오류가 console.error로만 기록되고 실행이 계속된다. 예외를 흡수한 항목은 InvMovement 행이 생성되지 않으므로 재고에 반영되지 않지만, 호출 측(route, UI)은 성공과 실패를 구분할 수 없다. 이후 cumulativeApplied 집계(211~215행)는 DB에 없는 행을 세지 않으므로 상태가 PARTIAL로 남을 수 있으나, 어떤 옵션이 실패했는지는 서버 로그 없이 알 수 없다.
- **트리거**: • 상품 옵션이 대조 생성 후 INACTIVE로 전환된 경우 • 보관 장소가 비활성화된 경우 • DB 일시 장애로 개별 processMovement 트랜잭션이 실패하는 경우 이 중 하나라도 발생하면 일부 재고는 조정되고 일부는 조정되지 않은 채 루프가 완료된다.
- **사용자 영향**: 재고 대조를 확정했음에도 일부 SKU의 실제 재고가 수정되지 않는다. UI는 PARTIAL 상태를 보여주지만 실패 항목 목록이 없으므로 사용자가 어떤 조정이 누락됐는지 알 방법이 없다. 결과적으로 재고 수치가 파일 기준과 계속 불일치하게 된다.
- **수정 방향**: try/catch를 제거하고 실패 항목을 errors 배열로 수집한 뒤, 최종 반환 값(ConfirmResult)에 포함시켜 UI가 실패 목록을 표시할 수 있도록 한다. 실패가 발생해도 성공한 항목은 보존하되(best-effort), 실패 목록을 명확히 반환한다.
- **검증 노트**: critical→medium. 오류 삼킴은 사실이나 데이터 무결성 손상은 없음: cumulativeApplied가 DB 실측(211-216행)이라 상태/adjustedItems는 정확하고, finalize는 APPLIED에서만 허용(route 280행)되어 미완료 확정 불가, PARTIAL에서 confirm 재시도 허용(82행) + ADJUSTMENT 절대값 set으로 self-correct(coupang-sales-to-movement.ts:16 주석이 부분실패·재시도 설계를 명시). 남는 진짜 문제는 (1) 부분 실패에도 성공 토스트(reconciliation-preview.tsx:533), (2) INACTIVE 상품 등 영구 실패 시 원인·항목 미표시로 영원히 PARTIAL — 관측성/UX 결함.

#### 매핑 아이템 deleteMany+createMany — 트랜잭션 없음으로 deleteMany 후 createMany 실패 시 매핑 소실

- **위치**: `src/lib/inv/reconciliation-processor.ts:148` · **분류**: 데이터 무결성 · **영역**: 재고·발주·재고대조
- **문제**: confirmReconciliation(148~160행)에서 InvLocationProductMapItem.deleteMany 후 createMany를 별도 await로 순차 실행하며, 두 연산 사이에 트랜잭션이 없다. deleteMany 성공 후 createMany가 DB 오류로 실패하면 해당 매핑의 모든 아이템이 영구 소실된다. 동일한 패턴이 [id]/route.ts의 map action(368~374행)에도 존재한다.
- **트리거**: • createMany 실행 시 DB 연결 타임아웃 또는 일시적 장애 • validItems 필터 후 빈 배열이 아니지만 DB 제약 위반(중복 optionId 등) Server-side 재시도 없이 요청이 한 번 실패하면 즉시 손실된다.
- **사용자 영향**: 외부코드 → 내부 옵션 매핑 설정이 사라져, 이후 동일 파일로 대조를 수행해도 해당 행이 file-only로 분류된다. 수동으로 매핑을 다시 등록해야 하며, 이전 데이터는 복구 불가다.
- **수정 방향**: prisma.$transaction 안에서 deleteMany와 createMany를 묶어 원자적으로 실행한다. Prisma 7에서는 대화형 트랜잭션(prisma.$transaction(async tx => { ... }))을 사용하면 된다.
- **검증 노트**: 패턴은 실재하나 high는 과대. 소실되는 것은 히스토리성 데이터가 아니라 사용자가 재입력 가능한 매핑 설정(InvLocationProductMapItem)이며, InvLocationProductMap 레코드 자체는 남아 UI에서 재매핑 가능. 발생 창도 두 쿼리 사이 순간적 장애 또는 중복 optionId 페이로드로 제한적. 데이터 무결성 결함은 맞으므로 medium이 적절 — $transaction 배열 래핑으로 1줄급 수정 가능.

#### confirmReconciliation — status 확인과 processMovement 루프 사이 트랜잭션 경계 없음으로 동시 confirm 시 중복 이동 생성

- **위치**: `src/lib/inv/reconciliation-processor.ts:75` · **분류**: 데이터 무결성 · **영역**: 재고·발주·재고대조
- **문제**: confirmReconciliation(75~83행)에서 recon.status가 PENDING/PARTIAL인지 확인하는 코드가 별도 DB 읽기로 실행되며, 이후 processMovement 루프와 원자적 트랜잭션으로 묶여 있지 않다. 두 요청이 동시에 들어오면 둘 다 status 검사를 통과하고 조정 루프를 실행한다. ADJUSTMENT는 setStockLevel(절댓값 설정)이므로 재고 최종 값은 idempotent하지만, referenceId=reconciliationId인 InvMovement 행이 중복 생성된다. 두 번째 confirm의 각 adjust는 delta=0(이미 목표 수량에 도달)인 InvMovement를 생성한다.
- **트리거**: 사용자가 '확인 적용' 버튼을 빠르게 두 번 클릭하거나, 네트워크 재시도로 동일 요청이 두 번 전달되는 경우.
- **사용자 영향**: 감사 로그(InvMovement)에 delta=0인 ADJUSTMENT 레코드가 중복으로 쌓여 재고 이력이 오염된다. 재고 변동 내역 화면에서 불필요한 행이 노출된다.
- **수정 방향**: recon.status 확인을 processMovement 실행 전 동일 트랜잭션 내에서 SELECT FOR UPDATE로 수행하거나, 요청 진입 즉시 status를 IN_PROGRESS 같은 잠금 상태로 업데이트(optimistic lock)해 중복 실행을 차단한다.
- **검증 노트**: 재고 실제값과 상태 계산(cumulativeApplied Set 중복제거)이 올바르게 유지되므로 critical/high로 격상할 근거 없음. 감사 로그 노이즈(delta=0 중복 InvMovement 행)에 한정된 data-integrity 문제로 medium이 정확함.

#### Coupang 대조 — workspace를 ownerId로 조회해 Space 멤버가 본인 Coupang 계정으로 대조를 생성할 수 있음

- **위치**: `app/api/sh/inventory/reconciliation/route.ts:93` · **분류**: 권한/격리 · **영역**: 재고·발주·재고대조
- **문제**: coupang 소스 대조(93~98행)에서 workspace를 `{ ownerId: resolved.user.id }`로 조회한다. 멀티테넌트 Space에서 소유자가 아닌 MEMBER/ADMIN이 대조를 요청하면, 해당 사용자 자신의 workspace(ownerId=현재 사용자)가 선택된다. 이 사용자가 별도의 Coupang 계정을 등록해 두었다면, 그 Coupang 데이터로 Space의 재고 대조가 생성된다. Space 소유자의 Coupang 재고와 전혀 다른 데이터가 Space의 InvReconciliation에 기록된다.
- **트리거**: seller-hub Space에 MEMBER 또는 ADMIN 역할로 참여 중이며 본인도 별도 Coupang workspace를 등록한 사용자가 Coupang 재고 연동 대조를 실행할 때.
- **사용자 영향**: Space 대조 기록이 엉뚱한 Coupang 계정의 재고 데이터로 채워진다. 매칭 결과가 완전히 빗나가고, 잘못된 ADJUSTMENT 이동이 재고에 반영될 수 있다.
- **수정 방향**: Space → 소유자(Space.ownerId 또는 Space-User 관계)를 통해 해당 Space의 대표 workspace를 결정하거나, Space 설정에 Coupang workspaceId를 명시적으로 연결하는 필드를 추가한다. 현재는 Space 소유자의 userId로 workspace를 조회하는 것이 최소 수정이다.
- **검증 노트**: 원래 주장한 medium 심각도가 정확하다. 데이터 무결성 오염(잘못된 Coupang 데이터로 Space 대조 생성 + externalIntegrationKey 영구 잘못 backfill)이 실질 영향이지만, 타인 기밀 노출이나 권한 상승이 아니므로 high 격상 근거가 없다.

### 세일즈콘텐츠 분석·UTM (sc-analytics)

#### getDeploymentMetricsTotal이 모든 source의 합계를 누적 — MANUAL과 자동 수집 데이터 이중 합산

- **위치**: `src/lib/sc/metrics.ts:544` · **분류**: 버그 · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: getDeploymentMetricsTotal은 source(MANUAL, API, BROWSER, INTERNAL) 구분 없이 모든 DeploymentMetric 행을 단순 합산한다(550~562행). DeploymentMetric에는 (deploymentId, date, source) 복합 unique 제약이 있어 같은 날 동일 source는 한 행이지만, 서로 다른 source가 동일 날짜에 존재하면 중복 합산된다.
- **트리거**: 자동 수집기(BROWSER source)가 어제 조회수 500을 기록하고, 관리자가 수동으로(MANUAL source) 같은 날 조회수 450을 수기 입력한 경우.
- **사용자 영향**: 배포 상세 페이지(analytics/[deploymentId]/page.tsx:50)와 콘텐츠 상세 페이지(contents/[id]/page.tsx:53)에 '조회 합' 등 수치가 실제보다 부풀려져 표시된다. 마케팅 성과 판단 오류.
- **수정 방향**: source별 우선순위를 정의하거나(예: BROWSER > MANUAL > API), 각 날짜에 단일 source만 유효 데이터로 취급하는 집계 로직으로 변경한다.
- **검증 노트**: 주장된 심각도 medium이 적절하다. 이중 합산은 특정 트리거(동일 날짜에 두 source 모두 기록)가 있어야 발현되며, 데이터 자체가 손상되거나 삭제되는 것은 아니고 집계 표시값만 부풀려진다. 단, analytics 수치는 마케팅 의사결정에 사용되므로 low로 낮추는 것은 부적절하다.

#### PATCH /api/sc/deployments/[id]가 상태 기계 없이 임의 status 변경 허용

- **위치**: `app/api/sc/deployments/[id]/route.ts:54` · **분류**: 데이터 무결성 · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: deploymentUpdateSchema(schemas.ts:186~189)가 status를 SCHEDULED/PUBLISHING/PUBLISHED/FAILED/CANCELED 중 임의로 허용하며, PATCH 핸들러(54행)가 그대로 DB에 반영한다. 상태 전이 유효성 검사가 없다. 예를 들어 FAILED 상태를 PUBLISHED로 바꿔도 publishedAt은 null, 워커 잡도 완료 처리되지 않는다.
- **트리거**: MEMBER 권한 사용자가 PATCH /api/sc/deployments/{id}에 { status: 'PUBLISHED' }를 보내는 경우.
- **사용자 영향**: 실제 게시되지 않은 배포가 PUBLISHED로 표시되어 COLLECT_METRIC 잡이 불필요하게 스케줄링된다. publishedAt이 null인 채로 analytics에서 게시일로 '—'가 표시되어 데이터 신뢰도 저하. 반대로 진짜 PUBLISHED를 CANCELED로 바꾸면 리다이렉터(/c/[slug])가 410 반환.
- **수정 방향**: PATCH에서 status 필드는 별도 transition API(/transition route 패턴)로 분리하거나, allowedTransitions 맵으로 현재 status에서 허용 가능한 다음 status만 적용한다.
- **검증 노트**: 영향이 자신의 워크스페이스 내 데이터 무결성(publishedAt null 불일치, 불필요한 잡 스케줄링, 리다이렉터 410)에 국한되고 크로스 테넌트·인증 우회가 없으므로 주장된 medium이 그대로 적절하다. 상향 조정 불필요.

#### hashIp 함수의 예측 가능한 기본 salt — IP 해시 역추적 가능

- **위치**: `src/lib/sc/utm.ts:70` · **분류**: 권한/격리 · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: hashIp에서 CLICK_EVENT_SALT 환경 변수가 없으면 리터럴 문자열 'sc-salt'를 salt로 사용한다. 이 값은 코드에 하드코딩되어 공개 저장소에 노출될 수 있다. IPv4 주소 공간은 약 42억 개로 유한하므로 rainbow table로 미리 계산 가능하다.
- **트리거**: CLICK_EVENT_SALT 환경 변수가 설정되지 않은 환경(development, staging, 또는 env 설정 누락된 production)에서 /c/{slug}에 클릭이 발생하는 경우.
- **사용자 영향**: ContentClickEvent.ipHash에 저장된 IP 해시를 가진 공격자가 모든 IPv4 범위를 사전 계산하여 방문자 IP를 역추적 가능. GDPR 등 개인정보 규정 위반 위험.
- **수정 방향**: 기본값을 제거하고 CLICK_EVENT_SALT가 없으면 예외를 던지거나, crypto.randomBytes로 런타임에 랜덤 salt를 생성하여 해시 저장 시 함께 보관한다.
- **검증 노트**: 주장된 medium 심각도가 적절하다. 악용을 위해 DB 접근이 선행되어야 하므로 critical은 과도하고, GDPR 위반 및 방문자 IP 역추적 가능성은 실질적이므로 low도 부적절하다. 분류 'authz'보다는 'privacy' 또는 'data-protection'이 더 정확하나, 심각도 자체는 수정 불필요.

#### getSpaceContentAnalytics가 200건에서 무음 절단 — hasMore 플래그 없음

- **위치**: `src/lib/sc/metrics.ts:62` · **분류**: UX · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: getSpaceContentAnalytics에서 prisma.content.findMany에 take: 200이 적용되어 있다(62행). 콘텐츠가 200개를 초과해도 응답에 totalCount나 hasMore 필드가 없다. 성과 관리 페이지(app/d/sales-content/analytics/page.tsx)는 항상 전체 데이터인 것처럼 렌더링한다.
- **트리거**: Space에 200개 이상의 배포 있는 콘텐츠가 있을 때 analytics 페이지를 로드하는 경우.
- **사용자 영향**: 사용자는 성과 분석 화면에서 일부 콘텐츠가 누락되어 있다는 사실을 알 수 없다. 최신순 200건 밖의 오래된 캠페인 성과나 스파이크 데이터가 보이지 않아 잘못된 성과 판단.
- **수정 방향**: 응답에 { rows, totalCount, hasMore } 형태로 페이지네이션 메타를 추가하거나, UI에서 커서 기반 페이지네이션을 지원한다.
- **검증 노트**: 원래 주장한 medium 심각도가 적절합니다. 보안/데이터 손실 문제가 아니며 트리거 조건이 현실적으로 드물지만, 발동 시 사용자가 알 수 없는 무음 절단이 발생해 잘못된 성과 판단을 유발할 수 있습니다.

### 세일즈콘텐츠 코어 (sc-core)

#### IdeationProduct에 타 스페이스 productId 삽입 가능 (cross-space authz 위반)

- **위치**: `src/lib/sc/ideation.ts:216` · **분류**: 권한/격리 · **영역**: 세일즈콘텐츠 코어
- **문제**: `runIdeation`(line 216)과 `saveUserIdeation`(line 283) 모두 `productIds = input.productIds?.filter(Boolean) ?? []`로 DB-validated 결과가 아닌 raw 사용자 입력을 그대로 `IdeationProduct.createMany`에 주입한다. `productsRaw`는 `spaceId` 필터로 올바르게 조회되지만(line 82-92), createMany에 실제로 사용하는 `productIds`는 이 필터를 통과하지 않은 원본 배열이다. `Product` FK가 다른 스페이스에 존재하는 한 DB 제약은 통과하므로, 공격자가 알려진 타 스페이스 Product.id를 제출하면 `IdeationProduct` 연결 행이 성공적으로 생성된다.
- **트리거**: 사용자가 `productIds` 배열에 자신의 스페이스 소속이 아닌 Product ID를 포함해서 POST /api/sc/ideations를 호출.
- **사용자 영향**: 다른 테넌트의 상품이 자신의 아이데이션에 연결되어 M:N 테이블이 오염됨. 아이데이션 목록 UI에서 타 스페이스 상품명이 노출될 수 있으며, 향후 ideation 기반 추천/학습 로직에서 데이터 교차 오염이 발생함.
- **수정 방향**: line 216 및 283에서 `productIds`를 raw 입력 대신 DB에서 실제로 로드된 `productsRaw.map(p => p.id)`로 교체. `saveUserIdeation`은 호출 전에 productIds를 spaceId 필터 조회로 교차 검증해야 함.
- **검증 노트**: 진짜 cross-space authz 갭이지만 critical은 과대평가. 악용에는 타 스페이스 Product cuid(비열거형 랜덤 ID)를 이미 알아야 하고, 결과는 공격자 자신의 테넌트 내 M:N 오염 + 타 상품 name 노출뿐임. 피해 테넌트 데이터 변경·노출 경로 없음. 수정은 productsRaw(spaceId 필터 결과)의 id 집합과 교차 검증으로 간단함.

#### Deployment execute TOCTOU 레이스 → 동일 배포에 PUBLISH 잡 중복 생성

- **위치**: `app/api/sc/deployments/[id]/execute/route.ts:21` · **분류**: 버그 · **영역**: 세일즈콘텐츠 코어
- **문제**: line 21-23에서 `deployment.status`를 확인한 뒤 line 28에서 `contentDeployment.update`를 별도 쿼리로 실행하므로 원자성이 없다. 더블클릭이나 동시 요청 두 개가 모두 상태 체크를 통과하면 두 개의 UPDATE와 두 개의 `enqueueJob`이 순차 실행되어 동일 배포에 두 개의 PUBLISH 잡이 큐에 들어간다.
- **트리거**: 사용자가 '배포 실행' 버튼을 빠르게 두 번 클릭하거나, 두 탭/세션에서 동시에 실행 요청.
- **사용자 영향**: 콘텐츠가 소셜 채널에 이중으로 게시됨. 두 번째 잡은 첫 번째가 성공(PUBLISHED)으로 완료된 뒤 실행되므로 `updateMany` WHERE status='PUBLISHING' 조건에서 스킵되지만, 실제 게시 동작은 워커가 수행하는 Playwright 코드에 달려 있어 채널에 따라 이중 게시될 수 있음.
- **수정 방향**: `prisma.contentDeployment.updateMany({ where: { id, status: { notIn: ['PUBLISHING','PUBLISHED'] } }, data: { status:'PUBLISHING' } })`를 사용하고 `count === 0`이면 409 반환. status 체크와 업데이트를 하나의 원자 쿼리로 통합.
- **검증 노트**: 메커니즘은 전부 사실이나 트리거 확률이 과대평가됨. execute-deployment-button.tsx:64가 submitting 중 버튼을 disable해 단일 탭 더블클릭은 차단되고, 레이스 윈도우는 findFirst→update 사이 ms 단위라 우발 발생 확률이 낮음. 두 탭/세션 동시 요청이 ms 윈도우 안에 겹쳐야 하므로 high(빈발 가능)보다 medium(발생 시 영향 큼, 확률 낮음)이 적정.

#### AI 이미지 생성 후 commitImageCredit 실패 시 Storage 파일 고아 발생

- **위치**: `app/api/sc/contents/[id]/assets/route.ts:155` · **분류**: 데이터 무결성 · **영역**: 세일즈콘텐츠 코어
- **문제**: `uploadAssetBytes`(line 149-154) → `commitImageCredit`(line 155) → `contentAsset.create`(line 157-168) 순서로 실행되지만 트랜잭션이 없다. `commitImageCredit`이 실패하면 catch(line 180)에서 `refundImageCredit`를 호출해 크레딧은 환불되지만, Supabase Storage에 이미 업로드된 이미지 파일은 삭제되지 않아 영구 고아 객체가 된다.
- **트리거**: Supabase DB가 일시 불응하거나 imageGenerationLog 레코드를 찾지 못할 때.
- **사용자 영향**: 스토리지 비용이 증가하고, 관리자가 수동으로 정리해야 하는 고아 파일이 누적됨.
- **검증 노트**: 심각도 조정 없음. 주장된 medium이 적절함.

#### Content DELETE: PUBLISHED/ANALYZED 상태 콘텐츠 삭제 방어 없음

- **위치**: `app/api/sc/contents/[id]/route.ts:80` · **분류**: 버그 · **영역**: 세일즈콘텐츠 코어
- **문제**: DELETE 핸들러(line 80-93)는 소유권(`spaceId`)만 확인하고 콘텐츠 상태를 검사하지 않는다. PUBLISHED나 ANALYZED 상태의 콘텐츠도 삭제할 수 있으며, 이 경우 연결된 ContentDeployment, ContentAsset, ContentVersion 행이 CASCADE 삭제되어 이미 게시된 콘텐츠의 배포 이력과 메트릭 수집 관계가 파괴된다.
- **트리거**: 사용자가 배포된 콘텐츠를 UI에서 삭제 요청.
- **사용자 영향**: 배포 이력, 클릭 이벤트 추적 링크, 버전 히스토리가 일괄 삭제됨. 워커가 COLLECT_METRIC 잡을 처리 중이라면 고아 deployment 참조로 오류 발생.
- **검증 노트**: 주장된 medium과 동일. PATCH에는 명시적 가드가 존재하지만 DELETE에서 누락된 명확한 버그이며, CASCADE로 인한 비가역적 데이터 손실이 발생한다. 단, 악의적 외부 공격이 아닌 인가된 사용자의 실수에 의한 피해 범위이므로 high까지 올릴 근거는 없다.

#### 섹션 AI 생성 실패 시 TextGenerationLog 미기록

- **위치**: `app/api/sc/contents/[id]/generate/route.ts:110` · **분류**: UX · **영역**: 세일즈콘텐츠 코어
- **문제**: 섹션 생성 catch 블록(line 110-113)은 502 응답만 반환하고 `TextGenerationLog`에 실패 행을 기록하지 않는다. 같은 기능의 `/api/sc/ai/generate-text/route.ts`(line 71-81)는 실패 시 status='FAILED'로 로그를 생성한다. 이 불일치로 인해 섹션 AI 생성 오류는 분석 대시보드나 로그에서 추적되지 않는다.
- **트리거**: AI 제공자 오류, 타임아웃, 또는 구성 누락으로 섹션 생성 실패.
- **사용자 영향**: 운영자가 어느 스페이스/사용자에서 섹션 생성이 반복 실패하는지 파악할 수 없음. 문제 진단이 지연됨.
- **검증 노트**: 주장된 medium 심각도가 실제 영향과 일치한다. 기능 실패는 없고 순수 관찰성 갭이므로 상향/하향 조정 불필요.

### 판매분석·홈·채널 (sh-analytics-home)

#### revenue/route.ts의 UTC 기반 날짜 필터로 KST 하루 경계 9시간 누락/초과

- **위치**: `app/api/sh/dashboard/revenue/route.ts:21` · **분류**: 버그 · **영역**: 판매분석·홈·채널
- **문제**: fromParam/toParam('YYYY-MM-DD')를 `new Date(fromParam)`로 파싱하면 UTC 자정(T00:00:00Z)이 생성된다. `to.setHours(23,59,59,999)`도 서버 로컬타임(Vercel=UTC) 기준으로 동작한다. DelOrder.orderDate는 KST instant으로 저장되어 있으므로, groupBy=date 경로의 WHERE 절 `orderDate: { gte: from, lte: to }`는 UTC 기준 경계를 사용하게 되어 KST 00:00~08:59 주문(UTC 전날 15:00~23:59)은 from 경계에서 누락되고, 다음 KST 날짜의 00:00~08:59 주문(UTC to날의 15:00~23:59)이 포함된다. groupBy=date 경로는 행별로 KST 변환(line 93-94)을 해서 버킷은 맞게 들어가지만, 범위 밖 다음날 버킷이 응답에 포함되어 차트에 요청한 to 날짜 다음날 막대가 추가로 나타난다. 비-date 집계 경로(channel aggregation, line 147-168)는 per-row 변환 없이 UTC 경계 그대로 집계하므로 채널별 매출 합계가 최대 9시간 분의 주문이 항상 누락된다.
- **트리거**: 판매분석 채널 탭에서 임의 기간 조회 시. Vercel(UTC) 서버에서 항상 발생. 특히 야간(KST 00:00~09:00) 주문이 있는 날에 영향이 큼.
- **사용자 영향**: 채널 매출 집계에서 매일 KST 자정 전후 9시간 주문이 빠지거나 다른 날에 계산됨. 차트에 요청 종료일 다음날 버킷이 추가로 나타날 수 있음. sales-summary 위젯(+09:00 정확한 KST)과 sales-analytics 채널 차트의 같은 기간 수치가 다르게 표시됨.
- **검증 노트**: 메커니즘은 진짜지만 "채널 집계에서 매일 9시간 주문이 항상 누락"은 과장. 지배적 쓰기 경로(channel-import-parser.ts:363-364,399-410)가 orderDate를 'YYYY-MM-DD'로 정규화 → new Date('YYYY-MM-DD')=UTC 자정 instant로 저장되며, 이 instant는 UTC 경계([D 00:00Z, D 23:59Z])와 KST 경계([D-1 15:00Z, D 14:59Z]) 양쪽에 모두 포함되어 결과가 동일하다. 실제 어긋남은 시간 성분이 있는 orderDate(clone/route.ts:75의 new Date(), 수동 생성 datetime, 텍스트 datetime 셀 passthrough parser:413)에 한정. 반면 발견이 놓친 실제 버그: to.setHours(23,59,59,999)가 UTC 기준이라 toKstDateKey(to)=to+1일이 되어(rocket-revenue.ts:39-41) 과거 구간 조회 시 로켓그로스 채널 매출·차트에 요청 종료일 다음날 VENDOR 스냅샷 하루치가 추가 포함됨. 심각도 high→medium.

#### revenue/route.ts 이전 기간 시프트가 1일 초과 — MoM 비교 날짜 오정렬

- **위치**: `app/api/sh/dashboard/revenue/route.ts:140` · **분류**: 버그 · **영역**: 판매분석·홈·채널
- **문제**: `currentPeriodDays = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1`. `to`가 `setHours(23,59,59,999)`로 설정되어 있어 `to - from`은 항상 정수 일수 미만(29.999...일)이고 `Math.ceil`은 올바른 일수(30)를 반환한다. 그러나 거기에 `+1`이 추가되어 결과가 31이 된다. 예를 들어 7월 1~30일(30일) 조회 시 이전 기간이 5월 31일~6월 28일(30일)로 계산되어 캘린더 기준 전달 같은 기간(6월 1~30일)과 1~2일 어긋난다. 이는 채널 상세 페이지의 `momChange` 증감률 계산에 사용된다.
- **트리거**: 판매분석 채널 탭에서 임의 날짜 범위로 조회 시 항상 발생. 정확히는 groupBy=date가 아닌 경로(채널별 집계 경로)에서 사용됨.
- **사용자 영향**: 채널별 매출 비교의 이전 기간이 1일 오정렬되어 momChange 증감률이 실제와 다름. 전달 대비 매출이 증가했음에도 소폭 감소로 표시되거나 반대로 나타날 수 있음.
- **검증 노트**: 1일 오프셋 오류로 momChange 증감률이 틀리지만, 데이터 손실·보안 영향은 없으며 표시 오류 수준이므로 medium 유지가 적절하다.

#### shipping-today/route.ts가 UTC 서버 시간으로 '오늘' 배치 조회 — KST 날짜 불일치

- **위치**: `app/api/sh/dashboard/shipping-today/route.ts:12` · **분류**: 버그 · **영역**: 판매분석·홈·채널
- **문제**: `todayStart.setHours(0,0,0,0)`과 `todayEnd.setHours(23,59,59,999)`이 Vercel(UTC) 서버에서 실행되므로 UTC 자정 기준으로 '오늘'이 계산된다. 한국 KST는 UTC+9이므로 KST 09:00 이전(예: KST 01:00~08:59)은 UTC 전날로 처리된다. '오늘 배송' 카드는 KST 00:00~08:59에 생성된 배치를 '어제'로 분류하고, KST 09:00 이후만 '오늘'로 표시한다. 또한 '오늘 완료된 배치'(completedAt 필터)도 같은 UTC 경계를 사용한다.
- **트리거**: 한국 시간 자정~오전 9시 사이에 홈 대시보드 방문 또는 해당 시간대에 배치가 생성/완료된 경우 항상 발생.
- **사용자 영향**: 오전 9시 이전 한국 시간에 생성/완료된 배치가 '오늘 배송' 카드에 나타나지 않음. 사용자가 처리했음에도 카드에 반영되지 않아 미처리가 있다고 오해할 수 있음.
- **검증 노트**: 주장된 medium 심각도가 적절하다. 데이터 손실은 없으나 KST 자정~09:00(매일 9시간) 구간에 생성/완료된 배치가 '오늘 배송' 카드에 표시되지 않아 사용자가 미처리 항목으로 오해할 수 있다. 수정 방법: `new Date()`를 KST 오늘 자정으로 보정(`getTime() + 9*60*60*1000` 또는 `date-fns-tz`의 `startOfDay` with `Asia/Seoul`).

#### useSalesAnalysis/useOptionSales: 단위(일/주/월) 변경 시 불필요한 API 재호출 — 로딩 플래시

- **위치**: `src/hooks/use-sales-analysis.ts:67` · **분류**: UX · **영역**: 판매분석·홈·채널
- **문제**: useEffect 의존 배열이 `[unit, range.from, range.to, channelIdsKey]`이다. API URL(`/api/sh/dashboard/revenue?from=...&to=...&groupBy=date&channelIds=...`)에는 `unit` 파라미터가 없다. 단위만 변경하면(기간·채널 유지) 동일한 dateRows를 반환하는 API가 다시 호출되고, `setData({ ...d, loading: true })`가 실행되어 차트가 잠시 로딩 스켈레톤으로 전환된다. use-option-sales.ts line 78에도 동일한 패턴이 있다. 버킷팅(bucketRevenue/bucketOptionQty)은 클라이언트에서 계산하므로 API 재호출 없이 처리 가능하다.
- **트리거**: 판매분석 페이지에서 일/주/월 단위 토글 버튼 클릭 시 매번 발생.
- **사용자 영향**: 단위 전환마다 차트가 로딩 상태로 깜박임. 빠른 클릭 시 여러 번의 불필요한 API 요청 발생. 응답 지연 구간에서 이전 단위의 데이터를 다시 보여주는 race도 발생할 수 있음(cancelled 플래그로 마지막 요청만 반영하나, 전환 직전 잠깐 빈 버킷 상태가 보임).
- **검증 노트**: 원래 주장한 medium 심각도가 정확하다. 기능 장애나 데이터 손실은 없으며, 단위 전환 시 불필요한 네트워크 요청과 로딩 플래시가 발생하는 UX/성능 문제다.

#### SalesAnalyticsPage 채널 목록 fetch 에러 무음 처리 — 빈 화면 無 에러

- **위치**: `src/components/sh/sales-analytics/sales-analytics-page.tsx:119` · **분류**: UX · **영역**: 판매분석·홈·채널
- **문제**: useEffect 내부 채널 목록 fetch 실패 시 `.catch(() => {})` 로 에러를 완전히 무시한다. 채널 조회 실패 시 `channels`는 빈 배열로 유지되고, 이후 `setSelectedChannelIds(new Set([]))`, `allChannelIds = []`가 되어 useSalesAnalysis에서 `channelIdsKey === ''` 조건(line 38)으로 빈 결과가 반환된다. 사용자에게는 채널 필터가 비어있고 차트·테이블이 비어있는 화면만 보이며 에러 표시가 전혀 없다.
- **트리거**: /api/channels?isSalesChannel=true&isActive=true 응답이 5xx 오류이거나 네트워크 장애 시. 첫 로드 시 발생 가능.
- **사용자 영향**: 채널 API 오류 시 사용자가 판매분석 페이지를 열었을 때 '데이터 없음' 상태와 동일하게 보여 오류인지 데이터가 진짜 없는 것인지 구분 불가. 채널을 등록했음에도 분석 화면이 완전히 비어 있어 장애인지 설정 문제인지 파악 어려움.
- **검증 노트**: 원래 주장한 medium 심각도가 적합하다. 데이터 손상이나 보안 위험은 없으며, 채널 API 오류라는 특정 조건(5xx 또는 네트워크 장애)에서만 발생하는 UX 결함이다. 단, 이 상황이 발생하면 사용자가 장애 여부를 전혀 알 수 없어 self-service 디버깅이 불가능하므로 low보다는 medium이 맞다.

### 가격 시뮬레이션 (sh-pricing)

#### lookupCategoryFeePct가 categoryName 없이 호출 → 카테고리별 수수료율 항상 무시

- **위치**: `src/lib/sh/pricing-matrix-calc.ts:228` · **분류**: 버그 · **영역**: 가격 시뮬레이션
- **문제**: calcCell(line 228)과 calcRetailForTarget(line 314) 모두 lookupCategoryFeePct(channel.feeRates) 로 categoryName 인수 없이 호출한다. lookupCategoryFeePct의 시그니처는 두 번째 인수로 categoryName을 받으며, 없으면 '기본' 카테고리 폴백을 반환한다. 결과적으로 채널에 카테고리별 수수료(예: '가전' 12%, '의류' 8.5%, '기본' 10%)가 설정되어 있어도 매트릭스는 항상 '기본' 10%만 적용한다.
- **트리거**: 채널에 '기본'이 아닌 카테고리별 수수료율이 1건 이상 등록된 상태에서 가격 시뮬레이션을 실행할 때.
- **사용자 영향**: 카테고리별 수수료가 다른 채널에서 권장 판매가와 마진 시뮬레이션이 틀린 값을 표시한다. 높은 수수료 카테고리의 마진을 과대, 낮은 수수료 카테고리의 마진을 과소 표시한다. 단 forward 계산(calcCell)과 역산(calcRetailForTarget) 모두 동일하게 '기본'만 쓰므로 내부 일관성은 유지되지만 실제 수수료 대비 잘못된 결과를 보여준다.
- **수정 방향**: MatrixBundle 또는 MatrixInputs에 categoryName 필드를 추가하고, calcCell과 calcRetailForTarget 양쪽에서 lookupCategoryFeePct(channel.feeRates, inputs.categoryName)로 호출한다. 번들 시나리오에서 카테고리가 없으면 null을 넘겨 '기본' 폴백이 동작하도록 유지한다.
- **검증 노트**: 사실관계는 정확하나 high는 과대. (1) calcCell 호출부 주석(pricing-matrix-calc.ts:226 "categoryName fallback '기본'")이 현 동작을 명시적으로 문서화하고 있고, (2) UI도 일관되게 '기본' 요율만 표시(pricing-quick-flow.tsx:780, pricing-channel-board-card.tsx:71)하므로 사용자가 보는 수수료율과 계산이 일치한다(무음 오계산이 아님). (3) MatrixInputs 타입 자체에 카테고리 필드가 없고, 상품 카테고리(InvProduct.groupId→InvProductGroup)와 ChannelFeeRate.categoryName(자유 텍스트) 간 매핑도 스키마에 존재하지 않아, 인수 하나 빠뜨린 버그가 아니라 배관이 안 된 미완성 기능(feature gap)에 가깝다. 시뮬레이션(계획 도구)이며 트리거도 비-기본 카테고리 요율을 등록한 채널에 한정되므로 medium이 적절.

#### PricingDefaultsDialog: minimumAcceptableMargin > platformTargetFair 가능 — 교차 검증 없음

- **위치**: `src/components/sh/products/pricing-sim/pricing-defaults-dialog.tsx:275` · **분류**: 엣지케이스 · **영역**: 가격 시뮬레이션
- **문제**: handleSave(line 275-278)는 plFairVal > plGoodVal 만 검사하고, minimumAcceptableMargin이 platformTargetFair 이상 또는 platformTargetGood 이상인 경우를 검사하지 않는다. 서버의 pricingSettingsSchema(schemas.ts:209-229)에도 교차 필드 검증이 없어 서버 직접 호출 시에도 무효 설정이 저장된다.
- **트리거**: 기본값 설정 다이얼로그에서 '최소 허용 마진'을 '적합 하한' 또는 '높음 임계'보다 높게 설정 후 저장.
- **사용자 영향**: minimumAcceptableMargin이 모든 할인율에서 달성 불가능한 수준이면 maxDiscountForMinMargin이 null이 되어 채널 보드 카드가 항상 '여력 없음'을 표시하고 할인 게이지가 무의미해진다. 사용자가 잘못된 설정으로 시뮬레이션 결과 전체를 신뢰할 수 없게 된다.
- **수정 방향**: handleSave에 if (minMgnVal > Math.min(plFairVal, plGoodVal)) 검증을 추가하고, pricingSettingsSchema에도 .superRefine으로 교차 필드 검증을 추가한다.
- **검증 노트**: 주장된 "medium"이 적절하다. 보안·데이터 유실 문제가 아니고 사용자가 직접 잘못된 값을 입력해야 트리거되지만, 일단 저장되면 시뮬레이션 결과 전체(할인 게이지, 채널 카드)가 무의미해져 사용자가 결과를 신뢰할 수 없게 된다. "low"로 내릴 근거도 "high"로 올릴 근거도 없다.

### 상품·리스팅·생산 (sh-products)

#### Listing DELETE 시 ProductionRunSet FK Restrict → 미처리 500 오류

- **위치**: `app/api/sh/products/listings/[listingId]/route.ts:239` · **분류**: 버그 · **영역**: 상품·리스팅·생산
- **문제**: `ProductionRunSet.listing` 관계는 `onDelete: Restrict`(schema.prisma:1543)로 설정되어 있다. 세트 기반 생산 차수에 포함된 listing을 삭제하면 Prisma가 P2003 FK 위반을 throw하지만, DELETE 핸들러에는 try/catch가 없다. 마찬가지로 `ReorderPlanSet.listing`도 Restrict(schema.prisma:2485)이므로 발주 계획에 포함된 세트 listing 삭제도 동일하게 실패한다.
- **트리거**: 생산 차수 또는 발주 계획에서 참조 중인 ProductListing을 삭제 시도하는 경우
- **사용자 영향**: 사용자에게 의미 없는 500 Internal Server Error가 반환된다. 어떤 리소스가 삭제를 차단하는지 알 수 없어 문제 해결이 불가능하다.
- **수정 방향**: DELETE 핸들러에 try/catch를 추가하고, P2003 오류 시 어떤 레코드(productionRunSet 또는 reorderPlanSet)가 참조 중인지 사전 조회하여 사용자에게 명확한 메시지를 반환한다.
- **검증 노트**: 진짜 버그지만 high는 과대. FK Restrict가 데이터를 실제로 보호하므로 데이터 손실·손상 없음. 영향은 참조 중인 listing 삭제 시 원인 불명 500(UX/진단성 문제)에 국한. 409 + 안내 메시지 처리(또는 pre-check)로 고칠 에러 핸들링 개선 건이라 medium이 적절.

#### SOLD_OUT 상태 필터링이 DB 페이지네이션 이후에 적용 — total 집계 오류

- **위치**: `app/api/sh/products/listings/route.ts:191` · **분류**: 버그 · **영역**: 상품·리스팅·생산
- **문제**: GET /api/sh/products/listings?status=SOLD_OUT 요청 시 DB 쿼리는 `where`에 SOLD_OUT 조건을 포함하지 않고(lines 71–72) `skip/take`로 DB 레벨 페이지네이션을 수행한 뒤, 메모리에서 `effectiveStatus === 'SOLD_OUT'` 필터(line 191)를 적용한다. 반환되는 `total`(line 103)은 SOLD_OUT 이외의 모든 레코드를 포함한다. 결과적으로 한 페이지에 반환되는 row 수가 pageSize보다 적을 수 있고, total 집계가 실제 SOLD_OUT 건수와 다르다.
- **트리거**: 리스팅 목록에서 '품절' 필터를 선택하는 경우
- **사용자 영향**: 페이지네이션 UI가 잘못된 총 건수를 표시한다. 마지막 페이지보다 훨씬 많은 페이지가 있다고 표시되거나, 빈 페이지가 생긴다. 대규모 ACTIVE 목록에서 SOLD_OUT 아이템이 적으면 첫 페이지에 0건이 반환되는 경우도 발생한다.
- **수정 방향**: SOLD_OUT 상태 필터를 DB 쿼리 레벨에서 처리한다. `effectiveStatus`는 재고 계산 결과이므로, 채널재고=0 또는 전체 구성옵션 재고 sum이 0인 조건을 Prisma 쿼리로 표현하거나, 전체 목록을 in-memory로 처리하되 cursor 기반 페이지네이션으로 전환한다.
- **검증 노트**: high→medium: 실제 UI(listings-table.tsx)는 페이지네이션 컨트롤이 없고 pageSize=50 첫 페이지만 조회하므로 "빈 페이지/과다 페이지" 시나리오는 발생하지 않음. 실제 영향은 (1) '총 N개' 표시가 SOLD_OUT 건수가 아닌 전체 건수로 표시, (2) 최근 수정 50건 밖의 SOLD_OUT 리스팅이 무음 누락되는 것. 데이터 손상·보안 아님, '전체 상태' 필터로 우회 가능한 목록 표시 버그.

#### STOCKED_IN 상태 생산 차수 삭제 시 재고 역행 없음 — 감사 추적 단절

- **위치**: `app/api/sh/production-runs/[runId]/route.ts:266` · **분류**: 데이터 무결성 · **영역**: 상품·리스팅·생산
- **문제**: DELETE 핸들러는 status 확인 없이 차수를 삭제한다. STOCKED_IN 차수가 삭제되면, 해당 차수로 추가된 `invMovement` 레코드(referenceId: `prodrun:{id}:...`)는 DB에 남지만 참조 대상인 productionRun 레코드가 없어진다. 실제 재고 수치(invStockLevel)는 변하지 않으므로 phantom 재고가 설명할 근거 없이 남는다.
- **트리거**: STOCKED_IN 상태의 생산 차수를 삭제하는 경우 (UI에서 삭제 버튼이 노출됨)
- **사용자 영향**: 재고 이력을 추적할 때 어떤 생산 차수에서 재고가 추가됐는지 확인할 수 없다. 재고 감사 시 출처 불명 INBOUND가 다수 발생하면 데이터 신뢰가 훼손된다.
- **수정 방향**: DELETE 핸들러에서 status === 'STOCKED_IN'인 경우 PLANNED로 회귀(OUTBOUND 처리)를 먼저 요구하거나, STOCKED_IN 상태 삭제를 명시적으로 차단하고 '입고 완료된 차수는 삭제할 수 없습니다' 오류를 반환한다.
- **검증 노트**: 사실이지만 영향 과장. movement.reason에 차수번호·상품·위치·입고일이 평문 보존되어(transition/route.ts:163) "출처 불명 INBOUND"는 아님 — 끊기는 것은 referenceId 프로그램적 링크와 원가·발주량 메타데이터뿐. 재고 수치는 물리적 입고를 반영한 정확한 값이라 phantom 재고 아님. 감사 추적 저하이지 데이터 손상은 아니므로 medium.

### 배송 (sh-shipping)

#### COMPLETED MANUAL 배치 삭제 시 channelStock 복원 누락 — 재고 영구 감소

- **위치**: `src/lib/sh/batch-delete.ts:15` · **분류**: 데이터 무결성 · **영역**: 배송
- **문제**: `deleteBatchWithMovements`는 DelBatch를 삭제만 한다. DelBatch 삭제 시 ChannelStockMovement는 FK cascade로 삭제되지만, PATCH /batches/[batchId] 완료(COMPLETED) 시 실제로 감소시킨 `productListing.channelStock` 숫자값은 복원하지 않는다. batch-delete.ts의 함수 주석은 "IMPORT 묶음의 OUTBOUND는 차감하지 않았으므로 역산 불필요"라고만 설명하며 MANUAL 묶음의 channelStock 복원을 완전히 생략한다.
- **트리거**: MANUAL 소스이고 listing 매칭 주문이 있는 COMPLETED 배치를 삭제(DELETE /api/sh/shipping/batches/[batchId])하면, ChannelStockMovement는 cascade 삭제되지만 productListing.channelStock 숫자는 감소된 채로 남는다.
- **사용자 영향**: 배치를 실수로 삭제하고 재등록하면 channelStock가 이중 감소된다. 채널 재고 숫자가 영구적으로 실제보다 낮게 표시되며, 이를 수동으로 찾아내기 어렵다.
- **수정 방향**: `deleteBatchWithMovements` 내부 트랜잭션에서, 삭제 전에 ChannelStockMovement를 listing별로 집계한 뒤 `productListing.update({ data: { channelStock: { increment: n } } })`로 복원한다. MANUAL 소스 배치에만 적용.
- **검증 노트**: 진짜 결함이지만 high는 과대. channelStock은 opt-in(null=off)이고 외부 연동 채널은 차감 제외라 영향 범위가 수동 관리 채널로 한정되며, listing 폼에서 수동 수정으로 복구 가능. COMPLETED 배치 삭제는 UI label 타이핑 확인이 필요한 드문 조작. 단 무음 드리프트 + ChannelStockMovement cascade 삭제로 감사 흔적까지 소멸하는 점에서 medium이 적정.

#### channelId 미검증으로 다른 Space의 채널/옵션 참조 가능

- **위치**: `app/api/sh/shipping/import/route.ts:44` · **분류**: 권한/격리 · **영역**: 배송
- **문제**: import 엔드포인트는 formData의 `channelId`가 현재 space에 속하는지 검증하지 않는다(line 44: 비어있는지만 체크). 이 channelId로 ChannelProductAlias를 조회(line 138-146)하고 alias의 optionId를 DelOrderItem에 저장(line 289)한다. 다른 Space의 channelId를 제공하면 해당 Space의 alias/optionId가 조회되어 현재 Space의 주문 아이템에 외부 Space의 optionId가 저장될 수 있다.
- **트리거**: 사용자가 다른 Space의 channelId를 formData에 포함해 POST /api/sh/shipping/import를 호출하면, 해당 채널의 별칭이 로드되고 외부 optionId가 DelOrderItem.optionId에 저장된다.
- **사용자 영향**: 크로스-Space 데이터 오염: 외부 Space의 상품 옵션 ID가 현재 Space의 주문에 연결되어, 매칭 통계·출고 추적이 오염된다. 또한 다른 Space의 alias 구성을 간접적으로 유추할 수 있다.
- **수정 방향**: channelId 수신 후 `prisma.channel.findFirst({ where: { id: channelId, spaceId: resolved.space.id } })`로 소속 검증. 실패 시 400 반환.
- **검증 노트**: 원 주장의 심각도(medium)를 그대로 유지. listing 경로는 line 169의 spaceId 필터로 실질적으로 방어되어 있으나, optionId 직접 매칭 경로와 fulfillments 경로는 실제로 취약하다. 악용에 타 Space UUID 사전 지식이 필요하고 직접적 PII 노출은 없으므로 high 상향은 불필요하다.

#### PII(수취인명) 임포트 에러 시 서버 로그에 평문 기록

- **위치**: `app/api/sh/shipping/import/route.ts:306` · **분류**: 데이터 무결성 · **영역**: 배송
- **문제**: 주문 생성 실패 시 catch 블록(line 306)에서 `{ recipient: first.recipientName }` 형태로 수취인 이름이 평문으로 `console.error`에 찍힌다. 수취인명은 개인정보(PII)로, DB에는 AES-256-CBC 암호화 저장하지만 로그 시스템에는 복호화된 평문이 기록된다.
- **트리거**: 파일 임포트 중 특정 주문 행의 DB 삽입이 실패(외래 키 위반, 중복 등)하면 에러가 로그에 평문 이름과 함께 기록된다.
- **사용자 영향**: 로그 집계 시스템(예: Vercel 로그, 외부 로깅 서비스)에 수취인 이름이 평문 저장된다. 로그에 대한 접근 권한이 있는 자가 PII를 열람할 수 있다.
- **수정 방향**: `recipient: first.recipientName` 을 `recipient: '[REDACTED]'` 또는 `recipientHash: crypto.createHash('sha256').update(first.recipientName).digest('hex').slice(0,8)` 등 비식별화된 값으로 대체.
- **검증 노트**: 주장된 medium 심각도가 적절하다. DB 암호화 정책과 불일치하는 PII 로그 노출이나, 에러 조건 한정 + 로그 접근 제한이라는 완화 요소가 있어 high로 올릴 근거는 없다.

#### orderDate 미매핑 시 '오늘 날짜'로 묵시적 대체 — 과거 이력 잘못된 날짜로 임포트

- **위치**: `src/lib/del/channel-import-parser.ts:403` · **분류**: UX · **영역**: 배송
- **문제**: `parseWithMapping`에서 orderDate 매핑이 없고 FixedDate도 아닐 때(line 403-405), `orderDateRaw`가 빈 문자열이면 `formatDateLocal(new Date())`(오늘 날짜)를 그냥 사용한다. 에러 목록에도 추가되지 않고 조용히 오늘 날짜로 대체한다. 과거 판매 이력 파일을 임포트할 때 사용자가 orderDate 매핑을 설정하지 않으면 모든 주문이 오늘 날짜로 저장된다.
- **트리거**: 사용자가 주문일자 컬럼 매핑 없이 파일을 임포트하거나, 날짜 컬럼이 빈 행이 많은 파일을 임포트할 때.
- **사용자 영향**: 수천 건의 과거 주문이 오늘 날짜로 저장되어, 기간별 매출 통계·발주 예측이 완전히 오염된다. 에러 메시지가 없으므로 사용자는 문제를 인식하지 못하고 이미 잘못 들어간 데이터를 정리하기 어렵다.
- **수정 방향**: date 매핑 없이 `orderDateRaw`가 비어있는 행은 `errors.push({ row: rowNumber, message: '주문일자가 없습니다' })`로 처리하거나, FixedDate를 필수 입력으로 요구하는 검증을 추가한다.
- **검증 노트**: 주장된 medium 심각도가 그대로 적절하다. 자동 헤더 감지(주문일자/주문일시/결제일 등)로 일반 케이스는 자동 매핑되므로 트리거 빈도가 낮지만, 비표준 헤더 파일에서는 조용히 오염된다. 에러 피드백 없이 수천 건의 날짜가 오늘로 저장되는 실제 데이터 무결성 문제다.

#### channelStock decrement에 음수 가드 없음 — 재고가 음수로 진입 가능

- **위치**: `app/api/sh/shipping/batches/[batchId]/route.ts:120` · **분류**: 데이터 무결성 · **영역**: 배송
- **문제**: COMPLETED 전환 시(line 120) `productListing.update({ data: { channelStock: { decrement: n } } })`를 WHERE 절 재고 하한 없이 호출한다. Prisma의 `decrement`는 현재 값이 n보다 작아도 단순 뺄셈을 수행한다.
- **트리거**: 수기로 channelStock을 낮게 설정한 상태에서 배치를 완료하거나, UI 외부(직접 API 호출)로 소량 재고 상태에서 배치를 완료하면 channelStock이 음수가 된다.
- **사용자 영향**: 채널 재고가 음수로 표시되어 UI에서 재고 부족 경고가 왜곡되고, 이후 추가 차감 계산이 잘못된다.
- **수정 방향**: `where: { id: lid, channelStock: { gte: n } }`로 조건을 걸어 재고가 충분할 때만 차감하거나, `Math.max(0, channelStock - n)` 값을 set으로 적용한다.
- **검증 노트**: 주장된 medium 심각도가 적절합니다. 음수 재고는 UI 표시 왜곡과 후속 계산 오류를 초래하나, 금전적 손실이나 데이터 손실로 직접 연결되지는 않습니다. 수정 방법으로는 decrement 전 `channelStock: { gte: n }` WHERE 조건을 추가하거나, 차감 후 0 미만이면 MAX(0, …)로 보정하는 raw update를 사용하는 방법이 있습니다.

#### 배송파일 Content-Disposition 한글 파일명 percent-encoding으로 깨짐

- **위치**: `app/api/sh/shipping/generate-file/route.ts:223` · **분류**: UX · **영역**: 배송
- **문제**: `generate-file/route.ts` line 223와 `generate-file/bundle/route.ts` line 324 모두 `encodeURIComponent(filename)`을 `filename="${filename}"`에 삽입한다. RFC 6266에서 `filename=` 파라미터는 ISO-8859-1 인코딩을 가정하며, percent-encoding을 디코딩하지 않는다. 결과적으로 Chrome/Edge 등 대부분 브라우저는 파일명을 URL-encoded 문자열(예: `%EB%B0%B0%EC%86%A1%ED%8C%8C%EC%9D%BC.xlsx`)로 저장한다.
- **트리거**: 사용자가 한글 배송방식 이름을 사용하는 경우 '배송파일 다운로드' 버튼을 클릭할 때마다 발생.
- **사용자 영향**: 다운로드된 파일의 이름이 한글 대신 `_%EC%9E%90_%EC%97%AC%EB%9F%AC__.xlsx` 형태로 나타나 파일 관리가 불편하다.
- **수정 방향**: RFC 5987 형식 사용: `Content-Disposition: attachment; filename="fallback.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
- **검증 노트**: 보안·데이터 손실 없이 파일명 표시만 영향을 주므로 medium이 적절하다. 다만 한글 배송방식명을 쓰는 모든 사용자에게 매 다운로드마다 발생하므로 low로 낮출 근거는 없다.

## 3. Low (41건)

### 쿠팡광고 캠페인 (ads-campaigns)

#### Overview and records fetch errors silently show empty UI — users cannot distinguish data absence from network failure

- **위치**: `app/d/coupang-ads/campaigns/[campaignId]/page.tsx:387` · **분류**: UX · **영역**: 쿠팡광고 캠페인
- **문제**: The overview useEffect (lines 387–391) and records useEffect (lines 425–429) catch all errors and silently reset state to empty arrays with no user-facing notification. The chart and table are left blank. Users cannot distinguish a genuine 'no data for this period' scenario from a failed API call.
- **사용자 영향**: Users think the campaign has no data and may upload duplicate reports or contact support, when the real issue is a recoverable network error. No retry affordance is shown.
- **수정 방향**: Add a toast notification (using the already-imported `toast` from sonner) or an error state banner when the fetch fails, with a 'Retry' button that re-triggers the effect.
- **검증 노트**: 심각도 조정 없음. 데이터 손상이나 보안 위협이 아닌 순수 UX 가시성 문제로, 원래 주장한 "low"가 적절합니다. 단, records fetch에서 HTTP 에러도 catch가 아닌 삼항 연산자(line 413)로 빈 데이터로 처리되는 추가 경로가 있어 실제 영향 범위는 설명보다 넓습니다.

### 쿠팡광고 수집·실행 (ads-ops)

#### 워커가 타 워크스페이스의 분석 규칙 appliedCount를 조작 가능

- **위치**: `app/api/analysis/reports/[reportId]/complete/route.ts:56` · **분류**: 권한/격리 · **영역**: 쿠팡광고 수집·실행
- **문제**: COMPLETED 보고 시 body.metadata.activeRuleIds 배열로 AnalysisRule.appliedCount를 일괄 증가시키는데, 이 ruleId 목록이 report.workspaceId와 같은 워크스페이스 소속인지 전혀 검증하지 않는다. updateMany에 workspaceId 필터가 없어서 타 워크스페이스 규칙 ID를 포함하면 cross-space write가 발생한다.
- **사용자 영향**: 다른 워크스페이스의 분석 규칙 통계가 임의로 증가되어 분석 대시보드 수치 오염. 데이터 무결성 침해이며 멀티테넌트 격리 위반.
- **수정 방향**: updateMany 쿼리에 workspaceId 필터 추가: where: { id: { in: activeRuleIds }, workspaceId: report.workspaceId }
- **검증 노트**: 코드 사실관계는 정확하나 critical은 과대평가. 유일한 트리거 주체가 전역 WORKER_API_KEY 보유자(이미 완전 신뢰 내부 프린시펄로, 임의 리포트 내용 자체를 조작 가능)이고, 영향은 appliedCount 카운터 +1 통계 오염에 국한되며, 타 워크스페이스 규칙 cuid를 알아야 함. defense-in-depth 필터 누락으로 low가 적절.

#### 수집 런 이중 실행 - 원자적 Claim 없음

- **위치**: `app/api/collection/runs/pending/route.ts:16` · **분류**: 버그 · **영역**: 쿠팡광고 수집·실행
- **문제**: GET /pending은 PENDING 런을 조회만 하고 상태를 바꾸지 않는다. 워커가 이후 PATCH /[runId] { status: RUNNING }으로 별도 전환하는데, PATCH 핸들러(runs/[runId]/route.ts:77)는 status=PENDING 조건 없이 무조건 업데이트한다. 두 워커 프로세스가 동시에 GET /pending을 호출하면 동일한 runId를 받고 각각 PATCH 성공 → 두 워커 모두 같은 수집 런을 실행한다. backfill/worker가 사용하는 CAS 패턴(updateMany + count===0 확인)이 여기엔 없다.
- **사용자 영향**: 동일 날짜의 쿠팡 광고/재고 데이터가 이중으로 업로드·파싱되어 duplicateRows 과다 계산, OUTBOUND 레코드 중복, 리포트 수치 오염.
- **수정 방향**: GET /pending을 CAS 원자적 클레임으로 변경: updateMany({ where: { id, status: 'PENDING' }, data: { status: 'RUNNING', startedAt } })로 대체하고 count===0이면 null 반환. 별도 PATCH 클레임 호출 제거.
- **검증 노트**: 코드 결함은 실재하나 high는 과대평가. 유일한 소비자인 worker/src/manual-poller.ts는 단일 launchd 프로세스 + isProcessing 인메모리 가드(9-13행)로 동작해, 주장된 트리거 중 '빠른 재폴링'은 성립 불가하고 '워커 2개 동시 실행'은 현 배포(단일 워커)에서 운영 실수 없이는 발생하지 않음. 워커 수평 확장 시 medium 이상으로 재격상 필요한 잠재(latent) 결함.

#### 분석 리포트 PENDING→PROCESSING 전환 비원자적 - 이중 AI 호출 가능

- **위치**: `app/api/analysis/reports/[reportId]/run/route.ts:20` · **분류**: 버그 · **영역**: 쿠팡광고 수집·실행
- **문제**: findFirst({ status: 'PENDING' }) 조회(line 20) 후 update({ status: 'PROCESSING' })(line 29) 사이에 원자적 잠금이 없다. 두 워커가 동시에 같은 reportId에 POST하면 둘 다 PENDING 확인 후 각각 PROCESSING으로 전환하고 buildAnalysisContext와 AI API 호출을 각각 실행한다. complete 엔드포인트는 PROCESSING 체크로 두 번째 write를 막지만 AI 비용은 이미 이중 청구된다. backfill claim은 updateMany CAS를 사용하는 반면 이 흐름은 그렇지 않다.
- **사용자 영향**: AI API(Claude 등) 비용 이중 청구. 두 번째 워커는 complete 단계에서 404를 받아 에러 로그가 누적되고 운영 혼란 야기.
- **수정 방향**: update 호출을 updateMany({ where: { id: reportId, status: 'PENDING' }, data: { status: 'PROCESSING' } })로 변경하고 count===0이면 409 반환.
- **검증 노트**: 비원자적 전환은 사실이나 유일한 호출자(worker/src/analysis-poller.ts)가 단일 프로세스 + isProcessing 가드 + 30초 폴링이라 동시 POST는 워커 이중 기동이라는 운영 실수에서만 발생. 발견이 제시한 트리거 중 '워커 재시작'과 '리트라이'는 코드상 성립 안 함(재시작 후 상태=PROCESSING이라 pending 조회에 안 잡히고, run 재시도 로직 없음). 발생해도 영향은 Gemini flash 호출 1회 중복(Claude 아님, 저비용)이고 데이터 손상 없음. high→low.

#### collection/upload 파일 크기 검증 없음

- **위치**: `app/api/collection/upload/route.ts:20` · **분류**: 엣지케이스 · **영역**: 쿠팡광고 수집·실행
- **문제**: file.arrayBuffer()를 호출하기 전 파일 크기를 확인하지 않는다. 워커 키를 가진 주체가 매우 큰 Excel 파일을 업로드하면 서버리스 함수의 메모리 한도(Vercel 기본 1 GB) 초과로 OOM 종료되거나 타임아웃 발생. processUpload 내부에도 크기 가드가 없는 것으로 보인다.
- **사용자 영향**: 서버리스 함수 강제 종료로 해당 수집 런이 RUNNING 상태로 고착, 이후 타임아웃 정리 전까지 신규 수집 차단. 반복 시 서비스 장애.
- **수정 방향**: formData 파싱 후 file.size > MAX_SIZE(예: 50MB)이면 즉시 413 반환. 또는 Content-Length 헤더를 미리 체크.
- **검증 노트**: 발견은 실제이나, 심각도는 medium에서 low로 하향 조정한다. 근거: (1) 접근 제한 — 엔드포인트는 resolveWorkerAuth로 보호되어 워커 키 보유자만 호출 가능하므로 임의 사용자 익스플로잇 경로가 없다. (2) 플랫폼 한도 — Vercel 서버리스 함수는 기본적으로 요청 바디를 4.5 MB로 제한하며, 설명에서 언급한 "수백 MB" 시나리오는 플랫폼 레이어에서 이미 차단된다. (3) 실 데이터 규모 — 쿠팡 광고/수집 Excel 파일은 일반적으로 수 MB 이내다. 단, 동일 코드베이스의 자매 엔드포인트 app/api/reports/upload/route.ts:104-105에 MAX_SIZE = 10 * 1024 * 1024 명시적 가드가 존재하는데 collection/upload에는 없다는 점은 불일치이며 방어적 코딩 관점에서 수정 가치가 있다.

#### analysis/trigger 워커 경로에서 workspaceId 존재 여부 미검증

- **위치**: `app/api/analysis/trigger/route.ts:26` · **분류**: 데이터 무결성 · **영역**: 쿠팡광고 수집·실행
- **문제**: 워커 인증 경로에서 body.workspaceId를 검사하지만 해당 워크스페이스가 DB에 실제로 존재하는지 확인하지 않는다(line 40: workspace = { id: workspaceId }로 단순 할당). 이후 prisma.analysisReport.create에서 FK 위반으로 예외가 발생하면 500 에러가 반환되지만 표준 errorResponse를 거치지 않아 응답 형식이 다르다. 또한 워커 키를 가진 주체가 유효한 workspaceId를 탐색(probing)하는 수단으로 응답 차이를 이용할 수 있다.
- **사용자 영향**: 명확한 에러 메시지 없이 500 반환. 워크스페이스 ID 탐색을 통한 정보 노출 가능성.
- **수정 방향**: workspaceId 수신 직후 prisma.workspace.findUnique로 존재 여부 확인 후 404 반환.
- **검증 노트**: 탐색(probing) 위협은 WORKER_API_KEY 보유를 전제로 하므로 독립적 취약점으로 보기 어렵다. 실질 문제는 FK 예외 미처리로 인한 비표준 500 응답이며, 이는 에러 핸들링 일관성 문제(low)에 해당한다. 워커 키가 안전하게 관리되는 한 외부 공격자가 이 경로를 통해 workspaceId를 탐색하는 시나리오는 현실적이지 않다.

#### collection/schedule cronExpression 유효성 미검증으로 스케줄러 오작동 가능

- **위치**: `app/api/collection/schedule/route.ts:44` · **분류**: 엣지케이스 · **영역**: 쿠팡광고 수집·실행
- **문제**: PUT /collection/schedule에서 cronExpression을 받아 그대로 저장하지만 문법 유효성을 검사하지 않는다. 워커 스케줄러가 이 값을 cron 파서에 넘길 때 잘못된 표현식이면 파서 예외 또는 조용한 오류로 스케줄이 실행되지 않는다. 사용자는 저장이 성공했다고 생각하지만 자동 수집이 멈춘다.
- **사용자 영향**: 자동 수집 스케줄이 무음으로 비활성화됨. 사용자는 데이터 수집이 정상 동작한다고 믿지만 실제로는 멈춰 있어 분석 데이터 단절.
- **수정 방향**: 저장 전 cron 파서(node-cron 등)로 유효성 검증 후 400 반환: try { nodeCron.validate(cronExpression) } catch { return errorResponse(..., 400) }
- **검증 노트**: 발견 자체는 실재하지만, 주장된 트리거 경로(UI 입력)는 사실상 차단돼 있다. 실제 심각도는 medium이 아닌 low가 적절하다.

핵심 근거:
1. **API 미검증은 사실** (`route.ts:44-45`): `cronExpression`을 받아 그대로 `prisma.collectionSchedule.upsert`에 전달, 별도 유효성 검사 없음.
2. **정상 UI 경로는 보호됨** (`schedule-config.tsx:113-122`): UI는 `<Input type="time">`을 사용하며, `timeToCron()` 함수가 항상 `"MM HH * * *"` 형태의 유효한 표현식을 생성한다. 사용자가 UI를 통해 자연어나 형식 오류 cron을 입력하는 것은 현실적으로 불가능.
3. **워커 파서도 예외를 던지지 않음** (`collection-scheduler.ts:58-67`): `matchesCron()`은 parts < 5이거나 `parseInt` 결과가 `NaN`이면 단순히 `false`를 반환. 크래시 없이 조용히 스케줄 미실행.

결론적으로 이 취약점이 발동하려면 **인증된 사용자가 API를 직접 호출**해야 한다. 정상 UI 경

#### 워커 x-workspace-id 미지정 시 findFirst 워크스페이스 비결정적 선택

- **위치**: `src/lib/api-helpers.ts:33` · **분류**: 엣지케이스 · **영역**: 쿠팡광고 수집·실행
- **문제**: resolveWorkspace()에서 워커 인증이 성공했지만 x-workspace-id 헤더가 없으면 prisma.workspace.findFirst()로 첫 번째 워크스페이스를 선택한다. DB 정렬 순서는 보장되지 않아 워크스페이스가 두 개 이상 존재하는 환경에서 비결정적으로 다른 테넌트 워크스페이스가 선택될 수 있다. collection/runs POST 워커 경로(runs/route.ts:88-94)도 비슷하게 findFirst credential로 폴백한다.
- **사용자 영향**: 수집·분석이 의도하지 않은 타 테넌트 워크스페이스에서 실행될 수 있음. 현재는 단일 테넌트로 운영 중이어서 즉각적 영향은 낮으나 다중 워크스페이스 확장 시 데이터 혼용 위험.
- **수정 방향**: x-workspace-id 미지정 시 findFirst 폴백을 제거하고 400 에러 반환. 모든 워커 호출에서 x-workspace-id를 필수 헤더로 강제.
- **검증 노트**: 심각도 low 유지가 적절하다. Workspace는 User와 일대일 관계(ownerId unique 제약)로 현 아키텍처에서 다중 워크스페이스가 실제로 존재하기 어렵고, 코드 주석도 단일 테넌트 전제를 명시한다. 트리거 조건(워커가 x-workspace-id 없이 호출 + DB에 워크스페이스 2개 이상)이 현재 운영 환경에서는 사실상 도달 불가. 다중 테넌트 확장 시점에 함께 수정이 필요한 설계 부채로 분류하는 것이 정확하다.

### 날짜/금액 횡단 (cross-date-money)

#### finance/aggregate.ts `ymOf`·`monthBounds` 로컬 타임존 의존: 서버 timezone이 변경되면 월말 거래 버킷이 틀림

- **위치**: `src/lib/finance/aggregate.ts:20` · **분류**: 버그 · **영역**: 날짜/금액 횡단
- **문제**: `ymOf(d)` (line 20-22)가 `d.getFullYear()`/`d.getMonth()`(로컬), `monthBounds(ym)` (line 40-42)가 `new Date(y, m-1, 1)` (로컬 자정)를 사용한다. Vercel이 UTC로 운영되는 한 현재는 정합하지만, 서버 timezone이 KST로 바뀌거나 동일 코드를 KST CI/테스트 환경에서 실행하면: UTC 말일 거래(예: Jan 31 15:00 UTC = Feb 1 00:00 KST)가 `ymOf`에서 2월로 버킷팅돼 대시보드·현금흐름·월말 잔고 스냅샷 모두 실제 수입/지출이 잘못된 달로 집계된다. `staging/commit/route.ts` line 17-19와 `snapshots.ts` line 7-9에도 동일 로컬 timezone 의존 패턴이 반복된다.
- **사용자 영향**: 월 경계 거래의 재무 집계(수입/지출/순현금흐름/잔고 스냅샷)가 잘못된 달에 포함돼 재무 보고서 숫자 오류 발생. 현재 프로덕션 환경에서는 잠재 위험이지만 실제 발생 시 critical급 영향.
- **수정 방향**: `ymOf`와 `monthBounds`를 UTC 고정으로 교체하거나, KST 유틸(`formatDateToYmdKst`)을 사용해 명시적으로 KST 기준 월 산출. `new Date(Date.UTC(y, m-1, 1))`로 monthBounds를 UTC 고정으로 변경.
- **검증 노트**: 감사는 "medium"으로 분류했으나 "low"가 적절하다. 버그 패턴은 실재하지만: (1) 현재 Vercel UTC 프로덕션은 무영향, (2) KST-only 환경도 `toDate`+`ymOf` 모두 로컬 타임으로 자기일관적이라 무영향, (3) 실제 버그 발생은 "UTC 서버에서 쓴 데이터를 KST 환경에서 읽는" 혼합 시나리오로 좁혀진다. 개발자가 로컬 KST 환경에서 신선한 테스트 DB를 쓰는 일반적 e2e 패턴은 안전하다. 환경 마이그레이션 시에는 critical이 될 수 있으므로 low가 적정하다(medium 과대평가).

### 재무 업로드·확정 (finance-import)

#### FinImport 생성과 FinStagedRow 적재가 트랜잭션으로 묶이지 않아 고아 레코드 발생

- **위치**: `app/api/finance/imports/commit-staging/route.ts:131` · **분류**: 데이터 무결성 · **영역**: 재무 업로드·확정
- **문제**: finImport.create()(131줄)와 finStagedRow.createMany()(215줄)가 동일 $transaction 안에 없다. createMany가 실패(OOM, DB 연결 오류 등)하면 FinImport 레코드는 커밋된 채로 남고 스테이징 행은 0건이다. 에러는 500으로 반환되지만 totalRows=N인 빈 DRAFT 임포트가 DB에 잔류한다.
- **사용자 영향**: 사용자가 500을 받고 재시도하면 새 임포트가 정상 생성된다. 이전 고아 임포트는 staging 화면에 행이 없는 빈 DRAFT로 노출되어 혼란을 주며, 수동 삭제 없이는 계속 잔류한다.
- **수정 방향**: finImport.create 와 finStagedRow.createMany, finMappingPreset.upsert 를 하나의 prisma.$transaction 으로 묶어 원자성을 보장한다.
- **검증 노트**: 트랜잭션 갭 자체는 사실이나 사용자 영향 주장이 틀림. FinImport를 표시하는 UI/API가 존재하지 않으며(전체 grep에서 commit-staging 라우트·generated·e2e 외 finImport 참조 0건), staging 화면(app/api/finance/staging/route.ts)은 FinStagedRow 기준 조회라 행 0건인 고아 임포트는 어디에도 노출되지 않음. 정상 커밋 후에도 임포트 status는 DRAFT로 유지되므로(staging/commit/route.ts:6 주석) 고아는 정상 임포트와 구별조차 안 되는 무해한 DB 잔재. 후속 중복판정은 identityKey/contentHash 기반이라 기능 영향 없음. high/data-integrity → low(DB 위생).

#### 파일 크기 제한 없어 대형 파일 업로드 시 OOM·타임아웃 위험

- **위치**: `app/api/finance/imports/preview/route.ts:31` · **분류**: 엣지케이스 · **영역**: 재무 업로드·확정
- **문제**: preview 라우트(31줄)와 commit-staging 라우트(60줄) 모두 file instanceof File 여부만 확인하고 크기를 검사하지 않는다. commit-staging에서는 file.arrayBuffer()가 두 번 호출된다(92줄 preview 파싱, 96줄 본 파싱). 50MB Excel 파일을 업로드하면 버퍼를 두 번 할당하여 Vercel 서버리스 메모리 한계에 근접한다.
- **사용자 영향**: Vercel 서버리스 함수가 OOM으로 중단되거나 10초 타임아웃에 걸려 500 응답. 여러 사용자가 동시에 대형 파일을 올리면 전반적인 API 성능이 저하된다.
- **수정 방향**: route 진입 직후 file.size 를 체크하여 예: 10MB 초과 시 400 반환. arrayBuffer()를 한 번만 호출해 preview와 parse에 재사용한다.
- **검증 노트**: 감사 설명의 핵심 근거인 "arrayBuffer() 이중 호출로 버퍼 두 번 할당"이 사실과 다릅니다. commit-staging/route.ts:91에서 `const buffer = await file.arrayBuffer()`를 1회만 호출하고, 같은 `buffer` 변수를 92줄 previewFinanceFile과 96줄 parseFinanceWithMapping에 재사용합니다. 이중 메모리 할당은 발생하지 않습니다. 파일 크기 체크 부재 자체는 실재하지만, 이중 할당이 없으므로 메모리 압박은 절반 수준이며, Vercel App Router의 기본 요청 본문 크기 제한이 1차 방어선이 됩니다. 은행/카드 명세서 파일(.xlsx/.csv)이 수십 MB에 달하는 현실적 시나리오가 드물다는 점도 위험을 낮춥니다. 따라서 medium → low로 하향 조정이 적절합니다.

#### 가져오기 버튼 더블클릭·재시도 시 중복 FinImport 생성 (멱등성 없음)

- **위치**: `app/api/finance/imports/commit-staging/route.ts:131` · **분류**: 엣지케이스 · **영역**: 재무 업로드·확정
- **문제**: finImport.create에 고유 제약이 없다(fileName+accountId+periodFrom 등). 사용자가 '가져오기' 버튼을 빠르게 두 번 클릭하거나 네트워크 타임아웃으로 클라이언트가 재시도하면 FinImport 레코드가 두 개 생성된다. 두 번째 임포트의 staged rows도 NEW로 표시된다(아직 FinTransaction이 없으므로 existing 조회 결과가 비어 있음).
- **사용자 영향**: 동일 거래 내역이 스테이징에 두 번 쌓인다. 사용자가 둘 다 확정하면 finTransaction upsert가 동일 identityKey에 두 번 실행되어 최종 결과는 올바르지만, 화면에서 중복 임포트가 보이고 혼란을 준다. 하나를 수동 삭제해야 한다.
- **수정 방향**: 클라이언트: importing 상태 중 버튼 비활성화(현재 canImport 가드 있으나 더블클릭 race 가능). 서버: finImport.create 전 동일 accountId+fileName+periodFrom 존재 여부를 확인하거나 unique 제약 추가.
- **검증 노트**: 주장한 두 트리거 중 하나(더블클릭)는 upload-panel.tsx:195·315·377·720에서 `importing` 상태 + `disabled={!canImport}` 조합으로 이미 방어된다. 실제 위험 경로는 "첫 요청이 서버에서 완료됐으나 응답이 유실된 뒤 사용자가 수동으로 재시도"하는 경우뿐이다. 이 경로는 현실적으로 낮은 빈도이므로 medium → low 하향이 타당하다. DB 고유 제약(@@unique) 또는 서버 측 사전조회 추가로 완전히 수정 가능하다.

#### 단일·일괄 분류 API에서 categoryId 타입(INCOME/EXPENSE)과 거래 방향(IN/OUT) 검증 없음

- **위치**: `app/api/finance/staging/[id]/route.ts:43` · **분류**: 데이터 무결성 · **영역**: 재무 업로드·확정
- **문제**: PATCH /staging/[id](43줄)와 POST /staging/bulk(33줄) 모두 categoryId가 해당 space에 존재하는지만 확인하고 type(INCOME/EXPENSE/TRANSFER)이 transaction의 direction(IN/OUT)과 부합하는지 검사하지 않는다. API를 직접 호출하면 OUT(지출) 거래에 INCOME 카테고리를 할당할 수 있다. learnRule도 이 분류로 EXACT 규칙을 학습한다.
- **사용자 영향**: 잘못 분류된 거래가 재무 대시보드의 수입/지출 집계에 반영되어 현금흐름 수치가 왜곡된다. 잘못 학습된 규칙이 이후 동일 적요의 거래를 자동으로 오분류한다.
- **수정 방향**: category 조회 시 type 필드도 SELECT하여, direction=IN이면 type이 INCOME|TRANSFER, direction=OUT이면 EXPENSE|TRANSFER임을 서버에서 검증한다.
- **검증 노트**: 검증 누락 자체는 실재하나, 주장된 핵심 영향("현금흐름 수치 왜곡")이 틀렸다. dashboard(`aggregate.ts:80`)와 cashflow(`cashflow/route.ts:126`) 모두 수입/지출 집계를 `category.type`이 아닌 `transaction.direction`으로 계산한다. OUT 거래에 INCOME 카테고리를 할당해도 집계 총액은 정확하게 유지된다. 실제 영향은 UI에서 카테고리 레이블이 방향과 불일치하게 표시되는 표시 오류, 그리고 learnRule이 INCOME 카테고리 레이블을 OUT 방향 규칙에 결합시키는 미미한 규칙 오염에 국한된다. 금융 수치 정확성 문제가 아니므로 medium → low로 하향이 적절하다.

### 재무 화면·API (finance-views)

#### 계좌 삭제 확인 시 staged 행 수를 제외하고 거래 수만 안내

- **위치**: `app/api/finance/accounts/[id]/route.ts:84` · **분류**: UX · **영역**: 재무 화면·API
- **문제**: 계좌 삭제 전 `prisma.finTransaction.count({ where: { accountId: id } })`로 확정 거래 수만 집계하여 반환한다. 그러나 스키마에서 FinStagedRow도 FinAccount에 `onDelete: Cascade`로 연결되어 있어, 계좌 삭제 시 staged 행도 함께 삭제된다. 반환된 `deletedTransactions` 숫자는 staged 행을 포함하지 않아 실제 삭제량보다 적게 안내된다.
- **사용자 영향**: 사용자는 '거래 0건' 또는 낮은 건수로 안내받고 계좌를 삭제했지만, 실제로는 분류 작업 중이던 staged 행도 함께 사라진다. 데이터 유실에 대한 사전 경고가 불충분하다.
- **수정 방향**: `prisma.finStagedRow.count({ where: { accountId: id } })`도 함께 조회하여 응답에 포함시키고, 클라이언트 confirm 메시지에 staged 행 수도 함께 표시한다.
- **검증 노트**: 심각도 low는 원래 주장과 동일하며 적절하다. 실제 데이터 손상이나 보안 문제가 아니라 순수 UX 이슈다. 사전 확인 dialog(balances-manager.tsx:95, account-dialog.tsx:168)는 숫자 없는 generic 문구("연결된 거래 내역도 함께 삭제됩니다")만 제공하고 staged 행을 명시하지 않는다. 사후 toast(line 105/178)의 count도 FinTransaction만 반영해 부정확하다. 다만 이 count는 이미 삭제 완료된 뒤 표시되므로 결정에 영향을 주지 않는다. 실질 위험은 "staged 행이 있는 계좌를 삭제할 때 분류 작업 중이던 데이터가 사전 경고 없이 함께 사라질 수 있다"는 점이다.

#### StagedRow 프론트엔드 타입의 cancelFlag가 boolean으로 잘못 선언됨

- **위치**: `src/components/finance/transactions-view.tsx:75` · **분류**: 버그 · **영역**: 재무 화면·API
- **문제**: StagedRow 타입에서 `cancelFlag: boolean`으로 선언되어 있지만, 실제 DB 스키마(prisma/schema.prisma:2787)에서 FinStagedRow.cancelFlag는 `String?`이고 API 응답도 문자열(예: '취소') 또는 null을 반환한다. TypeScript 타입은 런타임에 지워지므로 즉각적 크래시는 없지만, 향후 컴포넌트에서 `cancelFlag === true` 같은 엄격 비교를 추가하면 항상 false로 평가된다.
- **사용자 영향**: 취소 거래에 대한 시각적 구분(취소 표시 등)이 추가될 경우 boolean 타입 가정으로 로직이 오작동할 수 있다.
- **수정 방향**: `cancelFlag: string | null`로 타입을 수정한다.
- **검증 노트**: 현재 컴포넌트에서 cancelFlag 필드를 전혀 소비하지 않으므로 즉각적 오동작은 없다. 심각도 low가 적절하며 상향 조정 불필요.

### 쿠팡 판매→재고 동기화 (inv-coupang-sync)

#### salesQty30d 필드 의미 충돌 — VENDOR_ITEM_METRICS에서는 일일 판매량, INVENTORY_HEALTH에서는 30일 누적

- **위치**: `src/lib/inventory-parser.ts:199` · **분류**: 데이터 무결성 · **영역**: 쿠팡 판매→재고 동기화
- **문제**: parseVendorItemRow(line 199)는 '판매량' 컬럼(해당 수집 일자 단일 판매량)을 salesQty30d에 저장한다. parseInventoryHealthRow(line 131)는 '최근 판매수량_지난 30일' 컬럼(30일 누적)을 같은 salesQty30d에 저장한다. InventoryRecord.salesQty30d는 fileType에 따라 의미가 다르지만, 쿼리 시 fileType 필터 없이 함께 읽히는 경우(현재 GET /api/inventory에서 fileType 미필터, 또는 향후 cross-type 집계)에 일일 수량과 30일 누적이 혼용된다.
- **사용자 영향**: 재고 분석에서 salesQty30d를 30일 누적으로 계산(line 113 inventory-analyzer.ts)하는데 실제로는 1일치 값이 들어오면 재고 부족 임계(avail - sales + inbound <= 0, line 120)가 과도하게 달성돼 허위 재고 부족 알림이 대량 발송된다. 반대로 HEALTH 데이터가 누락되면 부족 탐지가 실패한다.
- **수정 방향**: VENDOR_ITEM_METRICS의 일일 판매량을 salesQty1d 또는 salesQtyDaily 별도 컬럼에 저장하거나, InventoryRecord에 fileType 컬럼을 저장해 소비 측에서 항상 fileType 조건 필터를 강제한다. GET /api/inventory 및 analyzeInventory 모두 fileType: 'INVENTORY_HEALTH' 조건 추가가 선결 조건.
- **검증 노트**: 발견 자체(필드 의미 충돌 + 라우트 미필터)는 실재하나, 주장된 핵심 피해 시나리오(허위 재고 부족 알림 대량 발송)는 이미 방어됨. inventory-analyzer.ts:88에서 `fileType: 'INVENTORY_HEALTH'`로 명시 필터링하므로 VENDOR 일일 데이터가 분석 엔진에 섞이는 경로가 없다. 실제 영향은 GET /api/inventory route.ts의 fileType 미필터로 인한 UI 표시 혼용(동일 snapshotDate가 겹칠 때 VENDOR 행의 salesQty30d가 1일치인데 30일 누적처럼 표시)에 국한되며, 이는 medium이 아닌 low 수준이다.

### 재고·발주·재고대조 (inv-reorder)

#### upsertStockLevel — 첫 번째 행 생성 시 FOR UPDATE가 비행(non-existent) 행을 잠그지 못해 동시 INSERT 충돌

- **위치**: `src/lib/inv/movement-processor.ts:45` · **분류**: 데이터 무결성 · **영역**: 재고·발주·재고대조
- **문제**: lockStockLevel(45~47행)은 SELECT ... FOR UPDATE로 행을 잠근다. 그러나 해당 (optionId, locationId) 행이 아직 존재하지 않으면 FOR UPDATE는 아무 행도 잠그지 않고 빈 결과를 반환한다. 이후 upsertStockLevel(153~173행)에서 existing=null 경로로 tx.invStockLevel.create를 실행하면, 동시에 같은 옵션+위치로 첫 번째 이동을 처리하는 다른 트랜잭션도 existing=null을 보고 create를 시도한다. 두 번째 트랜잭션은 Prisma P2002 unique constraint 오류로 롤백된다.
- **사용자 영향**: 한 요청이 HTTP 500으로 실패하며, 재고 이동이 누락된다. 사용자는 업로드가 실패했다는 오류만 볼 뿐 원인을 알 수 없다.
- **수정 방향**: PostgreSQL advisory lock(pg_advisory_xact_lock(hashtext(spaceId||optionId||locationId))) 또는 raw UPSERT(INSERT ... ON CONFLICT DO UPDATE)를 사용해 행이 없을 때도 원자적으로 처리한다.
- **검증 노트**: 메커니즘은 정확하나 영향이 과장됨. @@unique([optionId, locationId])(schema.prisma:1016-1033)와 트랜잭션 원자 롤백으로 데이터 오염은 불가능 — data-integrity가 아닌 일시적 가용성/UX 문제. 대량 임포트 경로(import-processor.ts:211-242)는 행 단위 catch로 오류를 이력에 기록해 500 없이 사용자에게 행번호+메시지를 보여준다. 트리거는 해당 조합의 '사상 첫 이동' + 밀리초 동시성이 겹치는 극히 좁은 창이며, 재시도 시 즉시 성공하는 자가치유형. 수정은 upsertStockLevel을 Prisma upsert 또는 ON CONFLICT로 바꾸거나 P2002 1회 재시도 추가로 간단.

#### 발주 계획 아이템 PATCH — totalFinalQty 재계산이 트랜잭션 밖에서 실행되어 동시 요청 시 합계 오염

- **위치**: `app/api/sh/inventory/reorder/plan/[planId]/items/[itemId]/route.ts:53` · **분류**: 데이터 무결성 · **영역**: 재고·발주·재고대조
- **문제**: 아이템 finalQty 업데이트(53~64행)와 plan.totalFinalQty 재계산(67~75행)이 별도 await로 실행되며, 두 연산을 하나의 트랜잭션으로 묶지 않는다. 동일 planId에 대해 두 요청이 동시에 들어오면:
1. TX-A가 item-A를 업데이트한다.
2. TX-B가 item-B를 업데이트한다.
3. TX-A가 findMany로 전 아이템을 읽어 totalFinalQty를 계산한다(item-B의 구 값 포함 가능).
4. TX-B가 findMany로 전 아이템을 읽어 totalFinalQty를 계산한다(item-A의 신 값 포함 가능).
마지막에 쓰는 쪽이 이기며, 두 아이템의 최신 값을 반영한 정확한 합이 아닐 수 있다.
- **사용자 영향**: 발주 계획 헤더의 totalFinalQty(총 최종 발주수량)가 실제 아이템 합계와 달라진다. 발주 화면에서 합산 수량이 틀리게 표시되며, 생산차수 생성 기준이 오염될 수 있다.
- **수정 방향**: prisma.$transaction 안에서 reorderPlanItem.update 후 reorderPlanItem.findMany 및 reorderPlan.update를 수행한다. 또는 finalQty 합계를 DB 집계 쿼리(SUM)로 atomically 계산한다.
- **검증 노트**: 경합 자체는 실재하나 영향 범위가 과대평가됨. (1) 다운스트림 확정 경로가 오염된다는 주장은 거짓 — finalize(route.ts:52~66)는 plan.items의 아이템별 finalQty를 신선하게 읽어 confirmedFinalQty로 동결하며, 캐시된 totalFinalQty를 전혀 사용하지 않음. (2) totalFinalQty의 유일한 소비처는 목록 표시(app/d/seller-ops/inventory/reorder/page.tsx:177)와 상세 응답 헤더(plan/[planId]/route.ts:141)로, 표시용 캐시값에 불과함. (3) 재계산이 전체 아이템 findMany 기반이므로 이후 아무 아이템이나 한 번 더 PATCH되면 자가 치유됨. (4) 경합 창은 상대 요청의 item update 커밋과 자신의 findMany 사이 수 ms 수준이며, 두 사용자가 같은 DRAFT 계획의 서로 다른 아이템을 밀리초 단위로 동시 수정해야 발현. high가 아닌 low(일시적 표시 불일치)가 적절.

#### revert — supersededAt 확인과 새 DRAFT 생성이 별도 단계로 실행되어 동시 호출 시 원본 계획 이중 대체

- **위치**: `app/api/sh/inventory/reorder/plan/[planId]/revert/route.ts:37` · **분류**: 데이터 무결성 · **영역**: 재고·발주·재고대조
- **문제**: revert 요청(37~38행)은 plan.supersededAt 확인을 트랜잭션 밖에서 수행한다. 두 요청이 동시에 들어오면 둘 다 supersededAt=null인 상태를 읽고 트랜잭션에 진입한다. 각 트랜잭션은 새 DRAFT 계획을 생성하고 원본 계획의 supersededByPlanId를 자신의 ID로 덮어쓴다. 최종적으로 원본의 supersededByPlanId는 두 번째 revision을 가리키며, 첫 번째 revision은 sourcePlanId=원본을 갖지만 원본에서 역방향 참조가 없는 고아(orphan) 상태가 된다.
- **사용자 영향**: 첫 번째 생성된 DRAFT revision이 사실상 미아가 되어 UI의 계획 목록에 오래된 sourcePlanId를 가진 이상한 계획이 남는다. 사용자가 어느 것이 정당한 revision인지 판단하기 어렵다.
- **수정 방향**: prisma.$transaction 내부에서 reorderPlan.findUnique를 FOR UPDATE 락으로 다시 읽고 supersededAt 확인 후 새 계획을 생성한다. Prisma raw query로 SELECT ... FOR UPDATE를 사용하거나 UPDATE ... WHERE supersededAt IS NULL 기법을 활용한다.
- **검증 노트**: 레이스 윈도우가 수십~수백ms로 좁고, revert 동시 요청은 일상적이지 않은 조작임. 결과도 고아 DRAFT 생성(sourcePlanId로 여전히 추적 가능)이라 완전한 데이터 손실이 아닌 UI 혼란 수준. 수정 방향은 트랜잭션 내부에서 `updateMany({ where: { id: plan.id, supersededAt: null }, data: { supersededAt: ... } })`로 조건부 업데이트를 수행하고 영향 row가 0이면 충돌로 처리하는 낙관적 잠금 패턴이 적절함.

#### OUTBOUND/TRANSFER 음수 재고 경고가 응답에만 포함되고 UI에 보장된 표시 경로 없음

- **위치**: `src/lib/inv/movement-processor.ts:291` · **분류**: UX · **영역**: 재고·발주·재고대조
- **문제**: OUTBOUND(291~293행)와 TRANSFER(380~383행)에서 재고 부족 시 `warnings` 배열에 경고를 추가하고 음수 재고를 허용한다. 이 경고는 processMovement 반환값에 포함되어 movements/route.ts가 `NextResponse.json(result, { status: 201 })`로 내려 보낸다. 그러나 warnings 필드를 프론트엔드가 반드시 표시한다는 보장이 API 계약에 없으며, status 201은 성공을 의미하므로 클라이언트가 경고를 무시하기 쉽다.
- **사용자 영향**: 재고가 음수가 됐음을 사용자가 인지하지 못한 채 이동이 '성공'으로 처리된다. 이후 재고 현황 화면에서 음수 재고가 보이면 원인을 추적하기 어렵다.
- **수정 방향**: 음수 재고 발생 시 HTTP 상태를 207(Multi-Status)로 변경하거나, 또는 warnings가 있을 때 응답 body에 `hasWarnings: true` 최상위 필드를 추가해 클라이언트가 반드시 확인하도록 API 계약을 명시한다.
- **검증 노트**: 주장된 low 심각도가 그대로 적절함. 데이터 손실·보안 문제 없이 순수 UX 공백이며, 재고 현황 화면에서 음수 재고가 보이므로 추적 불가는 아님.

### 플랫폼 인증·격리 (platform-auth)

#### ensureWorkspaceForUser — user.upsert가 트랜잭션 밖에 있어 동시 가입 시 고유 제약 위반

- **위치**: `src/lib/workspace.ts:29` · **분류**: 데이터 무결성 · **영역**: 플랫폼 인증·격리
- **문제**: prisma.user.upsert()가 $transaction 블록 밖(29~33행)에서 실행된 후, workspace.create()가 별도 트랜잭션(37~72행) 안에서 실행된다. Prisma 기본 격리 수준(READ COMMITTED)에서 동시 요청 두 개가 모두 user.upsert 완료 후 트랜잭션에 진입하면 둘 다 findUnique → null을 보고 workspace.create를 시도하여 ownerId 유니크 제약 위반 에러가 발생한다. 이 에러는 API 레이어에서 잡히지 않아 500 응답이 반환된다.
- **사용자 영향**: 회원가입 직후 워크스페이스 생성이 500 오류로 실패하고 사용자가 setup 루프에 빠질 수 있다.
- **수정 방향**: user.upsert를 $transaction 블록 안으로 이동해 user+workspace+spaceMember 생성을 단일 원자 트랜잭션으로 묶는다. 또는 workspace.create 실패 시 unique constraint 에러를 잡아 findUnique로 재조회 후 반환하는 idempotent 패턴을 적용한다.
- **검증 노트**: 레이스 자체는 실재하나 설명의 핵심 인과와 영향이 과장됨. (1) user.upsert가 트랜잭션 밖인 것은 원인이 아님 — READ COMMITTED에서는 upsert를 트랜잭션 안으로 옮겨도 findUnique→create 레이스는 동일하게 존재. 진짜 원인은 workspace를 upsert가 아닌 findUnique+create로 처리하고 P2002를 잡지 않는 것. (2) "/auth/callback도 같은 헬퍼를 공유"는 오독 — callback(app/auth/callback/route.ts:55-61)은 findUnique 후 /workspace-setup 리다이렉트만 하고 ensureWorkspaceForUser를 호출하지 않음. 실제 호출자는 POST /api/workspace와 POST /api/collection/credentials 뿐. (3) "setup 루프" 주장도 과장 — 동시 요청 중 하나는 성공해 워크스페이스가 생성되고, 실패한 요청의 재시도는 existing 경로로 200을 받으므로 자가 치유됨. 실제 영향은 더블클릭 등 좁은 윈도우에서 1회성 500. high → low.

#### storage.ts 서비스 클라이언트가 서비스 역할 키 미설정 시 공개 anon 키로 폴백

- **위치**: `src/lib/supabase/storage.ts:26` · **분류**: 권한/격리 · **영역**: 플랫폼 인증·격리
- **문제**: serviceClient()는 SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SERVICE_KEY → NEXT_PUBLIC_SUPABASE_ANON_KEY 순서로 키를 선택한다(24~26행). 서비스 역할 키 환경변수가 모두 설정되지 않은 환경(preview, 신규 배포 등)에서는 공개 anon 키로 Supabase storage 작업을 수행한다. anon 키는 클라이언트에 노출된 공개 키이며 RLS 정책의 적용을 받으므로 버킷 접근이 예기치 않게 허용되거나 거부될 수 있고, 버킷이 public-read인 경우 업로드는 되지만 권한 경계가 우회된다.
- **사용자 영향**: 서비스 역할이 필요한 storage 작업이 anon 권한으로 실행되어 업로드 실패, 잘못된 파일 접근, 또는 RLS 정책 우회로 인한 보안 경계 훼손이 발생한다. 에러 없이 실패할 경우 사용자는 파일이 저장됐다고 믿지만 실제로는 저장되지 않을 수 있다.
- **수정 방향**: anon 키 폴백(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) 라인을 제거하고 서비스 역할 키가 없으면 명확한 환경 설정 에러를 던진다.
- **검증 노트**: 폴백 코드는 실재하지만 authz/high 분류는 과대평가. anon 키는 service role보다 권한이 낮아 권한 상승·RLS 우회가 불가능하고, 유일한 호출자(app/api/sc/contents/[id]/assets/route.ts)가 resolveDeckContext + spaceId 스코프로 앱 레벨 authz를 이미 수행. storage.ts:78,93이 에러를 throw하므로 "에러 없는 조용한 실패" 주장도 오독. 실제 문제는 서비스 키 미설정 환경에서 명확한 fail-fast(27행 에러) 대신 anon 키로 시도해 혼란스러운 에러 또는 설정 누락 은폐가 발생하는 설정 위생 이슈 — low/robustness가 적절.

#### resolveSpaceContext() — findFirst에 orderBy 없어 사용자가 다중 멤버십 보유 시 비결정적 Space 반환

- **위치**: `src/lib/api-helpers.ts:73` · **분류**: 엣지케이스 · **영역**: 플랫폼 인증·격리
- **문제**: prisma.spaceMember.findFirst({ where: { userId: user.id } })는 orderBy 없이 호출된다. 동일 사용자가 두 개 이상의 Space에 멤버십을 갖는 경우(버그로 중복 생성되거나 향후 다중 Space 기능 추가 시), 반환되는 Space는 PostgreSQL heap 순서에 따라 비결정적이다. 이를 기반으로 이후 모든 API가 spaceId로 데이터를 격리하므로 잘못된 Space로 격리가 적용된다.
- **사용자 영향**: 사용자가 의도하지 않은 다른 Space의 데이터를 보거나 수정할 수 있다.
- **수정 방향**: orderBy: { createdAt: 'asc' }를 추가해 결정적 동작을 보장하거나, 추후 다중 Space 지원 시 요청 헤더의 명시적 spaceId로 Space를 선택하도록 개선한다.
- **검증 노트**: 현재 앱에는 사용자를 여러 Space에 추가하는 API 경로가 없고, ensureWorkspaceForUser 트랜잭션이 중복 생성을 방지한다. 트리거 조건이 실용적으로 불가능하므로 medium → low로 하향. 향후 다중 Space 기능 추가 시 orderBy: { createdAt: 'asc' } 또는 명시적 spaceId 파라미터로 보강 권고.

### 세일즈콘텐츠 분석·UTM (sc-analytics)

#### scheduleDailyMetricCollection이 중복 실행 시 동일 배포에 COLLECT_METRIC 잡을 중복 enqueue

- **위치**: `src/lib/sc/collector-scheduler.ts:26` · **분류**: 데이터 무결성 · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: enqueueJob 호출 전 해당 배포에 이미 PENDING 또는 CLAIMED 상태의 COLLECT_METRIC 잡이 있는지 확인하지 않는다. POST /api/sc/analytics/schedule-collection이 동시에 두 번 호출되거나(더블 클릭, 재시도), 워커 cron과 사용자 수동 트리거가 겹치면 같은 배포에 대해 중복 잡이 생성된다.
- **사용자 영향**: 두 워커가 같은 배포의 어제 메트릭을 동시 수집하면 upsertDeploymentMetric은 last-write-wins로 동작하여 데이터 정합성은 우연에 의존한다. 또한 잡 큐가 오염되어 후속 스케줄링 지연이 발생한다.
- **수정 방향**: enqueueJob 전 prisma.salesContentJob.findFirst({ where: { kind: 'COLLECT_METRIC', targetId: d.id, status: { in: ['PENDING', 'CLAIMED'] } } })로 존재 여부를 확인하거나, (deploymentId, date, kind) 복합 unique 제약으로 DB 레벨에서 보장한다.
- **검증 노트**: 중복 enqueue 가능성은 사실이나 data-integrity 영향은 없음. DeploymentMetric의 @@unique([deploymentId, date, source]) + upsertDeploymentMetric 멱등 upsert(metrics.ts:499-536)로 중복 잡이 실행돼도 같은 소스의 동일 스냅샷이 같은 행에 쓰일 뿐 데이터 오염 불가. 또한 schedule-collection 엔드포인트를 호출하는 UI/워커 cron이 develop에 아직 없어(collector-scheduler.ts:3 주석 '예정') 주장된 트리거(버튼 더블클릭, cron+수동 병렬)는 현재 실현 불가. 실질 영향은 향후 호출자 구현 시 중복 플랫폼 API 호출 낭비 정도 → low/efficiency로 정정.

#### /c/[slug] 리다이렉터에서 buildTargetUrl 예외 미처리 — 잘못된 targetUrl 저장 시 500 반환

- **위치**: `app/c/[slug]/route.ts:35` · **분류**: 버그 · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: buildTargetUrl(deployment.targetUrl, ...)가 내부에서 new URL(originalUrl)(utm.ts:29)을 호출한다. targetUrl이 유효하지 않은 URL이면(예: DB에 직접 쓴 데이터, 구 레거시 레코드, 상대 경로) TypeError가 발생한다. 이 예외를 잡는 try/catch가 route 핸들러에 없어 Next.js가 500을 반환한다.
- **사용자 영향**: 공개 단축 링크를 클릭한 외부 사용자에게 서버 오류 500 페이지가 보여진다. 캠페인 단축 URL이 전파된 경우 모든 클릭이 실패하며 클릭 이벤트도 기록되지 않는다.
- **수정 방향**: buildTargetUrl 호출을 try/catch로 감싸고 URL 파싱 실패 시 NextResponse.redirect(deployment.targetUrl, 302)로 fallback하거나 410 Gone을 반환한다.
- **검증 노트**: 심각도를 medium → low로 낮춥니다. 정상 API 경로(`POST /api/sc/deployments`)는 `deploymentCreateSchema`의 `z.string().url()`(schemas.ts:176)로 반드시 유효한 URL만 저장하고, `deploymentUpdateSchema`도 `deploymentCreateSchema.partial()`를 상속해 업데이트 경로도 동일하게 보호됩니다. 따라서 트리거는 Prisma Studio 직접 편집, 스키마 추가 이전 레거시 레코드, 또는 ORM을 우회한 raw SQL 삽입처럼 정상 경로 외의 방법으로만 가능합니다. 공개 리다이렉터에 try/catch가 없는 것은 실제 결함이지만, 내부 관리자 접근이 필요한 트리거 조건이고 프로덕션에 레거시 레코드가 없다면 발현 확률이 낮습니다.

#### getContentMetricsTotal이 spaceId 필터 없이 contentId만으로 deployments를 조회

- **위치**: `src/lib/sc/metrics.ts:188` · **분류**: 권한/격리 · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: getContentMetricsTotal(contentId)는 prisma.contentDeployment.findMany({ where: { contentId } })를 spaceId 제약 없이 실행한다(188~194행). 호출처인 contents/[id]/page.tsx(97행)는 Promise.all 안에서 content(spaceId 체크 포함)와 메트릭을 동시에 조회한다. 다른 Space의 contentId가 URL에 직접 입력되면 content는 null이 되어 notFound()로 빠지지만, 메트릭 쿼리는 이미 실행되어 cross-space deployments를 DB에서 읽는다.
- **사용자 영향**: UI에는 노출되지 않지만 불필요한 cross-space DB 접근이 발생한다. 함수 재사용 시(다른 호출처 추가 시) spaceId 없이 cross-space 데이터가 반환될 위험이 있다. 함수 계약이 spaceId 없이 설계되어 향후 오용 가능성이 높다.
- **수정 방향**: getContentMetricsTotal 시그니처에 spaceId를 추가하고 findMany where에 spaceId 조건을 포함시킨다. 또는 page.tsx에서 content null 체크 후 조건부로 메트릭을 조회한다.
- **검증 노트**: 현재 단일 호출처(page.tsx)에서 결과가 사용자에게 전달되기 전에 notFound()로 차단됩니다. 실질적 데이터 유출은 없고, 불필요한 cross-space DB 쿼리 실행이 전부입니다. 함수 계약 상의 spaceId 누락은 방어적 설계 문제이지만, 현재 코드에서 악용 가능한 authz 결함은 아닙니다. medium → low로 하향합니다.

#### scheduleDailyMetricCollection에서 배포마다 별도 channel 조회 — N+1 쿼리

- **위치**: `src/lib/sc/collector-scheduler.ts:18` · **분류**: 버그 · **영역**: 세일즈콘텐츠 분석·UTM
- **문제**: 함수는 PUBLISHED 배포 목록을 먼저 조회한 뒤(12~16행), for 루프 안에서 각 배포의 channelId로 prisma.salesContentChannel.findUnique를 개별 호출한다(18~22행). 배포가 N개이면 1 + N 쿼리가 발생한다.
- **사용자 영향**: 배포 수가 수백 건에 달하면 스케줄링 API 응답이 수 초 이상 지연되거나 DB 연결 풀이 고갈될 수 있다. 워커의 daily cron 사이클 전체가 느려진다.
- **수정 방향**: findMany에서 include: { channel: { select: { collectorMode: true } } }로 채널을 join하여 단일 쿼리로 처리한다.
- **검증 노트**: daily cron 전용 경로(실시간 API 아님)이고 채널 수가 극단적으로 증가할 가능성이 낮아 실 체감 영향은 제한적이다. 심각도 low를 그대로 유지한다.

### 세일즈콘텐츠 코어 (sc-core)

#### Worker가 채널 자격증명을 COOKIE 종류만 하드코딩으로 조회 → OAUTH/API_KEY 채널 인증 실패

- **위치**: `app/api/sc/jobs/worker/route.ts:60` · **분류**: 버그 · **영역**: 세일즈콘텐츠 코어
- **문제**: `readChannelCredential(deployment.channelId, 'COOKIE')` 호출이 credential kind를 하드코딩한다(line 60). OAUTH 또는 API_KEY 기반 채널(예: 향후 인스타그램/유튜브 통합)은 이 호출에서 항상 null을 반환받아 워커가 빈 credential로 게시를 시도하게 된다.
- **사용자 영향**: 해당 채널의 모든 배포가 AUTH_FAILED로 즉시 FAILED 처리됨. 최대 3회 재시도 후 영구 실패. 사용자는 설정이 올바른데도 배포가 항상 실패하는 원인을 알 수 없음.
- **검증 노트**: 하드코딩은 사실이지만 영향이 과대평가됨. credential을 소비하는 publisher는 BLOG_NAVER+BROWSER(COOKIE가 올바른 kind, 버그 없음)와 THREADS+API 둘뿐이며, 후자(ThreadsApiPublisher)는 PoC 스켈레톤으로 토큰이 정상 전달돼도 무조건 NOT_IMPLEMENTED를 반환한다(worker/src/sc/publishers/threads-api.ts:26-33). 즉 현재 이 버그로 '성공했어야 할 배포'가 실패하는 경로는 없고, 실질 영향은 미구현 기능에서 NOT_IMPLEMENTED 대신 오해 유발성 AUTH_FAILED가 나오는 것뿐. 향후 Threads API 실통합 시 수정 필요한 잠복 결함으로 low가 적정.

#### Content PATCH: snapshotContent와 content.update가 별도 트랜잭션 → 실패 시 고아 스냅샷 생성

- **위치**: `app/api/sc/contents/[id]/route.ts:55` · **분류**: 데이터 무결성 · **영역**: 세일즈콘텐츠 코어
- **문제**: `snapshotContent`(line 55-59)와 `prisma.content.update`(line 61-76)가 하나의 트랜잭션 안에 묶여 있지 않다. `snapshotContent`가 성공한 뒤 `content.update`가 실패하면 실제 수정이 반영되지 않은 고아 스냅샷이 ContentVersion 테이블에 남는다. 또한 두 요청이 동시에 실행되면 같은 pre-update 상태를 두 번 스냅샷할 수 있어 버전 히스토리가 부정확해진다.
- **사용자 영향**: 버전 히스토리에 실제 변경 내용과 대응되지 않는 중복/고아 스냅샷이 쌓임. 사용자가 '이전 버전 복원'을 시도할 때 잘못된 상태로 롤백될 위험.
- **검증 노트**: 트랜잭션 분리는 사실이나 핵심 영향 주장이 틀림. 스냅샷은 항상 실제 존재했던 상태의 사본이므로 '잘못된 롤백' 위험은 없음. update 실패/동시 PATCH 시 최악 결과는 현재 상태와 동일한 중복 버전 row(히스토리 노이즈)뿐이며, 동시성 충돌은 P2002 재시도로 이미 처리됨. high(data-integrity) → low(cosmetic/noise)로 하향.

#### AI 이미지 assets 엔드포인트: 요청 본문 미검증 → 무제한 길이 prompt 및 임의 aspectRatio 허용

- **위치**: `app/api/sc/contents/[id]/assets/route.ts:102` · **분류**: 엣지케이스 · **영역**: 세일즈콘텐츠 코어
- **문제**: AI 모드의 요청 본문이 Zod 스키마 없이 TypeScript 타입 캐스팅만으로 처리된다(line 102-111). `prompt` 최대 길이, `negativePrompt` 최대 길이, `aspectRatio` 유효 값 목록이 런타임에 전혀 검증되지 않는다. 반면 `/api/sc/ai/generate-image/route.ts`는 동일 기능에 Zod를 사용한다.
- **사용자 영향**: 과도하게 긴 프롬프트가 AI 제공자 API 오류를 유발해 크레딧이 차감·환불되는 불필요한 사이클이 발생. 임의 aspectRatio는 제공자 측 오류 메시지가 사용자에게 502로 노출됨.
- **검증 노트**: 인증된 사용자만 접근 가능하고(resolveDeckContext 게이팅), 오류 시 크레딧이 환불(refundImageCredit)된다. 실제 피해는 불필요한 API 왕복과 provider 오류 메시지 502 노출에 그친다. 데이터 유출·권한 우회·크레딧 영구 손실 없음. 주장된 medium보다 한 단계 낮은 low가 더 정확하다.

#### Credentials DELETE: kind 파라미터 런타임 검증 없이 타입 캐스팅

- **위치**: `app/api/sc/channels/[id]/credentials/route.ts:86` · **분류**: 엣지케이스 · **영역**: 세일즈콘텐츠 코어
- **문제**: `const kind = url.searchParams.get('kind') as 'COOKIE' | 'OAUTH' | 'API_KEY' | null`(line 86)로 URL 파라미터를 enum 타입으로 캐스팅만 할 뿐, Zod 등으로 유효 값을 런타임 검증하지 않는다. 유효하지 않은 kind 값이 `deleteChannelCredential`에 전달되면 Prisma enum 오류가 throw되어 catch 블록(line 97)에서 404('자격증명을 찾을 수 없습니다')가 반환되어 오해를 유발한다.
- **사용자 영향**: 오류 메시지가 400 Bad Request가 아닌 404로 반환되어 클라이언트 측 디버깅이 어려움.
- **검증 노트**: 주장된 low 심각도가 정확하다. 잘못된 kind 값으로는 실제 데이터 삭제가 불가능하고, 보안 취약점도 없다. 영향은 400 대신 404가 반환되는 API 의미론적 불일치에 한정된다.

#### Content 상태 전이 업데이트에서 WHERE 절에 spaceId 누락

- **위치**: `app/api/sc/contents/[id]/transition/route.ts:55` · **분류**: 엣지케이스 · **영역**: 세일즈콘텐츠 코어
- **문제**: `prisma.content.update({ where: { id }, data: {...} })`(line 55)는 소유권 검증(line 19-23) 이후에 실행되지만 별도 쿼리이므로 원자성이 없다. 두 쿼리 사이에 이론적으로 콘텐츠의 spaceId가 변경될 수 있다(extremely unlikely). 방어적으로 `where: { id, spaceId: resolved.space.id }`를 사용하는 것이 일관성 있는 패턴이다. 나머지 엔드포인트(PATCH, DELETE)도 동일 패턴이므로 코드베이스 전반의 일관성 문제이기도 하다.
- **사용자 영향**: 실제 영향 없음에 가깝지만, 방어적 패턴 미적용으로 미래 스키마 변경 시 취약점이 될 수 있음.
- **검증 노트**: 원래 주장한 심각도(low)가 적절합니다. 수정 불필요.

### 판매분석·홈·채널 (sh-analytics-home)

#### channels/reorder PUT: orderedIds 크기 제한 없음 — 대량 트랜잭션 DoS 가능

- **위치**: `app/api/channels/reorder/route.ts:31` · **분류**: 엣지케이스 · **영역**: 판매분석·홈·채널
- **문제**: `orderedIds` 배열의 크기 검증이 없다. 스페이스 격리 검증(line 23-28)은 owned.length !== orderedIds.length 체크이므로 중복 ID를 허용하지 않지만, 수백~수천 개의 유효 채널 ID를 포함한 요청 시 `prisma.$transaction(orderedIds.map(...update))` 가 단일 트랜잭션에서 같은 수의 UPDATE를 실행한다. 일반적인 채널 수는 수십 개지만 외부에서 공격적 요청 시 DB 부하가 발생한다.
- **사용자 영향**: 정상 사용자에게는 영향 없으나, 악의적이거나 잘못된 클라이언트가 호출 시 DB 트랜잭션 스파이크로 서비스 응답 지연 발생 가능.
- **검증 노트**: 심각도 low는 그대로 유지. 추가 상향 불필요. 공격은 인증된 사용자 + 자기 소유 채널 한도로 이중 제한되므로, 실질 DoS 가능성은 이론적 수준에 그친다.

#### sales-by-option 응답에 groupBy=date를 URL 파라미터로 전달하지만 라우트에서 무시됨 — API 계약 불일치

- **위치**: `app/api/sh/dashboard/sales-by-option/route.ts:14` · **분류**: 엣지케이스 · **영역**: 판매분석·홈·채널
- **문제**: 클라이언트 use-option-sales.ts(line 48)는 URL에 `groupBy=date`를 포함하지만, sales-by-option/route.ts의 파라미터 파싱(line 14-18)은 `from`, `to`, `channelIds`만 읽고 `groupBy`를 무시한다. 라우트는 항상 date-level 행을 반환하므로 현재 동작에는 문제가 없지만, 향후 groupBy=channel 같은 옵션을 추가하면 기존 클라이언트가 의도치 않게 date 응답을 받아 파싱 오류가 발생할 수 있다. 또한 API 계약이 불명확해 유지보수 혼란을 유발한다.
- **사용자 영향**: 현재 사용자에게 직접 영향 없음. 개발자 혼란 및 향후 기능 확장 시 잠재적 회귀 위험.
- **수정 방향**: sales-by-option/route.ts에 `const groupBy = searchParams.get('groupBy')` 파싱을 추가하거나, use-option-sales.ts에서 groupBy=date 파라미터를 제거.
- **검증 노트**: 현재 기능 영향 없음. 라우트가 항상 date-level 행을 반환하므로 groupBy=date를 보내는 클라이언트 동작과 일치합니다. 다만 groupBy를 무시한다는 명시적 문서화나 주석이 없어 API 계약이 불명확한 것은 사실입니다. low 유지.

### 가격 시뮬레이션 (sh-pricing)

#### 시나리오 저장 시 promotionType/Value가 calculatePricing에 미전달 → 캐시된 마진/수익 부정확

- **위치**: `app/api/sh/pricing-scenarios/route.ts:195` · **분류**: 데이터 무결성 · **영역**: 가격 시뮬레이션
- **문제**: POST/PATCH 핸들러가 PricingScenario의 promotionType과 promotionValue를 DB에 저장(POST:176-177, PATCH:209-210)하지만, 각 item의 결과를 계산하는 calculatePricing 호출(line 195-206, PATCH:235-246)에는 promotion 파라미터를 전혀 전달하지 않는다. calculatePricing은 discountRate(컬럼 할인)만 반영하므로, 예를 들어 promotionType='PERCENT' promotionValue=0.1(10% 프로모션)이 설정된 시나리오에서도 finalPrice/netProfit/margin 캐시 값은 프로모션 미적용 기준으로 저장된다.
- **사용자 영향**: 시나리오 목록(GET /api/sh/pricing-scenarios)에서 집계하는 averageMargin 및 totalNetProfit이 프로모션 효과를 반영하지 않아 과대 계상된 마진 데이터를 보여준다. 사용자가 의사결정에 틀린 수익률 수치를 사용하게 된다.
- **수정 방향**: calculatePricing을 확장하거나 별도 프로모션 적용 로직을 추가해, promotionType/Value에 따라 salePrice에서 차감한 vite finalPrice를 계산 기준으로 삼아야 한다. 또는 calculateMatrix 경로처럼 프로모션을 포함한 단일 계산 경로로 통일한다.
- **검증 노트**: 코드 사실관계(promotion이 calculatePricing에 미전달, 캐시/집계 미반영)는 정확하나, 스냅샷 전체에서 /api/sh/pricing-scenarios를 호출하는 클라이언트가 0건. 현행 가격 시뮬 UI(pricing-quick-flow)는 promotion을 클라이언트 calculateMatrix로 계산하고 이 API를 쓰지 않으므로 주장된 사용자 영향(목록 마진 과대표시로 의사결정 오류)은 현재 도달 불가. high→low로 하향.

#### defaultAdCostPct가 PricingFullSettings 내에서 0~100 단위, 다른 비율 필드는 0~1 — 단위 불일치

- **위치**: `src/components/sh/products/pricing-sim/pricing-quick-flow.tsx:144` · **분류**: 버그 · **영역**: 가격 시뮬레이션
- **문제**: PricingFullSettings 타입에서 defaultAdCostPct와 defaultOperatingCostPct는 0~100 퍼센트 단위로 저장되고(pricing-defaults-dialog.tsx:28 주석 참조), defaultReturnRate, defaultVatRate, defaultChannelFeePct, platformTargetGood 등은 0~1 비율 단위로 저장된다. liveFromSettings(line 144)에서 adCostPct: s.defaultAdCostPct / 100 로 보정하지만, 동일 타입 내에서 두 가지 단위가 혼재한다. pricingSettingsSchema(schemas.ts:211-212)도 두 필드에 max(100)을 적용해 서버-클라이언트 계약을 이중으로 유지한다.
- **사용자 영향**: 현재 코드는 liveFromSettings에서 /100 보정이 있어 정상 동작하지만, 향후 defaultAdCostPct를 직접 읽는 코드가 추가될 때 100배 과다 광고비 계산 버그가 발생할 수 있다. 예: adCostPct=8을 0~1로 오해하면 광고비가 800%가 되어 매도 마진이 항상 음수로 나타난다.
- **수정 방향**: PricingFullSettings의 defaultAdCostPct를 0~1 단위로 통일하고, 다이얼로그 내부에서만 /100·*100 변환을 수행한다. pricingSettingsSchema 서버 검증도 max(1)로 변경한다.
- **검증 노트**: 심각도 medium → low 하향. 현재 코드에 버그 없음(liveFromSettings line 144에서 /100 변환 정확히 수행). 단위 불일치는 타입 주석("기본 비용 0~100% 단위 그대로 DB 저장" vs "0~1 단위 DB 저장")과 pricingSettingsSchema max(100) 검증으로 명시적으로 문서화된 의도된 설계. 잠재적 트랩은 실재하나 방어막이 이미 구비되어 있어 medium이 아닌 low(기술 부채/코드 스멜) 수준.

#### 채널 보드 카드: 'VAT 포함' 레이블 하드코딩 — includeVat=false 시 오표시

- **위치**: `src/components/sh/products/pricing-sim/pricing-channel-board-card.tsx:176` · **분류**: UX · **영역**: 가격 시뮬레이션
- **문제**: 헤드라인 공급가 표시(line 176)에 '· VAT 포함 ·' 텍스트가 하드코딩되어 있다. globals는 Props로 전달되므로 globals.includeVat 값 접근이 가능하지만 확인하지 않는다. globals.includeVat=false이면 cell.revenue = finalPrice(VAT 미포함 공급가 = 판매가 그대로)이므로 표기와 실제 의미가 다르다.
- **사용자 영향**: VAT 미적용 모드에서도 '공급가 X원 · VAT 포함'이라고 표시되어 사용자가 공급가 계산에 VAT가 제거되었다고 오해하거나, 반대로 실제로는 VAT가 포함된 가격임에도 제거된 것으로 착각할 수 있다.
- **수정 방향**: globals prop을 구조 분해해 includeVat를 읽고, '· VAT {globals.includeVat ? '포함' : '미포함'} ·'로 동적 렌더링한다.
- **검증 노트**: 심각도 변경 없음. 계산 결과는 올바르고 표시 텍스트만 조건부로 바꾸면 되는 단순 UX 수정이므로 low가 적합하다.

#### PricingPromotionCard: rawVal 상태가 부모 value.value 변경 시 미동기화

- **위치**: `src/components/sh/products/pricing-sim/pricing-promotion-card.tsx:80` · **분류**: 버그 · **영역**: 가격 시뮬레이션
- **문제**: PromotionContent 컴포넌트는 rawVal을 useState(String(value.value || ''))로 초기화한다. 이후 부모가 value prop을 바꿔도(예: 초기화 버튼, 외부 리셋) rawVal은 갱신되지 않는다. handleTypeChange(line 90-96)은 rawVal을 읽어 numVal을 계산하므로, 부모가 value를 외부에서 변경한 뒤 사용자가 타입을 바꾸면 이전 rawVal 값이 새 타입의 value로 전달된다.
- **사용자 영향**: 초기화 후 프로모션 유형을 변경하면 이전에 입력했던 값(예: 1000원)이 새 유형의 value로 설정된다. 사용자가 의도하지 않은 할인값으로 마진 시뮬레이션이 계산될 수 있다.
- **수정 방향**: useEffect(() => { setRawVal(String(value.value || '')) }, [value.value])를 추가해 부모 value 변경 시 rawVal을 동기화한다. rawMinThr도 동일하게 처리한다.
- **검증 노트**: 원래 보고된 low 심각도가 정확함. 실제 주문/거래가 아닌 마진 시뮬레이션 UI이고, 타입 변경 후 입력 필드에 old rawVal이 노출되어 사용자가 인지·수정 가능하다. 단순 표시 버그 수준.

### 상품·리스팅·생산 (sh-products)

#### next-run-no TOCTOU 경쟁 — 동시 요청 시 같은 차수 번호 제안

- **위치**: `app/api/sh/production-runs/next-run-no/route.ts:14` · **분류**: 엣지케이스 · **영역**: 상품·리스팅·생산
- **문제**: 현재 최대 runNo를 읽은 뒤 +1한 값을 반환하는 read-then-suggest 패턴을 사용한다. 두 클라이언트가 동시에 이 엔드포인트를 호출하면 둘 다 같은 runNo(예: 2026-042)를 받는다. 한 쪽이 먼저 생산 차수를 생성하면, 나머지 한 쪽은 P2002로 409를 받지만 UI는 '같은 차수 번호가 이미 존재합니다' 오류만 표시하고 자동 재시도가 없다.
- **사용자 영향**: 한 사용자가 차수 번호 충돌 오류를 겪고 폼을 다시 열어 번호를 재확인해야 한다. 빈번하게 발생하지 않지만 다중 사용자 환경에서 혼란을 유발한다.
- **수정 방향**: 차수 번호 생성을 DB 레벨 sequence나 트랜잭션+재시도 패턴으로 처리하거나, 생성 POST 실패 시 클라이언트가 새 번호를 자동으로 다시 fetch하도록 409 응답에 nextRunNo를 포함시킨다.
- **검증 노트**: DB 유니크 제약(@@unique([spaceId, runNo]))이 데이터 무결성을 완전히 보호한다. 충돌 시 POST 핸들러가 P2002를 잡아 409를 반환하므로 중복 생성은 불가능하고, 결과는 사용자가 폼을 재오픈하는 UX 마찰에 그친다. next-run-no는 편의 제안값 엔드포인트이며, 진짜 배타적 차수 번호 보장은 의도적으로 DB 제약에 위임된 설계처럼 보인다. medium → low로 하향 조정이 적절하다.

#### generateValueCode 초성 3자 절삭 — 서로 다른 한글 값이 동일 옵션코드 생성 가능

- **위치**: `src/lib/sh/option-code.ts:144` · **분류**: 버그 · **영역**: 상품·리스팅·생산
- **문제**: KO_EN_DICT 사전에 없는 한글 값은 초성을 로마자로 추출한 뒤 3자 절삭한다. ㅇ→O(line 74) 매핑으로 '아'와 '오'가 같은 초성 코드 'O'를 생성하며, 3자 내에서 초성이 동일한 서로 다른 단어가 같은 코드를 생성한다(예: '상아색'→SOH vs '소아과'→SOG, 단어에 따라 동일 prefix 발생). 같은 상품의 두 옵션이 동일 코드를 얻으면 `generateOptionSku`가 동일한 SKU를 만들어 낼 수 있다.
- **사용자 영향**: 자동 생성된 SKU가 중복되면 채널 alias 매칭에서 오매칭이 발생하여 잘못된 옵션에 재고·출고가 귀속될 수 있다. 재고 수치, 발주 계산, 판매량 집계 전반에 오염이 전파된다.
- **수정 방향**: 초성 코드 생성 후 같은 상품의 기존 옵션 코드와 충돌 검사를 수행하거나, 충돌 시 숫자 suffix(예: SOH2)를 자동으로 부여하는 disambiguation 로직을 추가한다.
- **검증 노트**: 초성 충돌로 동일 SKU가 생성될 수 있다는 알고리즘 관찰은 정확합니다(option-code.ts:71, 148). 그러나 주장된 피해 경로("채널 alias 매칭 오매칭 → 재고·발주·집계 오염")는 코드 근거가 없습니다. ChannelProductAlias는 aliasName(채널 원본 상품명 정규화값)으로 매칭하며 SKU를 키로 사용하지 않습니다(schema.prisma:1291 @@unique([channelId, aliasName])). product-matching.ts도 SKU 기반 조회 없음. 재고·발주는 optionId(CUID) 외래키로 연결됩니다. 실제 영향은 상품 옵션 에디터·발주 플랜 UI에서 중복 SKU 표시로 인한 사용자 혼란에 그칩니다. 사용자가 수동 오버라이드(skuManual=true)할 수 있고 DB도 unique 제약 없이 중복을 수용합니다.

### 배송 (sh-shipping)

#### 배치 완료 자동 라벨의 날짜·오전/오후가 UTC 기준으로 계산되어 한국 시간과 불일치

- **위치**: `app/api/sh/shipping/batches/[batchId]/route.ts:55` · **분류**: UX · **영역**: 배송
- **문제**: PATCH COMPLETED 시 자동 라벨 생성 로직(line 55-57): `now.getHours()`는 서버 로컬 타임(Vercel = UTC), `now.toISOString().split('T')[0]`도 UTC 날짜다. 한국(UTC+9)에서 자정~오전 9시 이전 완료 시, UTC는 전날이므로 라벨 날짜가 하루 이전으로, 오전/오후 표기도 UTC 기준이므로 한국 시간과 최대 9시간 차이가 난다.
- **사용자 영향**: 자동 생성된 라벨이 실제 완료일과 다른 날짜로 표시된다. 업무 일지·배송 이력 추적 시 혼동.
- **수정 방향**: 서버 환경변수 `TZ=Asia/Seoul`을 설정하거나, 라벨 날짜를 KST 오프셋 수동 계산(`new Date(Date.now() + 9 * 3600 * 1000).toISOString().split('T')[0]`)으로 구성한다.
- **검증 노트**: 주장된 low 심각도가 적절함. 영향 범위는 자동 생성 라벨의 표시 오류에 한정되며, 사용자가 수동으로 라벨을 입력하면 우회 가능. 재무·재고 데이터에는 영향 없음.

## 부록 A. 검증에서 기각된 발견 (24건, 오탐 판정)

- [inv-reorder] PARTIAL 대조 취소(cancel) 시 기 적용된 ADJUSTMENT 이동이 역산되지 않음
- [inv-coupang-sync] upload-worker: workspaceId를 요청 바디에서 그대로 신뢰 — 테넌트 소유권 미검증
- [inv-coupang-sync] analysis/worker 및 analysis POST(워커 경로): workspaceId 테넌트 소유권 미검증
- [sh-products] PATCH로 status=STOCKED_IN 직접 설정 시 재고 INBOUND 처리 완전 우회
- [sh-pricing] apiChToMatrixChannel: 채널 DB의 freeShippingThreshold를 무시하고 1로 하드코딩
- [sh-shipping] 파일 업로드 크기 가드 없음 — 대용량 파일로 서버 OOM
- [sh-shipping] aliasLookup에서 spaceId 없이 channelId만으로 조회 — 별칭 스페이스 격리 미완
- [sh-analytics-home] sales-by-option/route.ts의 UTC 기반 날짜가 loadOptionDemand로 전파되어 옵션 판매량 기간 경계 오류
- [finance-import] yearMonth()가 JS 로컬 시각 사용 — 비UTC 서버에서 월 경계 오분류
- [finance-views] 커밋 시 MANUAL 잔고 스냅샷을 DERIVED로 무조건 덮어씀
- [finance-views] Export CSV 날짜 파싱이 UTC를 사용, 거래 내역 필터는 로컬 시간 사용
- [finance-views] cashflow 뷰에서 같은 categoryId가 IN·OUT 방향 모두에 있을 때 levelOne 키가 타입 접두사로만 분리됨
- [ads-campaigns] cacheCoupangAdsData wraps unstable_cache on every call — potential cache miss or memory leak
- [ads-campaigns] product-trends cache key uses full ISO timestamp — cache is permanently cold
- [ads-campaigns] Worker API key authentication allows access to any workspace without owner verification
- [ads-ops] 실행 태스크 승인·롤백에 역할 검사 없음 - MEMBER도 광고 집행 승인 가능
- [sc-analytics] resolveSpaceContext가 findFirst에 orderBy 없이 호출 — 멀티스페이스 사용자의 잘못된 스페이스 서비스
- [sc-analytics] upsertDeploymentMetric update 블록에서 null 값이 undefined로 매핑되어 필드 초기화 불가
- [platform-auth] 워커 인증 시 x-workspace-id 부재/invalid → 임의 테넌트 워크스페이스 반환
- [platform-auth] POST /api/spaces/decks — 역할 검사 없이 MEMBER도 Deck 활성화 가능
- [platform-auth] Google OAuth 콜백에서 user가 null일 때 워크스페이스 검사 없이 next 경로로 리다이렉트
- [cross-date-money] 발주 정확도 수요 쿼리 경계 off-by-one: `lte` 사용으로 actualOutbound 1일 과다 포함
- [cross-date-money] finance/transactions 날짜 필터: `lte T23:59:59`으로 초 경계 내 거래가 목록에서 누락되고 월 집계에는 포함됨
- [cross-date-money] finance/imports/commit-staging `toDate()`: 날짜-only 문자열은 UTC 자정, datetime 문자열은 로컬 시간으로 파싱 불일치

---

## 부록 B. 처리 현황 (2026-07-12 종결)

**89/97 처리 (92%) = 82건 운영 배포 + 7건 무수정 종결(근거 실증).** main 릴리스 18건(#356·361·366·369·371·373·375·377·380·382·387·393·402·405·414·421 등), 신규 테스트 ~28파일(동시성 e2e 다수).

### 배포 완료 (82건)
- **High 10/10** — 2026-07-07 완료 (#356·#361)
- **Medium 33/46** — 배치1~16·21 (KST 날짜, 삭제 가드, 원자화, cross-space authz, 상태 기계, source dedup, staging/commit 성능 등)
- **Low 32/41** — 배치10~13·17~20·22 (입력 가드, 원자적 claim, Zod 검증, UX 경고 표면화 등)
- prod env 신규 설정 2건: `WORKER_DEFAULT_WORKSPACE_ID`(워커 라우팅 핀), `CLICK_EVENT_SALT`(IP 해시 salt)

### 무수정 종결 (7건, 근거 실증)
| 항목 | 근거 |
|---|---|
| reconciliation 동시 confirm 중복 행 | batch8 preAppliedKeys가 순차 재confirm 해결, 잔여 sub-second 창은 delta=0 행 노이즈뿐(ADJUSTMENT 집계 소비처 0곳 실증, 재고값은 FOR UPDATE 멱등) |
| salesQty30d 의미 충돌 | GET /api/inventory fileType 필터(배치6)로 잔여 UI 혼용 해소, 분석 엔진은 원래 필터링 |
| next-run-no TOCTOU | DB 유니크 제약이 무결성 보장, 편의 제안값 엔드포인트(검증노트 그대로) |
| 현금흐름 기본 기간 UTC | periods 파라미터 개편으로 클라이언트가 항상 명시 전송 — 서버 기본값 도달 불가 |
| 발주 계획 번호 UTC | 배치1(#362)에서 이미 getTodayStrKst로 수정 |
| classified 카운트 DUP_SAME | #413(활성 큐 제외)이 정확히 수정 |
| 가져오기 더블클릭 중복 | #408 행 단위 dedup으로 완화 + canImport의 !importing 게이트 기존재 |

### High 후속 과제 종결 (2건)
- **#5 InvMovement.referenceId 유니크**: **설계상 불가** — 재고대조·세트이관이 referenceId를 여러 행에 공유(코드 주석 명시). `pg_advisory_xact_lock(hashtext(referenceId))`(#360)가 올바른 직렬화이며 마이그레이션 불필요.
- **#3 AdRecord NULLS NOT DISTINCT**: #343 delete→insert 원자화로 덮어쓰기 경로가 기간 행 전체 교체 — 중복 누적 경로 소멸. 인덱스 변경은 prod 기존 중복 정리 선행이 필요한 마이그레이션 리스크 대비 방어 가치 낮음 → 보류(향후 스키마 대작업 시 동반 검토).

### 잔여 (미착수 5건, 사유 명시)
| 항목 | 사유 |
|---|---|
| sc worker COOKIE 하드코딩 | 미구현 기능(Threads API) 잠복 결함 — 실통합 시 수정 |
| Content transition spaceId WHERE | 검증노트 "수정 불필요" (이론적 방어 패턴) |
| generateValueCode 초성 충돌 | 코드 포맷 변경 리스크 — 검증노트가 피해 경로 반박(SKU는 매칭 키 아님), 회피 결정 |
| defaultAdCostPct 단위 통일 | DB 저장값 의미 변경 리스크 — 경고 주석으로 대체(#412) |
| resolveWorkspace 워커 폴백 구조 | env 핀(#402)으로 완화 — 헤더 필수화는 워커 배포 동반 필요 시 |
