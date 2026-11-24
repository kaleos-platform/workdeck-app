# 채널 주문 관측 2차 — 네이버·쿠팡 워커 수집기

상위: `2026-11-21-order-pipeline-phase1.md`(1차 = 서버 계약·카페24·대사, main #1574). 이 문서는 그 계획 §2-2 표의 네이버·쿠팡 행과 "구현 순서 3"만 다룬다.

## 목표

맥미니 워커가 observeEnabled 인 네이버(스마트스토어)·쿠팡 채널의 주문을 **읽기만** 해서 기존 서버 계약(`POST /api/collection/channel-orders/plan` → `ingest` → `finish`)으로 보고한다. 09·18시 KST 대사 전에 FULL_SCAN 을 남겨 대사가 "판정 불가(전수 조회 없음)"로 끝나지 않게 한다. 외부 쓰기·개인정보 저장 없음.

## 현재 상태(코드 대조)

- 서버: plan GET/POST·ingest·finish 가 `naver`·`coupang` 어댑터를 이미 받는다(`WORKER_ADAPTERS`). 창 계획 `ADAPTER_WINDOW`(naver 1일 창·1시간 겹침, coupang 1일 창·3일 겹침), lease 15분, ingest 300행, 개인정보 키 strict 거부.
- 키 수급이 비어 있다: plan 주석은 "기존 N배송 plan·api-credentials 경로를 쓴다"지만
  - N배송 plan 은 `daysToSync` 가 빈 스토어를 빼고 secrets 도 그 스토어만 내려준다 → N배송이 따라잡힌 시간대엔 키가 안 온다.
  - `api-credentials` 는 레거시 workspace 키(`WORKER_API_KEY`) 기준, channel-orders 는 Space 워커 토큰 기준 → 두 인증 범위가 다르다.
- 워커: `naver-commerce.ts` 는 `pay-order/seller/product-orders`(결제일 목록)만 있고 `toProductOrder` 가 배송·변경시각 필드를 버린다. 쿠팡 `CoupangApiClient`(서명·1.3초 스로틀·429 재시도·`paginate`)는 있고 ordersheets 엔드포인트는 없다.
- 스케줄: N배송은 `20 * * * *`(같은 스토어 키·같은 호출 한도).

## 설계

### 1. 키 수급

- **네이버**: `POST /plan`(start) 응답에 `secret: {clientId, clientSecret} | null` 을 싣는다(OBSERVE·FULL_SCAN). Space 의 `SpaceCredential(naver-commerce)` 를 앱이 복호화해 그 채널 `storeKey` 것만. N배송 plan 이 같은 Space 토큰에 이미 같은 평문 키를 내려주고 있어 노출 범위가 늘지 않는다. 복호화 실패·스토어 없음 → operation 은 만들고 `secret: null` → 워커가 즉시 `finish(success:false, errorCode:'auth_error')`(실패가 기록으로 남아 대사 게이트·Slack 에 보임).
- **쿠팡**: 평문 키를 새 경로로 내리지 않는다(Codex #1 — 쿠팡 키는 가격 쓰기 권한까지 있어 Space 토큰 노출 범위를 넓히면 안 됨). 워커는 지금처럼 `GET /api/collection/api-credentials`(레거시 `WORKER_API_KEY`, 암호문 → 워커 로컬 복호화)로 받는다. 인증 범위 불일치는 start 응답의 `vendorId`(비밀 아님 — `Workspace.spaceId = Space` 인 `CoupangApiCredential.vendorId`)와 워커가 가진 자격증명의 vendorId 를 비교해 막는다. 다르거나 서버 쪽 자격증명이 없으면 `auth_error` 로 마감.
- GET(일정 조회)에는 키를 싣지 않는다. 응답·로그·에러에 키 원문 금지.

### 2. 페이지·ingest 카운터 계약(Codex #3)

서버 검증: OBSERVE `pagesRequested === pagesIngested` · `ingestCalls ≥ max(minCalls, pagesIngested)`, FULL_SCAN `pagesRequested === pagesReceived` · `ingestCalls ≥ max(minCalls, pagesReceived)` · `through/periodTo === plannedThrough`. 워커 규칙(카페24 어댑터와 동일):

- **페이지 = 외부 목록 응답 1장**. 요청 직전 `pagesRequested++`.
- 그 페이지 행을 전부 ingest(300행 단위 분할, **빈 페이지도 `[]` 로 1회**)한 뒤에만 `pagesIngested++`(FULL_SCAN 은 `pagesReceived++`). 따라서 ingestCalls ≥ 페이지 수가 항상 성립하고, 페이지·status 하나라도 빠지면 요청 수 ≠ 적재 수로 실패한다.
- 네이버 OBSERVE: 페이지 = `last-changed-statuses` 응답 1장. 그 장의 productOrderId 를 300개씩 `query` 로 받아 합친 뒤 ingest, 끝나면 `pagesIngested++`.
- 쿠팡: status 6종 × 창 × nextToken 페이지 각각이 1페이지. 페이지마다 따로 ingest 하므로 status 간 같은 키가 겹쳐도 다른 ingest 호출이라 서버가 기존 행 갱신으로 처리(같은 배치 안 중복 → createMany unique 충돌은 한 페이지 안에서 생기지 않음). 별도 dedupe 안 함.
- `through`/`periodTo` 는 서버가 준 마지막 창 끝/`plannedThrough` 그대로.

### 3. 네이버 수집기(`worker/src/channel-orders/naver.ts`)

- 기존 `fetchPaidProductOrders`·`toProductOrder` 는 재사용하지 않는다(Codex #2 — `data` 없으면 빈 배열, 필수 필드 없는 행은 경고 후 버림). 새 엄격 조회:
  - 응답에 `data` 없음·`contents`/목록이 배열 아님·`pagination` 형태 이상 → `StructureError`(`structure_invalid`).
  - 필수 필드(`productOrderId`·`orderId`·`paymentDate`·`productName`·`quantity`·`productOrderStatus`) 하나라도 없는 행 → 페이지 전체 실패(버리지 않음).
  - `query` 응답 건수 < 요청 ID 수 → 실패.
  - HTTP·토큰·429 재시도는 기존 함수(`issueToken`, 1.5초 간격, 429 3회) 재사용 — 공용 부분만 export.
- OBSERVE: 창마다 `GET pay-order/seller/product-orders/last-changed-statuses?lastChangedFrom&lastChangedTo`(+`moreSequence` 이어받기) → `POST pay-order/seller/product-orders/query`.
- FULL_SCAN: 창(KST 일자)마다 `pay-order/seller/product-orders?rangeType=PAYED_DATETIME` 페이지 순회 → ScanLine.
- 행 변환(화이트리스트): `externalLineKey=productOrderId`, `externalOrderId=orderId`, `paidAt=order.paymentDate`, `productName=productOrder.productName`, `optionText=productOrder.productOption`, `quantity`, `channelStatus=productOrderStatus`, `claimStatus=claimStatus ?? claimType`, `deliveryKind=deliveryAttributeType ?? 'NORMAL'`, `shippingDueAt=shippingDueDate`, `carrierCode=delivery.deliveryCompany`, `trackingNumber=delivery.trackingNumber`, `dispatchedAt=delivery.sendDate`, `sourceChangedAt=lastChangedDate`. 수령인·주소·연락처·주문자 필드는 담지 않는다. 문자열은 스키마 한도로 자르고 키·ID 는 자르지 않는다.

### 4. 쿠팡 수집기(`worker/src/channel-orders/coupang.ts`)

- 주문: `GET /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/ordersheets` — `createdAtFrom/To`(KST yyyy-MM-dd), `status`, `maxPerPage=50`, `nextToken`. `client.get(path, queryObject)`.
- status 6종(ACCEPT·INSTRUCT·DEPARTURE·DELIVERING·FINAL_DELIVERY·NONE_TRACKING) × 창 순회(OBSERVE·FULL_SCAN 공통).
- **취소(Codex #5)**: ordersheets 에 취소 status 가 없어 취소된 행이 낡은 활성 상태로 남는다. OBSERVE 에서 같은 창으로 취소 요청 목록(`returnRequests`, `cancelType=CANCEL`, 창 단위)도 읽어 해당 `shipmentBoxId:vendorItemId` 행을 `claimStatus='CANCEL'` 로 ingest(기존 행 갱신용 — 행 원본 필드는 ordersheets 에서 이미 받은 값이 있어야 하므로 취소 목록만 있는 키는 `productName`(취소 응답 상품명)·수량(취소 수량)으로 신규 행). 엔드포인트·필드는 단계 0 실사로 확정. **실사에서 취소 목록을 못 쓰면 쿠팡 채널은 `diagnose` 모드만 허용**(설정 PUT 에서 coupang+judge 거부 한 줄) — 취소를 모르는 상태로 판정하지 않는다.
- FULL_SCAN 은 ordersheets 만(전수 = 활성 행 대조군). 취소 행은 대사가 관측의 `claimStatus` 로 제외.
- 행 변환: `orderItems[]` 마다 `externalLineKey=`${shipmentBoxId}:${vendorItemId}``(숫자 → 문자열), `externalOrderId=String(orderId)`, `paidAt=paidAt ?? orderedAt`(KST → ISO), `productName=vendorItemName ?? sellerProductName`, `optionText=sellerProductItemName`, `quantity=shippingCount`, `channelStatus=status`, `deliveryKind='NORMAL'`, `carrierCode=deliveryCompanyName`, `trackingNumber=invoiceNumber`, `dispatchedAt=invoiceNumber 있으면 inTrasitDateTime ?? null`, `shippingDueAt=estimatedShippingDate`, `sourceChangedAt=null`. `receiver`·`orderer`·`overseaShippingInfoDto` 는 담지 않는다. 필수 필드 없는 행 → 페이지 실패.
- **스로틀 공유(Codex #6)**: `CoupangApiClient.lastCallAt` 을 인스턴스 필드에서 모듈 변수로 옮긴다(워커는 한 프로세스 — 수집·쓰기 폴러·이 수집기 모두 같은 간격 공유). 한 줄 변경.

### 5. 러너·스케줄·시간 예산(Codex #4)

- 토큰: `NAVER_NBAESONG_WORKER_TOKENS`(Space 토큰 공용, 이름 변경은 운영 plist 수정이 필요해 범위 밖).
- `runChannelOrders(kind)`: 토큰마다 `GET plan` → 채널마다 `POST plan {kind}` → 409·404 건너뜀 → 수집 → `finish`. 예외 시 `finish(success:false, errorCode)`, finish 409 는 로그만.
- 오류 코드: 401/403·IP 미등록·토큰 실패 → `auth_error`, 구조 → `structure_invalid`, 기타 HTTP → `api_error`, ingest 409 → `lease_lost`, 마감 초과 → `timeout`.
- **operation 마감 시한**: 시작 후 12분이 지나면 다음 페이지를 요청하지 않고 `finish(success:false, 'timeout')`(서버 lease 15분 전에 스스로 접음 — lease 연장 없음). 커서는 그대로라 다음 회차가 같은 창부터.
- **예산 근거**: 쿠팡 일반 OBSERVE = 창 4(3일 겹침+당일) × 6 status ≈ 24호출 × 1.3초 ≈ 35초(+취소 4호출). 최초 backfill 14창 ≈ 84호출 ≈ 2분. FULL_SCAN 8창 × 6 ≈ 48호출 ≈ 1분. 네이버는 창 1~2개. 페이지가 늘어도 12분 안. 단계 0 에서 7일 페이지 수를 실측해 이 수치를 확인하고, 12분을 넘을 규모면 구현 전에 다시 설계한다. 최초 backfill 이 시한에 걸리면 `OBSERVE_MAX_WINDOWS` 를 워커가 줄일 수 없으니 — 서버 상수 조정이 필요하다는 것을 단계 0 결과로 판단.
- 스케줄(KST): OBSERVE `5,35 * * * *`. 일일 `30 8 * * *`·`30 17 * * *` — OBSERVE 후 FULL_SCAN(카페24 `runCafe24Daily` 순서). 네이버가 N배송(`:20`)과 겹쳐 `naverBusy` 면 1분 간격 재시도하되 **08:50/17:50 이후엔 시작하지 않는다**(대사 전 끝나야 의미). 못 돌면 대사는 기존 게이트로 「판정 불가」 → Slack 에 그대로 보임(조용히 성공 처리 안 됨).
- 네이버 직렬화: 한 프로세스 공유 플래그 `naverBusy` 를 N배송 러너와 함께 쓴다.

### 6. 서버 변경(최소)

- `app/api/collection/channel-orders/plan/route.ts` start 응답에 naver `secret`, coupang `vendorId`.
- `src/lib/channel-orders/worker-secret.ts`(naver 복호화·coupang vendorId 조회) + 테스트.
- (조건부) 쿠팡 취소 목록 실사 실패 시 settings PUT 에서 coupang+judge 거부.

## 단계 0 실사 결과(2026-11-24, 읽기만, 키 경로·건수만)

- 네이버 `last-changed-statuses`: `data.lastChangeStatuses[]{orderId, productOrderId, lastChangedType, paymentDate, lastChangedDate, productOrderStatus, receiverAddressChanged}`, `data.count`, (16건일 때 `more` 없음). **변경 0건이면 `data` 키 자체가 없고 `timestamp`·`traceId` 만 온다** → 규칙: HTTP 200 + `traceId` 있음 + `data` 없음 = 0건(정상). `data` 가 있는데 형태가 다르거나 `traceId` 도 없으면 `structure_invalid`. 결제일 목록도 같은 규칙.
- 네이버 `query`: `data[]{order{orderId, paymentDate, …}, productOrder{productOrderId, productName, productOption, quantity, productOrderStatus, deliveryAttributeType, shippingDueDate, claimType?, claimStatus?, …}, delivery?{deliveryCompany, trackingNumber, sendDate, deliveredDate, deliveryStatus}}`. 응답에 `shippingAddress`·`takingAddress`·`ordererName/Tel` 등 개인정보가 오므로 화이트리스트 매핑 필수. 요청 5 → 응답 5.
- 네이버 7일 결제 목록: 에이엠엘 7페이지 27행, 크림드 7페이지 3행.
- 쿠팡 ordersheets: `data[]{shipmentBoxId:number, orderId:number, orderedAt, paidAt, status, deliveryCompanyName, invoiceNumber, inTrasitDateTime, deliveredDate, orderItems[]{vendorItemId:number, vendorItemName, sellerProductName, sellerProductItemName, shippingCount, cancelCount, holdCountForCancel, canceled:boolean, estimatedShippingDate}, orderer, receiver, overseaShippingInfoDto}`, `nextToken`. 7일 status 6종 × 7일 = 42페이지, 20건, **53초**(예산 충분).
  - 행 단위 취소 정보가 ordersheets 에 있다: `canceled=true` → `claimStatus='CANCEL'`, `cancelCount>0` → `quantity = shippingCount`(원문 유지) + `claimStatus='PARTIAL_CANCEL'`.
- 쿠팡 취소 목록 `GET v6/.../returnRequests?searchType=timeFrame&createdAtFrom=yyyy-MM-ddT00:00&createdAtTo=…&cancelType=CANCEL`: 200, 7일 0건 → 항목 구조 미확인. 구현: `data` 배열 검증 + 항목에서 `orderId`·`returnItems[].vendorItemId`·`shipmentBoxId`(문서 필드) 가 없으면 `structure_invalid`(조용히 무시하지 않음). 첫 실건이 오면 구조 실패로 드러나므로 그때 매핑을 확정. 매칭: 항목의 `shipmentBoxId` 로 주문서 단건 `GET v4/vendors/{vendorId}/{shipmentBoxId}/ordersheets` 를 다시 읽어 일반 행 변환(`canceled`/`cancelCount` → claimStatus) 후 ingest. 취소 목록 1장 = 1페이지, 그 장의 단건 조회·ingest 가 모두 끝나야 `pagesIngested++`. 단건 404·구조 이상 → 페이지 실패. OBSERVE 에서만(FULL_SCAN 은 ordersheets 만).
  - 쿠팡 judge 금지 조건(§4)은 해제: 취소 목록 호출 가능 확인.

## 변경 파일

- 앱: `app/api/collection/channel-orders/plan/route.ts`, `src/lib/channel-orders/worker-secret.ts`(+테스트), (조건부) `src/lib/channel-orders/types.ts` refine 한 줄
- 워커: `worker/src/channel-orders/{naver.ts, coupang.ts, runner.ts}`(+`__tests__`), `worker/src/api-client.ts`(channel-orders 3개 호출), `worker/src/naver-commerce.ts`(공용 부분 export), `worker/src/coupang-api/client.ts`(lastCallAt 모듈 변수), `worker/src/index.ts`(스케줄·`naverBusy`)

## 단계

0. **실사(읽기만, 운영 워커, 키 이름·건수만 기록 — 값·개인정보 미기록)**: 네이버 `last-changed-statuses`·`query` 응답 키와 페이지 크기, 쿠팡 ordersheets 응답 키(`paidAt`·`shippingCount`·`vendorItemName`·`inTrasitDateTime`)와 7일 status별 페이지 수, 쿠팡 취소 목록 엔드포인트·필드. 결과로 §3·§4 변환 표와 §5 예산 수치를 확정해 이 문서에 기록.
1. 서버 secret/vendorId + 테스트(다른 Space 채널 404, 자격증명 없음 → secret null, 응답에 쿠팡 secretKey 없음).
2. 워커 변환·엄격 조회(순수) + 테스트: 네이버 중첩 응답, `data` 없음·pagination 이상·필수 필드 누락 → throw, `query` 건수 부족 → throw, 쿠팡 숫자 id 문자열화, 개인정보 키 미포함, 결과가 앱 `OrderLineInputSchema` 형태(필수 `productName` 포함).
3. 러너 + 테스트(가짜 서버로 plan→ingest→finish): 여러 status·빈 페이지·300행 초과·중간 페이지 실패 → `pagesRequested ≠ pagesIngested` 로 실패, secret null → auth_error, vendorId 불일치 → auth_error, 12분 시한 → timeout, busy 건너뜀.
4. 스케줄·직렬화·쿠팡 스로틀 공유.
5. develop PR → main 격리 릴리스 → 운영 워커 체크아웃(`workdeck-runner`) 반영·kickstart.
6. 운영: 채널 관측 ON 은 **사용자**가 「주문정보」 탭에서. 첫 OBSERVE SUCCEEDED·ingestRows 를 실사 수치(에이엠엘 판매자배송 7일 16건, 쿠팡 14일 54건)와 비교, 다음 대사 Slack 에서 해당 채널이 「판정 불가(전수 없음)」가 아닌지 확인.

## 검증

- 앱 `npm test`(secret 테스트)·`npx tsc --noEmit`·`npm run lint`, 워커 `cd worker && npm test && npx tsc --noEmit`.
- 운영: 단계 6.

## 위험·롤백

- 키 노출: 네이버는 기존 N배송 노출 범위와 동일, 쿠팡 평문은 새로 내리지 않음. Space 토큰 유출 시 기존 폐기 절차(어드민에서 토큰 회전)를 따른다 — 새 절차 없음.
- 네이버 429: N배송과 직렬화, 1.5초 간격. 쿠팡: 프로세스 공용 간격.
- 쿠팡 IP allowlist: 기존 수집과 같은 IP. 바뀌면 `IP_REJECTED` → `auth_error`.
- 롤백: 채널 `observeEnabled=false`(즉시), 워커 스케줄 커밋 revert. 서버 변경은 응답 필드 추가뿐.

## Codex 리뷰

`adversarial-review` 1차: 지적 7건 — 반영 7, 보류 0.

- #1 쿠팡 평문 키 → 새로 내리지 않고 기존 암호문 경로 + vendorId 대조(§1).
- #2 네이버 목록 재사용 → 엄격 조회 신설(§3).
- #3 카운터 계약 → 페이지 단위 규칙 명시, dedupe 제거(§2).
- #4 시간 예산 → 12분 자체 시한·예산 실측·08:50 이후 미시작(§5).
- #5 쿠팡 취소 → 취소 목록 관측, 실사 실패 시 쿠팡 judge 금지(§4).
- #6 스로틀 → 모듈 공용 간격(§4).
- #7 productName → 매핑 추가·스키마 통과 테스트(§3·§4, 단계 2).
