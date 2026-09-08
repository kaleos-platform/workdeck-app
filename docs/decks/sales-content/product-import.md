# 상품 추가 경로 — seller-ops 가져오기 / 링크 추출

`/d/sales-content/settings?tab=sales-info&section=products` 의 "상품 추가" 드롭다운에서 셋 중 하나를 고른다.

| 경로                     | 동작                                          |
| ------------------------ | --------------------------------------------- |
| 직접 입력                | 기존 `/settings/products/new` 페이지 (무변경) |
| 세일즈 운영에서 가져오기 | seller-ops 상품을 골라 **복사본** 생성        |
| 상품 링크에서 가져오기   | 상품 페이지 URL → 본문 추출 → AI 정리         |

두 신규 경로 모두 다이얼로그에서 **미리보기 → 편집 → 저장**을 거치고, 저장은 기존 `POST /api/sc/products` 가 한다.

## 왜 이 어휘를 쓰는가

`customFields` 의 key 는 아이데이션 프롬프트에 `- {key}: {value}` 로 **그대로 실린다**
(`src/lib/sc/prompts.ts` `renderProduct`). 즉 key 는 AI 가 읽는 레이블이다.
두 경로가 같은 어휘를 써야 상품끼리 호환되므로 `src/lib/sc/product-import/labels.ts` 한 곳에 모아둔다.

`상세 설명` / `핵심 기능` / `인증·규격` / `제조사` / `원산지` / `용량·규격` / `주의사항` / `브랜드` / `권장 소비자가`

## seller-ops 가져오기

- 전용 API 를 만들지 않고 `GET /api/sh/products?includeName=1&page=&pageSize=20` 를 그대로 호출한다.
  그 라우트의 `resolveDeckContext('seller-hub')` 가 이미 `DeckInstance.isActive` 를 강제하므로
  **서버 게이트가 따로 필요 없다.** 화면의 `isActive` 조회는 메뉴 노출 판단에만 쓴다.
- **`includeName=1` 은 필수** — 없으면 검색이 관리명(`internalName`)만 본다.
- **공식명(`name`)을 가져온다.** 관리명은 내부 식별용이라 고객 대상 콘텐츠에 부적합하다.
  기존 `OptionPickerDialog` 는 표시명으로 접으면서 공식명을 버리므로 재사용하지 않았다.
- 한 줄 소개는 `description` 의 **첫 문장**을 자동으로 넣는다(AI 호출 없음). 전문은 `상세 설명` 으로 보관한다.
- **복사본이다.** 원본과 연결·동기화하지 않고 출처도 기록하지 않는다 → 스키마 변경 없음.
  같은 상품을 두 번 가져오면 두 개가 생긴다(sc `Product` 에는 dedup 키가 없다).

## 링크 추출

`POST /api/sc/products/extract` — body `{url}` 또는 `{url, pastedText}` → `{draft}`. 저장은 하지 않는다.

파이프라인: `safeFetchHtml`(SSRF 가드) → `htmlToText`(JSON-LD·상세 컨테이너·og 메타·ec-data-src) →
`safeFetchBinary` → sharp 이미지 분할 → `generateTextForSpace(responseFormat:'json')` → zod → `normalizeExtracted`.

- **상세 이미지도 AI에 전달한다.** `TextMessage.images`의 MIME/base64를 OpenAI·Anthropic·Gemini API 또는 Codex CLI 입력으로 변환한다. BYOK/워크덱 설정과 쿼터는 유지한다. 상세 컨테이너가 있으면 해당 이미지만 분석해 화면 아이콘을 제외한다.
- 긴 이미지는 최대 폭 1200px·높이 1800px 구간으로 나누어 작은 글자를 읽는다. 다운로드/크기/개수 한도에서 누락되면 `warnings`와 상품 `분석 주의사항`에 남긴다. `/extract` 응답에는 `imageAnalysis` 건수가 포함된다.
- 소재·구성, 맞춤 제작, 대량 주문 조건, 활용법, ESG 근거, 추가 확인 필요, 출처를 기존 customFields로 저장한다. 온보딩도 같은 `extractSalesProduct`를 사용한다.
- **길이 초과는 거부하지 않고 clamp 한다.** zod 로 막으면 재시도 2회 중 1회를 길이 위반으로 태우고,
  통과시켜도 `productSchema`(`oneLinerPitch` max 200)에서 POST 가 400 으로 하드 실패한다.

### 차단 감지는 2중이다

실측 결과가 이 설계의 근거다.

- 쿠팡 → **403** 을 준다 (상태코드로 감지)
- 스마트스토어 → **로그인 페이지로 보내고 200 을 준다.** 그 폼 텍스트가 390자라 길이 문턱만으로는 안 걸렸다

상태코드 오류, 텍스트와 이미지 모두 없는 경우, AI가 상품명을 확인하지 못한 경우에는 `422 + recovery:'paste'`로 상세 자료 보완을 안내한다. 텍스트가 짧아도 이미지가 있으면 분석을 시도한다.

### 그 외 실패

| 원인                 | 상태 | 사용자에게                                |
| -------------------- | ---- | ----------------------------------------- |
| 잘못된 URL / 사설 IP | 400  | "올바른 상품 URL" / "접근할 수 없는 주소" |
| AI 미설정            | 409  | `/settings/ai` 링크                       |
| BYOK 키 오류         | 400  | 설정에서 재등록 안내                      |
| 쿼터 소진            | 429  | 이번 달 사용량 소진                       |
| JSON 2회 실패        | 502  | 직접 입력 제안                            |

## 관련 파일

- 어휘·clamp·첫 문장: `src/lib/sc/product-import/labels.ts`
- seller-ops 매핑: `src/lib/sc/product-import/map-inv-product.ts`
- 추출 스키마·정규화: `src/lib/sc/product-import/schemas.ts`
- 프롬프트: `src/lib/sc/product-import/prompts.ts`
- HTML→텍스트: `src/lib/sh/html-to-text.ts` (develop 에서 포팅, 무수정)
- 크롤: `src/lib/bo/crawler.ts` `fetchPageHtml`
- UI: `src/components/sc/settings/{add-product-dialog,seller-ops-product-picker,product-link-input}.tsx`
