# 주문 자동화 Phase 1 — 채널 주문 관측(그림자 수집)·대사

- 작성: 2026-11-21
- 상위 계획: `docs/superpowers/plans/2026-11-15-order-fulfillment-pipeline.md`(같은 폴더, Codex 4차 반영본)
- 워크트리: `/Users/kaleos/projects/workdeck-app-order-pipeline` (브랜치 `feat/order-fulfillment-pipeline`, origin/main 기준)

## 1. 목표와 원칙

API 3채널(스마트스토어 판매자배송·쿠팡 판매자배송·카페24)의 주문을 **읽기만** 해서 워크덱에 "채널 쪽 사실"로 쌓고, 지금 사람이 엑셀로 넣는 배송 등록(DelOrder)과 매일 대조해 **수집 누락 0** 을 1주 연속 증명한다(상위 계획 Phase 2 그림자 운영의 완료 기준).

- 외부 쓰기 0건(발주확인·위킵 업로드·송장 등록 없음).
- 판매·재고 영향 0: **DelOrder·DelBatch·재고 이동을 만들지 않는다.** 관측 데이터는 별도 테이블에만.
- 개인정보 저장 안 함: 수령인·연락처·주소는 관측 테이블에 넣지 않는다(대사에 필요 없음).
- 상위 계획의 원장(ExternalOrderLedger)·DelOrder 단계 필드·`CHANNEL_PIPELINE` 묶음·기존 배송 API 보호·N배송/엑셀 중복 판정 변경은 **DelOrder 를 만들기 시작하는 Phase 3~4 에서** 한다(그 전엔 필요 없음 — 지금 바꾸면 운영 중인 N배송·엑셀 경로만 위험해짐).

## 2. 범위

### 2-1. 데이터 모델 (마이그레이션 1개, 추가만)

- `ChannelFulfillmentSetting`(채널 1:1): `channelId @unique`, `spaceId`, `adapter`(`naver`|`coupang`|`cafe24`), `storeKey String?`(네이버 스토어 키), `observeEnabled Boolean @default(false)`, `createdAt/updatedAt`. 이후 단계 스위치(autoCollectToSend 등)는 그 단계에서 추가.
- `ChannelOrderLine` — 채널 주문 **행 단위 최신 상태**(관측):
  - 키: `@@unique([channelId, externalLineKey])`. 키 = 네이버 `productOrderId`, 쿠팡 `shipmentBoxId:vendorItemId`, 카페24 `order_item_code`.
  - `spaceId, channelId, externalOrderId`(네이버 orderId·쿠팡 orderId·카페24 order_id), `paidAt`, `productName`, `optionText?`, `quantity`, `channelStatus`(원문 상태 코드), `claimStatus?`, `deliveryKind`(네이버 NORMAL/ARRIVAL_GUARANTEE 등 원문), `shippingDueAt?`, `carrierCode?`, `trackingNumber?`, `dispatchedAt?`, `firstSeenAt`, `lastSeenAt`, `rawHash`(변경 감지용 해시).
  - 인덱스 `[spaceId, paidAt]`, `[channelId, externalOrderId]`.
- `ChannelOrderScanLine`(일일 전수 조회 결과, 14일 보관): `operationId, channelId, externalLineKey, externalOrderId, quantity, channelStatus, paidAt`.
- `PipelineOperation`(실행 기록): `id, spaceId, channelId?, kind`(`OBSERVE`|`FULL_SCAN`|`RECONCILE`), `status`(`STARTED`|`SUCCEEDED`|`PARTIAL`|`FAILED`), `counts Json`, `error String?`(허용 목록 코드만), `startedAt, finishedAt`.

### 2-2. 수집기(읽기 전용)

| 채널   | 실행 위치                 | 조회                                                                                                                           | 비고                                                                                                                                                                                             |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 네이버 | 맥미니 워커(호출 IP 등록) | `last-changed-statuses`(직전 커서−1시간 겹침, 24시간 창, `moreSequence`) → 바뀐 상품주문 `POST product-orders/query`(최대 300) | 키는 기존 N배송 plan 라우트처럼 앱이 복호화해 내려줌. N배송 수집과 같은 스토어 키 → 워커에서 스토어 단위 직렬화·1.5초 간격 공유. `ARRIVAL_GUARANTEE` 도 저장하되 대사에서 제외(혼합 주문 관측용) |
| 쿠팡   | 맥미니 워커               | `GET ordersheets` status별(ACCEPT·INSTRUCT·DEPARTURE·DELIVERING·FINAL_DELIVERY·NONE_TRACKING), 최근 3일 + 미종결 재조회        | 키는 기존 `/api/collection/api-credentials`. `client.get(path, queryObject)`(쿼리를 경로에 붙이면 서명 불일치 — 실사에서 확인)                                                                   |
| 카페24 | 앱 서버(Vercel cron)      | `GET /api/v2/admin/orders` 최근 3일(`embed=items`), 100건 페이지                                                               | `src/lib/cafe24/client.ts` `cafe24Get` 재사용(토큰 갱신·호출 제한 처리 포함)                                                                                                                     |

- 주기: 30분(워커 스케줄러 / Vercel cron `*/30`). 미종결 행(`dispatchedAt` 없음 & 취소 아님)은 결제일과 무관하게 재조회 대상. **카페24는 증분 겹침을 8일(전수 창 7일+1일)로 두어 이 "미종결 재조회"를 충족한다**(별도 미종결 쿼리 없음).
- **최초 backfill·장애 따라잡기**: 커서가 없으면 14일 전부터 시작. 한 번에 조회할 기간을 채널 한도로 나눈다(네이버 24시간 창, 쿠팡·카페24 1일 단위). 커서와 현재 시각 차가 크면(장애 후) 같은 방식으로 창을 순서대로 따라잡는다. 따라잡는 중엔 대사가 해당 채널을 "공백 있음"으로 표시하고 성공 판정 금지.
- **실행·커서 규칙**: 채널별 lease(`ChannelFulfillmentSetting.observeLease {operationId, until}`, 조건부 쓰기로 획득, 15분) — 동시 실행 금지. ingest 는 `operationId` 를 받아 **행 쓰기와 같은 트랜잭션에서 lease 소유·미만료를 확인**(아니면 409, 아무것도 안 씀). 행 upsert 는 멱등(같은 키·같은 rawHash 면 lastSeenAt 만 갱신)이고, 채널 원본 변경 시각(네이버 lastChangedDate·쿠팡/카페24 상태 갱신 시각)이 저장값보다 오래되면 덮어쓰지 않는다. **커서는 finish 에서만 전진**: 요청한 전체 기간의 모든 페이지가 ingest 성공했고, 그 operation 이 현재 lease 소유자일 때만 `observeCursor = 조회 끝 시각`(조건부 쓰기). 오래된 operation 의 finish·lease 만료 후 finish 는 거부. 페이지 중간 실패·워커 종료 → 커서 그대로, operation `FAILED`(15분 타임아웃 후 다음 실행이 정리) → 다음 실행이 같은 창부터 다시.
- **일일 전수 조회(독립 원본 2)**: 하루 1회(대사 직전) 채널별로 증분 경로와 **다른 API** 로 최근 7일 전체 목록을 다시 받는다 — 네이버 `GET pay-order/seller/product-orders?rangeType=PAYED_DATETIME` 일자별, 쿠팡 ordersheets createdAt 일자별(전 status — 쿠팡은 별도 목록 API 가 없어 같은 API 의 다른 조회 방식이라 독립성이 약하다. 엑셀(다)이 두 번째 대조군), 카페24 orders 일자별. 결과는 관측 테이블에 쓰지 않고 대사 입력으로만 쓴다(증분 수집이 놓친 것을 잡는 대조군). 전수 조회도 `PipelineOperation(kind=FULL_SCAN)` 으로 기록: 대상 기간, 요청 페이지·받은 페이지 수, **응답 구조 검증**(기존 네이버 코드처럼 `data`/`contents` 가 없으면 빈 목록으로 넘기지 않고 실패), 완료 여부. 결과 행은 대사 실행이 읽을 수 있게 `ChannelOrderScanLine`(operationId, 행 키, 주문 키, 수량, 상태) 임시 테이블에 저장하고 14일 뒤 삭제.
- 앱 라우트: `GET /api/collection/channel-orders/plan`(워커용: observeEnabled 채널·스토어 키·커서), `POST /api/collection/channel-orders/ingest`(행 배열 upsert, zod 검증, 개인정보 필드 거부), `POST .../finish`(PipelineOperation 마감). 워커 인증은 기존 Space 워커 토큰 방식.
- 카페24는 `app/api/cron/channel-orders-cafe24/route.ts` 가 같은 ingest 함수를 직접 호출.
- 커서: `ChannelFulfillmentSetting` 에 `observeCursor Json?`·`observeLease Json?`·`reconcileMode`(`diagnose`|`judge`, 기본 diagnose)·`matchKeyRule Json?` 추가.

### 2-3. 대사(매일 09·18시 KST, Vercel cron)

- 대상: 각 채널의 **판매자배송** 관측 행 중 최근 7일 결제 + 미종결 전부.
- 워크덱 쪽: 같은 Space 의 DelOrder(엑셀 등록분, `source=MANUAL`). **매칭 키는 구현 전에 확정한다(단계 0)**: 엑셀 임포트(`app/api/sh/shipping/import/route.ts`)가 채널을 `DelOrder.channelId` 로, 주문번호를 매핑된 열에서 `orderNumber` 로 저장하는 실제 흐름을 추적하고, 채널별 `orderNumber` 형식·channelId 채움 비율은 **운영 앱 안의 '키 진단 모드'** 로 확인한다(사용자 결정 2026-11-21, 운영 DB 직접 조회 대신): 대사 cron 이 `reconcileMode='diagnose'` 인 동안 관측 행의 주문 키(네이버 orderId·productOrderId, 쿠팡 orderId·shipmentBoxId, 카페24 order_id)와 같은 기간 엑셀 DelOrder 의 `orderNumber`·`channelId` 를 비교해 **형식 패턴(숫자 자릿수·구분자)별 건수와 후보 키별 일치율**만 Slack 으로 보낸다(주문번호 원문·개인정보 없음). 결과로 채널별 키 규칙을 이 문서에 기록하고 `reconcileMode='judge'` 로 바꾼 날부터 7일 판정 시작.
- 상품 비교: DelOrderItem 의 매칭 옵션/listing 을 채널 alias 사전으로 관측 상품명과 대응. 대응 불가는 C.
- 원본 3개: (가) 관측 테이블(증분 수집 결과) (나) 일일 전수 조회 (다) 워크덱 엑셀 DelOrder(사람이 채널에서 내려받아 올린 것 — 수집기와 독립).
- 판정(주문 단위, 상품·수량 합계 비교):
  - **A 수집 누락** = (나) 또는 (다)에 있는데 (가)에 없음 → 수집기 결함. **완료 판정의 기준**. (나)↔(가) 비교는 **행 키 단위**(네이버 상품주문번호, 쿠팡 shipmentBoxId:vendorItemId, 카페24 order_item_code) + 행별 수량·상태로 한다 — 주문의 일부 행만 빠지거나 수량이 다르면 A. (다)↔(가)는 주문 단위 수량 합계.
  - **B 엑셀 등록 누락 후보** = (가)에 있는데 (다)에 없음(결제 후 영업일 기준 1일 지남) → 사람 작업 점검용(정보).
  - **C 미해결** = 매칭 키 없음·한 주문에 여러 DelOrder 가 걸쳐 수량 합계가 안 맞음·상품 대응 모호 → 일치로 치지 않는다. 완료 차단.
  - **D 취소 반영 필요** = (가) 취소인데 (다) 미완료 묶음에 있음.
  - **E 출고 지연** = (가) 송장 없음 & `shippingDueAt` 지남.
- **수집 상태 게이트**: 대사 시점에 채널별 (1) 최근 24시간 증분 수집 중 FAILED/PARTIAL 이 있거나 (2) 커서가 2시간 넘게 뒤처졌거나 (3) 따라잡는 중이거나 (4) 그날 전수 조회가 없거나·실패·부분·대상 기간 미달이면 그 채널 결과는 "판정 불가" — 0건이어도 성공 아님.
- 결과: `PipelineOperation(kind=RECONCILE, counts)` + Slack(기존 seller-hub 알림 채널, `sendSpaceNotification`) 요약·건수·상위 10건(주문번호·상품·경과시간 — 개인정보 없음).
- **완료 기준**: 7일 연속, 3채널 모두 (1) 수집 상태 게이트 통과 (2) A=0 (3) C=0 또는 사람이 사유를 기록해 해소. 하루라도 어기면 다시 7일.

### 2-4. 화면(최소)

- 판매채널 설정의 기존 채널 편집 팝업에 "주문 관측(그림자 수집) 사용" 스위치 + 어댑터·스토어 키 선택(ADMIN). 새 화면 없음.
- 관측 결과 목록 화면은 이번에 만들지 않는다(Slack 리포트로 충분, 「주문 처리 현황」은 Phase 3).

## 3. 변경 파일(예상)

- `prisma/schema.prisma` + 마이그레이션 `*_channel_order_observe`
- `src/lib/channel-orders/{types.ts, ingest.ts, reconcile.ts, normalize.ts}`
- `src/lib/channel-orders/adapters/cafe24.ts`(앱), `worker/src/channel-orders/{naver.ts, coupang.ts, runner.ts}`
- `app/api/collection/channel-orders/{plan,ingest,finish}/route.ts`, `app/api/cron/channel-orders-cafe24/route.ts`, `app/api/cron/channel-orders-reconcile/route.ts`, `vercel.json` cron 2개
- 채널 편집 팝업 컴포넌트(기존 파일) + 설정 저장 API(기존 채널 API 확장)
- 테스트: 주문 일부 행 누락·수량 부족을 A 로 판정, 만료·교체된 operation 의 ingest 거부(행 미변경), 오래된 원본 변경 시각 덮어쓰기 거부, 전수 조회 실패·부분·응답 구조 이상 시 판정 불가, 수집기가 빈 결과/실패여도 대사가 성공으로 판정하지 않음, 커서는 전체 성공 finish 에서만 전진·오래된 finish 거부·중간 실패 후 같은 창 재시도, 최초 backfill·장애 따라잡기 창 분할, 일대다·분할 등록 수량 합계 판정, 어댑터 응답 → 행 변환(네이버 중첩 응답·쿠팡 숫자형 id 문자열화·카페24 items), ingest upsert·개인정보 거부·멱등, 대사 4판정, 주문번호 정규화, 워커 직렬화

## 4. 단계

0. 매칭 키 확정 = 아래 1·2 배포 후 키 진단 모드 리포트로(엑셀 임포트 흐름은 코드로 추적) — 결과를 이 문서에 기록
1. 모델·ingest·lease/커서·대사 로직 + 테스트(dev DB 통합 포함)
2. 카페24 수집 cron(가장 단순, 서버 내) → 운영 관측 시작
3. 쿠팡·네이버 워커 수집기 → 운영 워커 체크아웃(`/Users/kaleos/projects/kaleos/workdeck-runner`) 배포·kickstart
4. 대사 cron + Slack → 7일 관찰
   각 단계 develop → main 격리 릴리스.

## 5. 검증

- 단위·통합 테스트, `tsc`·`lint`·`build`.
- 운영: 채널별 관측 켠 뒤 첫 수집 건수를 실사 수치(에이엠엘 판매자배송 7일 16건, 쿠팡 14일 54건)와 비교, 카페24는 관리자 주문 목록 건수와 비교(사용자 확인).
- 첫 대사 리포트를 사람이 수기로 1회 대조(누락 후보가 실제 누락인지).

## 6. 롤백

- `observeEnabled=false` 로 즉시 중단. 테이블은 추가만이라 남겨도 무해(다른 기능이 안 읽음). 코드 revert 시 cron·워커 작업만 멈춤.

## 7. 위험

- 네이버 N배송 수집과 같은 키 → 429. 워커에서 스토어 단위 직렬화·간격 공유.
- 엑셀 주문번호 형식 차이로 대사 오탐 → 첫 주는 리포트를 "후보"로만 표기, 정규화 규칙을 데이터로 보정.
- 카페24 호출 제한(버킷 40) — 30분 1회·페이지 직렬이라 여유.

## 8. Codex 리뷰

`adversarial-review` 1차: 지적 4건 — 반영 4, 보류 0.

1. [critical] 판정 방향 반대(수집기가 빈 결과여도 누락 0) → 독립 원본 2개(일일 전수 조회·엑셀) 대비 관측에 없는 것을 A(수집 누락)로, 수집 상태 게이트, 완료 기준 재정의
2. [high] 최초·장애 후 이력 공백 → 14일 backfill·창 분할 따라잡기·따라잡는 중 판정 금지
3. [high] 매칭 키·일대다 미검증 → 단계 0 에서 실제 import 흐름·운영 형식 확정, 주문 단위 수량 합계·모호 건 C 로 완료 차단
4. [high] 부분 수집·커서 원자성 → 채널 lease, finish 에서만 조건부 커서 전진, 오래된 finish 거부, 실패 시 같은 창 재시도

`adversarial-review` 2차: 지적 3건 — 반영 3, 보류 0.

1. [critical] 주문 존재만 비교해 일부 행 누락을 놓침 → 전수↔관측을 행 키·수량·상태 단위로 비교, 행 누락·수량 차 = A
2. [high] 만료 operation 의 ingest 가 최신 상태 덮어씀 → ingest 마다 lease 소유를 같은 트랜잭션에서 확인, 원본 변경 시각 역행 쓰기 거부
3. [high] 전수 조회 실패·부분이 게이트에 없음 → FULL_SCAN operation 기록·응답 구조 검증·게이트 (4) 추가, 결과는 ChannelOrderScanLine 임시 테이블
