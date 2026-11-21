# 주문 수집 → 위킵 배송 요청 → 운송장 채널 등록 자동화 계획

- 작성: 2026-11-15, grill-me 확정안
- 대상 Space: hello@ameaning.co.kr (운영 app.workdeck.work)
- 워크트리: `/Users/kaleos/projects/workdeck-app-order-pipeline` (브랜치 `feat/order-fulfillment-pipeline`, origin/main 기준)

## 1. 목표

지금 위킵에 **엑셀로 수동 등록하는 판매채널 9개**의 주문을 한 파이프라인으로 처리하되, **주문 누락·배송 누락·운송장 등록 누락 0**을 보장한다. (N배송은 위킵 스마트스토어 연동이 수집·송장 전송까지 하므로 제외 — 실사 결과)

1. 주문 데이터 수집 (API 채널: 자동 수집 / 반자동 채널: 사람이 채널 주문 엑셀을 워크덱에 업로드)
2. 배송 등록 (워크덱 → 위킵 「에이엠엘\_엑셀」 판매처로 엑셀 대량 업로드, 위킵 목록 재조회로 확인) — 전 채널 자동
3. 채널별 운송장 등록 (위킵 엑셀저장에서 송장 회수 → API 채널: 발송처리 API / 반자동 채널: 채널별 송장 업로드 파일 생성 + 사람 등록 확인)

각 단계는 **완료되거나 사용자 승인**이 있어야 다음 단계로 간다. 단계마다 상태·작업 주체·시각·검증 결과를 기록하고 Slack 으로 보낸다. 실패하면 사람이 처리할 수 있어야 한다.

## 2. 확정 결정 (grill-me 2026-11-15)

| #   | 항목             | 결정                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 채널 범위        | **(실사 후 변경)** 위킵 엑셀 판매처로 들어가는 9개: 스마트스토어 판매자배송·쿠팡 판매자배송·카페24 자사몰 = **API 자동**, 기타 오픈마켓·현대카드·아난티·와디즈스토어·무신사·오늘의집 = **반자동**(수집·송장 등록은 사람, 위킵 등록·추적·대사는 자동). N배송(위킵 연동)·로켓그로스 제외. 이후 주문 많은 반자동 채널부터 API/브라우저 자동화로 승격                                                                                                                                                                                                            |
| Q2  | 발주확인         | 수집·검증 → 승인 → 채널 발주확인(네이버 발주확인 / 쿠팡 상품준비중 처리 / 카페24 배송준비중) → 성공 건만 2단계. 반자동 채널은 사람이 채널에서 처리했다고 보고 업로드 시점에 CONFIRMED                                                                                                                                                                                                                                                                                                                                                                        |
| Q3  | 단계 게이트      | **채널 × 단계 자동 진행 스위치 3개**(수집→위킵 요청 / 위킵 요청 / 운송장 등록), 기본 꺼짐(승인 필수). 검증 실패·이상 건은 스위치와 무관하게 항상 승인 대기                                                                                                                                                                                                                                                                                                                                                                                                   |
| Q4  | 위킵 등록        | 맥미니 워커(Playwright) + LOGIN 비밀값(`wekeep-aml`·`wekeep-kreamd`) 로그인 → 기존 배송 파일 생성기 엑셀 대량 업로드 → 위킵 목록 재조회 대조. ego 실행기는 조회 전용이라 사용 안 함                                                                                                                                                                                                                                                                                                                                                                          |
| Q5  | 운송장 회수      | 위킵 업로드 엑셀 주문번호 칸 = 워크덱 추적키(네이버 상품주문번호 기반). 워커가 위킵 송장 엑셀을 15·18·21시 다운로드 → 추적키 매칭 → 네이버 발송처리 API. SLA(다음 영업일 12시) 넘은 미발급 건 Slack                                                                                                                                                                                                                                                                                                                                                          |
| Q6  | 기존 엑셀 경로   | 유지. 상품주문번호 원장 unique 로 중복 차단. 자동 수집 채널의 엑셀 업로드는 **상품주문번호 열 매핑 필수**, 번호 없는 행은 차단, 원장에 있는 주문은 건너뜀(Codex 지적 반영)                                                                                                                                                                                                                                                                                                                                                                                   |
| Q7  | 취소·배송지 변경 | 각 단계 직전 네이버 상태 재조회. 위킵 요청 전 → 그 주문만 보류+승인 대기. 위킵 요청 후 취소요청 → Slack 긴급, 위킵 취소·네이버 취소 승인은 사람. 송장 등록 전 취소완료 → 송장 등록 건너뛰고 불일치 표시. 위킵 취소 자동화 1차 제외                                                                                                                                                                                                                                                                                                                           |
| Q8  | 출고 라우팅      | 스토어별 위킵 고정(에이엠엘 → 「3PL 에이엠엘」/ameaning23, 크림드 → 위킵 크림드/ameaning22). 매칭 실패·위킵 재고 부족 주문은 그 주문만 보류                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q9  | 대사·알림        | 단계별 '쓰고 다시 읽기' + 매일 09·18시 4자 대사(네이버 결제 ↔ 워크덱 ↔ 위킵 ↔ 네이버 발송상태, 최근 7일). 워커 정지·로그인 실패·IP 차단 즉시 긴급. 기존 seller-hub Slack 채널                                                                                                                                                                                                                                                                                                                                                                                |
| Q10 | 실행 시각        | 수집 30분마다. **위킵 비연동(엑셀) 당일출고 마감 14:00(사용자 확인)** → 업로드 회차 10:00·13:30(설정 변경 가능). 주말 출고 여부는 Phase 0 추가 확인. 회차 1회 = DelBatch 1개. 마감 넘긴 미승인 건은 다음 회차 + Slack                                                                                                                                                                                                                                                                                                                                        |
| Q11 | 판매·재고        | 판매 = 1단계 수집 시점(결제일). 재고 차감 = 2단계 위킵 등록 확인 시 묶음 완료 → 기존 OUTBOUND 차감 로직 그대로                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Q12 | 수동 처리        | seller-hub 「주문 처리 현황」 화면 신설. 주문별 단계 타임라인. 액션 = 재시도 / 수동 완료(증거 필수, 다음 대사에서 재확인) / 보류 해제·제외(사유 필수). Slack 딥링크. 권한 = Space ADMIN 이상                                                                                                                                                                                                                                                                                                                                                                 |
| Q14 | 위킵 판매처      | 업로드는 항상 「에이엠엘\_엑셀」 판매처로. 연동 판매처(N배송)에는 절대 넣지 않음 — 사람이 연동 판매처에 직접 넣은 주문이 송장 전송 실패를 일으키는 기존 문제(사용자 증언)를 반복하지 않기 위해                                                                                                                                                                                                                                                                                                                                                               |
| Q15 | 수동 등록 병행   | **병행 금지 + 채널별 전환 시각(cutover)**. cutover 이전 결제 주문 = 사람(기존 방식), 이후 = 파이프라인만. 위킵에서 사람 등록을 기술적으로 막을 수 없으므로 운영 규칙 + 감시로 처리: cutover 공지, 파이프라인 업로드의 위킵 **판매처주문번호 = 추적키**(`WD-<채널코드>-<원장 id>` 형식, 사람이 쓰는 원본 번호와 절대 겹치지 않음) → 위킵 목록에서 추적키가 아닌 원본 번호로 같은 주문(채널 원본번호+상품+수량 일치)이 발견되면 **사람 등록 발견 = 즉시 `HELD` + Slack 긴급**(SENT_TO_3PL 로 확정하지 않음). 이미 양쪽 다 등록됐으면 사람이 위킵에서 하나 취소 |
| Q13 | 도입 순서        | Phase 0 실사 → 그림자 운영 1주(쓰기 없음) → **에이엠엘 스마트스토어** 실제 쓰기(전부 승인, 크림드는 판매자배송 0건) → 쿠팡 → 카페24 → 반자동 6채널(엑셀 업로드 경로) → 사용자가 스위치 켬                                                                                                                                                                                                                                                                                                                                                                    |

## 3. 기존 자산 (재사용)

- 네이버 커머스API 워커 호출 경로: N배송 수집(`/api/collection/naver-nbaesong/{plan,ingest,finish}`), 스토어별 키 SpaceCredential `naver-commerce`, plan 라우트가 키 복호화해 워커에 전달, 워커 IP 112.152.74.59 등록됨, 1.5초 간격(429)
- 상품 매칭: `ChannelProductAlias`(바코드 `bc:<barcode>` 우선 + 상품명 폴백) — N배송과 같은 규칙
- 배송: `DelBatch`/`DelOrder`/`DelOrderItem`, PII 암호화(`src/lib/del/encryption.ts`), 배송 파일 생성기(`src/lib/del/delivery-file-generator.ts`), 배송 방식 위치 차감(`DelShippingMethod.locationId`)
- 승인: 에이전트 승인 큐 + Slack 승인 버튼(`app/api/slack/interactive/route.ts`, Space·채널 경계 검증)
- 위킵 로그인: SpaceSecret kind=LOGIN (`wekeep-aml`, `wekeep-kreamd`) — **워커 조회 라우트 미구현**(이번에 구현)
- 워커: `worker/src/` 스케줄러·heartbeat·slack-notifier·login-guard

## 4. 데이터 모델 변경 (마이그레이션 1개)

- `DelBatchSource` 에 `CHANNEL_PIPELINE` 추가(이하 문서의 `NAVER_PIPELINE` 은 이 값으로 읽는다 — 전 채널 공용). **N배송의 `NAVER_API`(1일=1묶음 재구축)와 섞지 않는다** — N배송 재구축이 이 묶음을 지우면 안 됨.
- 신규 `ExternalOrderLedger` (**중복 차단 원장, 주문 삭제와 독립**): `externalKey @unique`(`<channelId>:<채널 주문 행 고유번호>` — 네이버 상품주문번호, 쿠팡 shipmentBoxId+vendorItemId, 카페24 order_item_code, 반자동 채널은 엑셀 주문번호+상품 행. 반자동 채널 엑셀에 행 고유번호가 없으면 업로드 시 차단), `spaceId, channelId, naverOrderId, delOrderId?`(onDelete SetNull — 묶음이 지워져도 원장은 남음), `source(PIPELINE|EXCEL)`, `confirmedAt, sentTo3plAt, trackingNumber, dispatchedAt`. 수집·엑셀 임포트 모두 여기서 먼저 `INSERT … ON CONFLICT DO NOTHING` → 실패하면 건너뜀. 4자 대사의 워크덱 쪽 기준도 이 원장.
- `DelOrderItem.externalKey String?` — 원장 키 사본(조회용, unique 아님).
- `DelOrder` 추가 필드:
  - `pipelineStage` enum `COLLECTED | CONFIRMED | SENT_TO_3PL | TRACKING_ISSUED | DISPATCHED | DONE`
  - `pipelineStatus` enum `PENDING | AWAITING_APPROVAL | IN_PROGRESS | HELD | FAILED | MANUAL_DONE | EXCLUDED`
  - `holdReason String?`, `carrierCode String?`, `trackingNumber String?`, `threePlRef String?`(위킵 주문번호 칸 값 = 추적키)
  - 인덱스 `[spaceId, pipelineStage, pipelineStatus]`
- 신규 `DelOrderEvent` (append-only 감사 로그): `orderId, spaceId, stage, fromStatus, toStatus, actorType(WORKER|USER|AGENT|SYSTEM), actorId, at, validation Json, error String?, batchId?`
- 신규 `ChannelFulfillmentSetting` (채널 1:1): `channelId @unique, mode(API|SEMI), adapter(naver|coupang|cafe24|null), enabled, shadowMode, autoCollectToSend, autoSendTo3pl, autoDispatch, uploadSlots String[] ("10:00","13:30"), trackingSlaHours, shippingMethodId, storeKey, importPresetId?(반자동 채널 엑셀 매핑), trackingExportFormat Json?(반자동 채널 송장 업로드 파일 양식)`
- 신규 `PipelineOperation` (외부 쓰기 1회 = 1행, 회차·대사 기록 겸용): `id(opId)`, `kind(COLLECT|CONFIRM|UPLOAD_3PL|FETCH_TRACKING|DISPATCH|RECONCILE)`, `channelId, orderIds String[], workerId, leaseUntil, status(STARTED|SUCCEEDED|PARTIAL|FAILED|UNKNOWN), counts Json, error, startedAt, finishedAt`
- `DelOrder.pipelineVersion Int @default(0)` — 상태 전이 CAS 용.

`pipelineStage`/`pipelineStatus` 는 NAVER_PIPELINE 주문만 채운다(기존 수동 주문은 null → 기존 화면 영향 0).

### 기존 코드 보호 (Codex 지적 반영)

- `src/lib/naver-commerce/nbaesong-sync.ts:58` 의 "엑셀 적재 주문 제외"는 `orderNumber`(네이버 orderId) 단위라, 판매자배송 상품이 엑셀·파이프라인 어느 쪽으로 먼저 들어와도 **같은 orderId 의 N배송 상품주문이 통째로 빠진다**(혼합 주문). → **N배송 제외 판정을 상품주문번호(원장 `externalKey`) 단위로 변경**: 원장에 같은 상품주문번호가 있을 때만 제외. 엑셀은 상품주문번호를 원장에 기록하므로 판매자배송 상품만 겹치고 N배송 상품은 겹치지 않음. 통합 테스트: 엑셀 선행 혼합 / 파이프라인 선행 혼합 / N배송 선행 혼합.
- **역방향도 같이 변경**: `app/api/sh/shipping/import/route.ts:125-162` 는 기존 NAVER_API 주문의 `orderNumber` 를 모아 같은 주문번호 엑셀 그룹 전체를 건너뛴다 → N배송 선행 혼합 주문의 판매자배송 행까지 누락. → import 의 중복 판정도 원장 상품주문번호 단위로 변경. N배송 sync 가 재구축 시 자기 상품주문번호를 원장에 `source=NBAESONG` 으로 기록(Phase 0.5 에서 기존 N배송분 backfill — N배송은 API 재조회로 상품주문번호를 정확히 얻을 수 있음). 엑셀 행에 상품주문번호가 없으면(자동 채널은 필수라 수동 채널만 해당) 기존 orderNumber 판정 유지 + 혼합 의심으로 보류 표시. 테스트: N배송 선행 후 판매자배송 엑셀 import.
- 기존 배송 API 의 `NAVER_API` 보호를 공용 함수 `isLockedBatchSource(source)`(NAVER_API·NAVER_PIPELINE)로 바꿔 **전 경로**에 적용: `batches/[batchId]`(:48·:172), `orders/[orderId]`(수정·삭제), `orders/[orderId]/clone`, `orders/[orderId]/items`(추가), `items/[itemId]`(수정·삭제), `items/[itemId]/match`, `import`. 예외: 파이프라인 주문의 상품 매칭은 「주문 처리 현황」 전용 API 로만(version CAS + 이벤트 기록). 각 경로 회귀 테스트(`__tests__/nbaesong-guards.test.ts` 확장).
- 원장 등록과 DelOrder·DelOrderItem 생성은 **같은 트랜잭션**. 원장 충돌 시 무조건 건너뛰지 않고 판정: 연결 주문 있음 → 상태 갱신만 / 연결 주문 없음(삭제·고아) → `ORPHAN` 으로 보류 + Slack, 사람이 복구(재생성 or 종결) 선택. 대사에서도 고아 원장을 별도 불일치로 보고.
- 같은 파일 :76 채널 재고 차감·:135 `applyBatchOutboundForBatch` 는 `source === 'MANUAL'` 안에서만 실행됨 → 파이프라인 완료는 **전용 완료 함수**에서 채널 재고 차감 + 위치 OUTBOUND 를 상태 변경과 같은 트랜잭션으로 수행(기존 함수 재사용, 조건만 분리).
- `DelOrderEvent` 는 orderId onDelete SetNull + spaceId 보존(감사 로그 소실 금지).

## 5. 단계별 흐름

### 채널 어댑터

- API 어댑터 3개(naver·coupang·cafe24)가 같은 인터페이스: `listNewOrders`, `getStatuses(ids)`, `confirm(ids)`, `dispatch(items)`. 쿠팡·네이버는 IP 허용 목록 때문에 워커에서만 호출. 카페24는 OAuth 토큰 갱신 필요(Phase 0 확인).
- 반자동 채널: 기존 엑셀 임포트(`import/route.ts`) + 채널별 매핑 프리셋으로 업로드 → 원장 기록 → `CONFIRMED` 로 바로 진입(1단계 발주확인은 사람이 채널에서 이미 한 것으로 간주). 3단계는 채널별 송장 업로드 파일 생성 → 사람이 채널에 올림 → 상태 `TRACKING_FILED`(검증 대기). **`DISPATCHED` 는 채널 쪽 증거로만**: 사람이 채널의 발송/배송 상태 export(또는 업로드 결과 파일)를 워크덱에 올리면 행 단위로 대조해 송장이 실린 행만 `DISPATCHED`. 파일명·시각 체크만으로는 종결하지 않음. 검증 대기는 SLA 계속 감시(종결 전까지 대사 포함).
- **반자동 채널 원장 키**: 채널 엑셀의 **불변 행 고유 ID 열**(예: 상품주문번호·주문상세번호)을 채널별 매핑 프리셋에 지정. 기존 parser 는 주문번호·상품명·수량·파일 행 번호만 보존하므로 행 ID 열 매핑을 추가. Phase 0 실사에서 같은 기간 엑셀을 두 번 내려받아 행 순서·범위가 바뀌어도 ID 가 같은지 검증. **행 ID 가 없거나 검증 실패한 채널은 파이프라인 대상 제외**(사람 운영 유지, 대사만).

### 1단계 수집 (API 채널, 30분마다, 워커)

1. 워커가 `plan` 받음(채널 설정 + 스토어 키) → 커머스API 변경 주문 조회(`PAYED`, 마지막 커서 − 1시간 겹침 조회) → `ARRIVAL_GUARANTEE` 제외.
2. `ingest`: externalKey upsert(이미 있으면 상태만 갱신). 검증 = 상품 매칭·수량>0·주소/연락처 존재·우편번호·결제금액. 실패 → `HELD`.
3. 통과 건 → `AWAITING_APPROVAL`(스위치 꺼짐) 또는 자동 진행. 승인/자동 → 워커가 발주확인 API → **네이버 재조회로 `PLACE_ORDER` 확인** → `CONFIRMED`. 실패 건 `FAILED`.
4. Slack: 회차 요약(신규 N, 보류 N, 승인 대기 링크).

### 2단계 위킵 요청 (10:00·13:30 회차, 전 채널)

1. 직전 네이버 재조회(취소요청·배송지변경 → `HELD`).
2. `CONFIRMED` 중 진행 가능 건을 `DelBatch(source=NAVER_PIPELINE)` 1개로 묶음 → 승인 대기 또는 자동.
3. 워커: 위킵 로그인(LOGIN 비밀값) → 업로드 **전에 위킵 목록에서 (a) 같은 추적키 존재(재시도 중복) (b) 원본 주문번호로 사람 등록 흔적(Q15) 확인** — (a) 있으면 업로드 안 하고 그 위킵 주문을 연결, (b) 있으면 `HELD` → 「에이엠엘\_엑셀」 판매처로, 판매처주문번호 칸 = 추적키(배송 파일 생성기에 파이프라인 전용 컬럼 매핑 추가 — 기존 생성기는 원본 orderNumber 를 출력) → 엑셀 업로드 → 위킵 목록 재조회로 추적키 전건 대조.
4. 전건 확인 → 주문 `SENT_TO_3PL`, 묶음 COMPLETED(전용 완료 함수로 재고 차감). 일부만 확인 → **미확인 주문을 같은 트랜잭션에서 새 DRAFT 묶음으로 이동한 뒤** 원래 묶음(확인 건만)을 완료 — `applyBatchOutboundForBatch` 의 묶음 단위 멱등(delBatchId movement 존재 시 skip)과 충돌 없음. 미확인 건은 `UNKNOWN` + Slack 긴급, 자동 재업로드 금지(사람이 위킵 확인 후 재시도/수동 완료).
5. 위킵 요청 후 취소요청 감지 → Slack 긴급(위킵 취소는 사람).

### 3단계 운송장 등록 (15·18·21시)

1. 워커가 위킵 주문 목록 「엑셀저장」(`orderExcelDownload()`) 다운로드 → 판매처주문번호 = 추적키로 매칭(사람 등록 주문은 추적키가 없으므로 자동 매칭 대상 아님 — HELD 상태에서 사람이 위킵 주문을 수동 연결) → 추적키 매칭 → `TRACKING_ISSUED`(택배사 코드 매핑표 사용).
2. 직전 네이버 재조회: 취소완료 → 송장 등록 건너뛰고 불일치 표시.
3. API 채널: 승인/자동 → 채널 발송처리 API → 재조회로 배송중 확인 → `DISPATCHED`. 반자동 채널: 채널별 송장 파일 생성 + Slack(파일 링크) → 사람 「등록 완료」 → `DISPATCHED`.
4. SLA 초과 미발급 건 Slack.

### 미종결 주문 감시 (30분마다, 수집과 같은 실행)

`DONE`·`EXCLUDED` 가 아닌 모든 파이프라인 주문을 **결제일과 무관하게** 네이버 상태 재조회(상품주문번호 일괄 조회 API). 위킵 요청 후 송장 전 단계에서 취소요청이 뜨면 바로 Slack 긴급(위킵 출고 전에 사람이 막도록). 배송지 변경도 같은 방식.

### 대사 (09·18시)

네이버 최근 7일 결제 주문 **+ 기간과 무관한 미종결 주문 전부** ↔ 워크덱(원장+DelOrder) ↔ 위킵 목록 ↔ 네이버 발송상태 4자 비교. 미종결 주문은 종결·명시적 해결 전까지 대사·SLA 대상에서 빠지지 않는다. 결과: 단계별 머문 주문, 네이버엔 있고 워크덱엔 없는 주문(수집 누락), 위킵에 없는 SENT_TO_3PL(배송 누락), 송장 있는데 미발송처리(운송장 누락). `MANUAL_DONE` 건도 여기서 재확인 → 불일치면 다시 `FAILED`.

## 6. 동시성·멱등성

- 모든 상태 전이는 `UPDATE … WHERE pipelineStage=? AND pipelineStatus=? AND pipelineVersion=?` CAS(+version 증가) + `DelOrderEvent` 같은 트랜잭션 기록. 승인 버튼도 승인 당시 version 을 실어 보내 오래된 승인은 거부.
- 외부 쓰기 전 `PipelineOperation(STARTED, workerId, leaseUntil)` 생성 + 주문 `IN_PROGRESS`. 주문에 끝나지 않은 operation 이 있으면 다른 실행은 그 주문을 건드리지 않음.
- lease 만료된 STARTED operation 은 **자동 재시도하지 않는다** → `UNKNOWN` 으로 바꾸고 외부 재조회 결과를 붙여 사람 확인(위킵 측 중복 방지 장치가 없으므로 느린 워커와의 경합으로 이중 업로드될 수 있음).
- 워커 프로세스 1개 + 스토어 단위 직렬화(N배송 수집과 같은 키 공유).
- 위킵 업로드·네이버 발주확인·발송처리는 모두 "쓰기 전 존재 확인 → 쓰기 → 재조회 확인" 3단.
- 워커 프로파일 락은 기존 idle-timeout 패턴(장시간 op `renew()`).

## 7. 화면·알림·MCP

- seller-hub 「주문 처리 현황」: 필터(단계·상태·채널·기간), 주문 타임라인(DelOrderEvent), 액션(승인·재시도·수동 완료[송장번호 등 증거 필수]·보류 해제·제외[사유 필수]). ADMIN 이상.
- 채널 설정: 자동 수집 사용, 그림자 모드, 단계 스위치 3개, 업로드 회차, SLA.
- Slack: 기존 seller-hub 채널. 승인 버튼은 기존 interactive 라우트에 action_id 추가. Space·채널 경계 검증 + **Slack 사용자→Space 구성원 연결 + 서버 측 ADMIN 이상 검사**를 새 처리기에서도 명시적으로 수행(기존은 `approveAndExecute` 내부에 위임돼 있어 경계 검사만 복사하면 권한 우회). 테스트: 비구성원·MEMBER·다른 Space·중복 클릭.
- MCP(선택, 1차 제외 가능): `sellerhub_get_fulfillment_status` 조회 전용.

## 8. 단계(Phase)와 검증

| Phase                       | 내용                                                                                                                                                                                                                                                                                                                                   | 완료 기준                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0 실사(추가)                | 쿠팡 판매자배송 주문 조회·상품준비중·송장 업로드 API 실조회(키 있음), 카페24 앱 등록·주문/배송 API 권한, 반자동 6채널의 주문 엑셀 양식·송장 업로드 양식 샘플(사용자 제공), 위킵 엑셀 등록 양식·주말 출고                                                                                                                               | 리포트. **게이트**                                                                                  |
| 0 실사                      | ① 네이버 앱 발주확인·발송처리 쓰기 권한/엔드포인트 확인(실주문 1건은 사용자 입회) ② 위킵 대량 주문 업로드 양식·주문번호 칸 보존·업로드 결과 화면 ③ 위킵 송장 엑셀 위치·컬럼 ④ 위킵 택배사 → 네이버 택배사 코드 ⑤ 위킵 목록 조회 방법(엑셀 or XHR) ⑥ 위킵 당일출고 마감 실제 시각                                                       | 리포트 + 실패 시 계획 재조정. **게이트**                                                            |
| 0.5 원장 이관(**채널마다**) | 채널별 cutover 시각 지정. cutover 이전 **미종결** 주문 전체(기간 무관)와 최근 30일 주문을 채널 원본(API 또는 채널 엑셀)·기존 DelOrder·위킵 목록 3자 대조 → 불변 행 키로 원장 backfill(`source=EXCEL`, 발송 확인되면 `dispatchedAt`). 불명확 건 `AMBIGUOUS` = 자동 처리 제외·사람 확인. **채널별 리포트 승인 후에만 그 채널 `enabled`** | 채널별 backfill 리포트 승인. **게이트**                                                             |
| 1 모델·수집                 | 마이그레이션, 수집 plan/ingest, 검증·보류, 이벤트 로그, 엑셀 임포트 중복 차단                                                                                                                                                                                                                                                          | 단위 테스트(전이·멱등·중복), dev DB 통합                                                            |
| 2 그림자 1주                | 수집·대사만 운영(쓰기 없음), 사람 작업 결과와 매일 비교                                                                                                                                                                                                                                                                                | 7일 연속 수집 누락 0                                                                                |
| 3 화면·승인                 | 현황 화면, 채널 설정, Slack 승인 버튼, 발주확인                                                                                                                                                                                                                                                                                        | 브라우저 QA                                                                                         |
| 4 위킵 업로드               | 워커 위킵 로그인·업로드·재조회 대조, 묶음 완료·재고 차감                                                                                                                                                                                                                                                                               | 에이엠엘 스마트스토어 실주문 승인 운영                                                              |
| 5 운송장                    | 송장 다운로드·매칭·발송처리·SLA                                                                                                                                                                                                                                                                                                        | 에이엠엘 스마트스토어 실주문 운영                                                                   |
| 6 쿠팡·카페24               | API 어댑터 추가, 채널별 그림자 3일 → 실운영                                                                                                                                                                                                                                                                                            | 채널별 대사 불일치 0                                                                                |
| 7 반자동 6채널              | 채널별 엑셀 매핑 프리셋(불변 행 ID 포함)·송장 파일 양식·채널 발송상태 export 대조, cutover 공지                                                                                                                                                                                                                                        | 채널별 1주: 불일치 0 **그리고** 송장 전건 채널 증거로 `DISPATCHED`(검증 수단 없는 채널은 통과 불가) |
| 8 확대                      | 크림드(판매자배송 발생 시), 반자동 채널 중 주문 많은 곳 API/브라우저 승격 검토                                                                                                                                                                                                                                                         | —                                                                                                   |

각 Phase: `npm run lint`, `npm run build`, 관련 jest, develop → main 단계 릴리스(기존 정책).

## 9. 롤백

- 채널 설정 `enabled=false` 로 즉시 중단(워커는 plan 에서 비활성 채널 건너뜀). 신규 주문은 기존 엑셀 경로로 복귀.
- **이미 수집된 미출고 주문은 엑셀로 다시 올리면 원장 때문에 건너뛰어진다** → 엑셀 재업로드가 아니라 「주문 처리 현황」의 **수동 인계** 액션으로 처리:
  - `SENT_TO_3PL` 전이고 진행 중 operation 없는 주문 → 파이프라인 주문 그대로 기존 배송 파일 생성기로 위킵 파일 내려받기 → 사람이 업로드 → 「위킵 등록 완료」 확인 시 `MANUAL_DONE` + 전용 완료 함수로 재고 차감. 원장·DelOrder 재사용이라 중복 생성 없음.
  - `UNKNOWN`/`IN_PROGRESS` 주문 → 사람이 위킵 목록에서 존재 확인 후 「이미 등록됨」 또는 「인계」 선택(확인 없이 인계 금지).
  - `SENT_TO_3PL` 이후 주문 → 송장 단계만 사람이 처리(송장번호 입력 → 네이버 발송처리는 사람이 직접 또는 버튼).
  - 테스트: 수집 직후 롤백 / 업로드 결과 불명확 상태 롤백.
- 마이그레이션은 추가 컬럼·테이블만(파괴적 변경 없음).
- 외부에 이미 반영된 쓰기(발주확인·위킵 업로드·발송처리)는 되돌리지 않는다 — 이벤트 로그로 상태를 확인해 사람이 처리.

## 10. 위험

- 위킵 화면 변경 → 업로드·조회 셀렉터 깨짐: 재조회 대조 실패가 곧바로 FAILED+긴급 알림이 되도록 설계(조용한 실패 금지).
- 워커 공인 IP 변경 → 네이버 전부 차단: 즉시 긴급 알림(기존 IP 거부 구분 로직 재사용).
- N배송 수집과 같은 API 사용 → 1.5초 간격 공유. 두 작업이 같은 스토어 키를 동시에 쓰지 않도록 워커에서 스토어 단위 직렬화.
- 위킵 업로드 부분 성공 → 재업로드하면 중복 출고. 업로드 전 존재 확인 + 부분 성공 시 자동 재시도 금지.

## 11. Codex 리뷰

`codex:review`(working-tree): 지적 0(문서만이라 실질 검토 없음) → `adversarial-review` 실행: 지적 7건 — 반영 7, 보류 0.

1. [critical] N배송 orderId 단위 제외로 혼합 주문 N배송 누락 → 제외 조건에 NAVER_PIPELINE 추가 + 통합 테스트
2. [high] MANUAL 전용 재고 차감 → 전용 완료 함수
3. [high] 부분 성공과 묶음 단위 멱등 충돌 → 미확인 주문 새 묶음으로 분리 후 완료
4. [high] 묶음 삭제 cascade 로 중복 키 소실 → 독립 원장 `ExternalOrderLedger` + 기존 API 보호
5. [high] 번호 없는 엑셀이 중복 차단 우회 → 자동 채널은 상품주문번호 필수
6. [high] 상태만 CAS → stage+status+version CAS, operation lease, 만료 시 UNKNOWN(자동 재시도 금지)
7. [high] Slack 승인 ADMIN 검사 누락 위험 → 명시 검사 + 테스트

2차 `adversarial-review`(수정본): 지적 5건 — 반영 5, 보류 0.

1. [critical] 기존 엑셀 주문 원장 미이관 → 도입 직후 재수집·재출고 → Phase 0.5 원장 backfill 게이트
2. [high] 개별 주문·상품·복제·매칭 API 가 NAVER_API 만 차단 → `isLockedBatchSource` 로 7개 경로 전부 보호
3. [high] 엑셀 선행 혼합 주문도 N배송 누락 → N배송 제외를 상품주문번호 단위로
4. [high] 원장 충돌 무조건 skip → 고아 원장 복구 불가 → 같은 트랜잭션 + ORPHAN 보류·대사 보고
5. [high] 위킵 요청 후 취소 감지 공백·7일 대사 사각지대 → 미종결 주문 30분 재조회 + 대사에 미종결 전부 포함

3차 `adversarial-review`(critical/high 만 요청): 지적 2건 — 반영 2, 보류 0.

1. [critical] import 역방향 orderNumber 제외로 N배송 선행 혼합 주문의 판매자배송 행 누락 → import 판정도 상품주문번호 단위 + N배송 원장 기록·backfill
2. [high] 롤백 후 엑셀 복귀 시 미출고 수집 주문이 원장 때문에 누락 → 「수동 인계」 액션(파이프라인 주문 그대로 파일 생성·사람 업로드)

4차 `adversarial-review`(범위 9채널 확장본, critical/high): 지적 5건 — 반영 5, 보류 0.

1. [critical] 반자동 원장 키 불안정(파일 행 번호 의존) → 채널별 불변 행 ID 열 매핑 + 재다운로드 검증, 없으면 채널 제외
2. [critical] 조회~업로드 사이 사람 직접 등록 경쟁 → 병행 금지·채널별 cutover, 위킵 판매처주문번호=추적키, 사람 등록 흔적은 HELD+긴급
3. [high] 판매처주문번호 존재만으로 외부 등록 확정 → 확정하지 않고 HELD, 추적키로만 자동 매칭
4. [high] 반자동 송장 체크가 실패를 종결 → `TRACKING_FILED`(검증 대기), 채널 발송상태 export 행 대조로만 `DISPATCHED`
5. [high] 확장 채널 원장 이관 누락 → Phase 0.5 채널별 backfill 게이트

## 12. Phase 0 실사 결과 (2026-11-15)

**네이버 커머스API 읽기 전용 조회(최근 7일, 사용자 1회 허용)**

- 에이엠엘: 상품주문 36 중 판매자배송(NORMAL) 16(하루 2~7건), N배송 20. 판매자배송 택배사 전부 `CJGLS`(CJ대한통운)/`DELIVERY`. 취소 1건(`CANCELED/NOT_YET`).
- 크림드: 4건 전부 N배송, **판매자배송 0건** → 도입 순서 수정 필요(아래).
- 혼합 주문(N배송+판매자배송 같은 orderId) 7일간 0건 — 규칙은 유지(발생 가능).
- 응답 필드 실측: `productOrder.placeOrderStatus`(OK/NOT_YET), `placeOrderDate`, `shippingDueDate`, `expectedDeliveryCompany`; `delivery.{deliveryCompany, trackingNumber, sendDate, deliveryStatus, isWrongTrackingNumber}`.
- `last-changed-statuses` 200 동작 확인.

**공개 문서(apicenter llms 문서 기준, 운영 반영 전 원문 재확인)**

- 발주확인 `POST /v1/pay-order/seller/product-orders/confirm` 최대 30개, 응답은 성공 목록만 → 실패는 상세조회로 재확인(계획의 재조회 원칙과 일치).
- 발송처리 `POST /v1/pay-order/seller/product-orders/dispatch` 최대 30개, `successProductOrderIds`/`failProductOrderInfos` 부분 실패 응답. 송장 수정 API 확인 못 함 → 잘못 등록 시 사람 처리.
- 상세조회 `POST …/query` 최대 300개. 변경 조회는 24시간 범위 제한 + `moreSequence` 페이지네이션, `CANCEL_REQUESTED`·`DELIVERY_ADDRESS_CHANGED` 포함.
- 택배사 코드: CJ대한통운 `CJGLS`, 롯데 `HYUNDAI`, 한진 `HANJIN`, 로젠 `KGB`, 우체국 `EPOST`.
- 발주확인은 상태 전이 없음(PAYED 유지), 의무발송기한 넘기면 발주확인 해제될 수 있음 → SLA 알림에 `shippingDueDate` 사용.
- 앱 권한은 API 그룹 단위. 발주확인·발송처리 **쓰기 권한은 실호출 전 확인 불가** → 실주문 1건 입회 시험으로 확인.

**위킵 FBW 조회(에이엠엘 계정 ameaning23, 읽기 전용, 2026-11-15)**

- **위킵에 「에이엠엘\_스마트스토어 - 연동」 판매처가 이미 있고 자동 주문 수집 중**(최근 수집 2026-11-15 08:15). 판매처는 3개: `에이엠엘_스마트스토어`(연동), `에이엠엘_엑셀`, `에이엠엘_B2B`.
- 최근 주문 30건: 스마트스토어 연동 7, 엑셀 22, B2B 1. 엑셀 주문번호 형식이 여러 가지(16자리·14자리·`YYYYMMDD-NNNNNNN`·`NNNN-NN-NN-NNNNNN`) → 여러 판매채널 주문을 엑셀로 등록 중.
- 주문 목록 `/fbw/admin/v2/order/searchOrder` 열: 주문등록일·판매처·대표 상품 관리명·판매처주문번호·총 주문수량·주문자·수령자·송장번호·추가송장·주문상태·처리. 「엑셀저장」(`orderExcelDownload()`) 있음 → 송장 회수 경로.
- 주문 등록 `/fbw/admin/v2/order/orderRegister`(엑셀 등록·개별 등록). 주문 상태: 주문요청·주문완료·상품준비중·배송중·주문보류·주문취소·부분주문완료.
- 위킵 운송사 목록에 CJ대한통운 계열 여러 개(위킵블랙 등) → 네이버 코드 매핑은 CJ 계열 전부 `CJGLS`.
- 공지(저온센터 위킵24 기준): 주문서 마감 **연동 판매처 평일 24시/주말 22시, 비연동(엑셀) 평일 18시/주말 출고 불가**. 에이엠엘 센터에 그대로 적용되는지는 미확인.
- **사용자 확인**: 위킵 스마트스토어 연동은 **N배송만** 자동 수집·송장 전송. 판매자배송 스마트스토어 포함 9개 채널은 「에이엠엘\_엑셀」로 수동 등록 중. 사람이 연동 판매처에 직접 넣은 주문은 송장 전송 실패가 나기도 함.
- **에이엠엘 센터 비연동 마감 14:00**(사용자 확인).
- 운영약관 동의 팝업이 떠 있음(동의 안 함).

**설계 영향(반영함)**: 범위를 엑셀 판매처 9개 채널로 확장(Q1), API 3 + 반자동 6. 스마트스토어 판매자배송은 위킵 연동과 겹치지 않아 기존 설계 유효.

**쿠팡 Open API 읽기 전용 조회(최근 14일, 기존 키, 2026-11-15)**

- 발주서 `GET /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/ordersheets`(status별, `nextToken` 페이지) 동작. 14일 판매자배송 발주서 54건(하루 약 4건): 결제완료(ACCEPT) 1·상품준비중(INSTRUCT) 6·배송완료 47. 택배사 전부 CJ대한통운, 송장 없는 7건 = 아직 출고 전.
- 발주서 단위 = `shipmentBoxId`(주문당 상품행 1~2개, 분리배송 가능 5건). 원장 키 = `coupang:<shipmentBoxId>:<vendorItemId>`. 행 필드에 `estimatedShippingDate`·`plannedShippingDate`·`invoiceNumberUploadDate`·`externalVendorSkuCode`·`cancelCount`·`holdCountForCancel` 있음 → 출고기한 SLA·취소 감지에 사용.
- 쓰기(상품준비중 처리·송장 업로드)는 같은 키로 가능할 것으로 보나 실호출 전 확인 불가 → 네이버와 같이 입회 시험.

**카페24**: 워크덱에 카페24 API 연동 없음(브라우저 자동화만). 주문·배송 API를 쓰려면 카페24 개발자센터 앱 등록 + 쇼핑몰 운영자 OAuth 승인(사용자 작업) 필요 → Phase 6 착수 전 준비. 준비 안 되면 카페24는 반자동으로 시작.

**위킵 주문 등록 화면(읽기 전용, 2026-11-15)**

- `/fbw/admin/v2/order/orderRegister` 에서 판매처 선택(에이엠엘\_엑셀) → 「엑셀 등록」(파일 업로드 → `/fbw/admin/file/temp_file_upload.do`) / 「개별 등록」. 「연동 양식 설정하기」로 업로드 양식 맞춤 가능.
- 비연동 B2C 수동 양식(`/fbw/static/form/b2cOrderForm.xlsx`) 열: **주문번호·상품번호·상품명·옵션명·수량·판매단가·판매금액·수령자·전화·핸드폰·우편번호·주소·배송메세지·배송비·송장출력갯수**. 주문번호 칸 = 추적키(`WD-…`). 상품번호 칸에 위킵 상품코드를 넣어 매칭(옵션별 위킵 상품코드 매핑 필요 — 기존 배송 방식 `formatConfig`·`DelShippingMethodLabel` 로 처리 가능한지 Phase 4 착수 시 확인).
- 주말 출고: 위킵 공지상 비연동은 주말 출고 불가(저온센터 기준) — 에이엠엘 센터 확인 필요.
- 참고: Playwright MCP 브라우저를 다른 세션과 공유하고 있어 조회 도중 다른 세션이 페이지를 바꿈 → 이후 실사는 별도 헤드리스 브라우저로 진행. 운영 워커도 전용 프로파일 필수.

**남은 실사**: 네이버·쿠팡 쓰기 권한(실주문 입회 시험), 카페24 앱 등록, 반자동 6채널 주문·송장 양식 샘플, 위킵 상품번호↔옵션 매핑 현황, 주말 출고.

## 13. 미정(Phase 0 결과로 확정)

- 네이버 발송처리 시 택배사 코드 목록, 위킵 업로드 양식 필수 칸, 위킵 송장 엑셀 경로, 주문번호 칸 길이 제한(추적키 형식 조정 가능).
